import test from "node:test";
import assert from "node:assert/strict";
import { getEnv } from "fabric/node";
import { Rect, Gradient } from "fabric";
import {
  validateSVG, applyGradient, applyShadow, applyStroke, roundCorners,
} from "../src/advanced/operations.ts";
const environment = getEnv();
globalThis.DOMParser = environment.window.DOMParser;
globalThis.XMLSerializer = environment.window.XMLSerializer;
const wrap = (content) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">${content}</svg>`;

test("SVG imports keep vector paths, local gradients, XML-escaped text and clip paths", () => {
  const svg = validateSVG(wrap(`<defs><linearGradient id="paint"><stop offset="0" stop-color="#8561df"/><stop offset="1" stop-color="#f6c3ce"/></linearGradient><clipPath id="clip"><circle cx="50" cy="50" r="40"/></clipPath></defs><rect width="100" height="100" fill="url(#paint)" clip-path="url('#clip')"/><text x="5" y="50">A &amp; B</text>`));
  assert.match(svg, /linearGradient/);
  assert.match(svg, /A &amp; B/);
  assert.match(svg, /clip-path/);
});

test("SVG validation rejects active elements, external resources and disguised URLs", () => {
  const payloads = [
    '<script>alert(1)</script>', '<foreignObject><div>HTML</div></foreignObject>',
    '<image href="https://example.test/leak"/>', '<use xlink:href="https://example.test/a.svg#id"/>',
    '<rect onload="alert(1)"/>', '<rect oNclick="alert(1)"/>',
    '<rect fill="url(https://example.test/pattern.svg)"/>',
    '<rect style="fill:url( //example.test/pattern.svg )"/>',
    '<rect fill="url(&#106;avascript:alert(1))"/>',
    '<rect style="fill:u\\72l(https://example.test/pattern.svg)"/>',
    '<rect style="fill:expression(alert(1))"/>',
    '<style>@import "https://example.test/fonts";</style>',
    '<animate attributeName="href" to="javascript:alert(1)"/>',
    '<a href="javascript:alert(1)"><rect/></a>',
    '<rect xmlns="http://www.w3.org/1999/xhtml"/>',
  ];
  for (const payload of payloads) assert.throws(() => validateSVG(wrap(payload)), undefined, payload);
});

test("SVG validation blocks XML entities, malformed roots and size/depth/node abuse", () => {
  assert.throws(() => validateSVG('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' + wrap('<text>&xxe;</text>')));
  assert.throws(() => validateSVG('<?xml-stylesheet href="https://example.test/x.css"?>' + wrap('')));
  assert.throws(() => validateSVG('<html/>'));
  assert.throws(() => validateSVG(wrap('<rect>')));
  assert.throws(() => validateSVG(wrap(`<desc>${'x'.repeat(2 * 1024 * 1024)}</desc>`)), /2 МБ/);
  assert.throws(() => validateSVG(wrap('<g>'.repeat(66) + '<rect/>' + '</g>'.repeat(66))), /глубина/);
  assert.throws(() => validateSVG(wrap('<rect/>'.repeat(5001))), /5000/);
});

test("SVG validation catches gradient inheritance and clip-path reference cycles", () => {
  const cyclic = [
    '<defs><linearGradient id="a" xlink:href="#a"/></defs><rect fill="url(#a)"/>',
    '<defs><linearGradient id="a" xlink:href="#b"/><linearGradient id="b" xlink:href="#a"/></defs>',
    '<defs><clipPath id="a"><rect clip-path="url(#a)"/></clipPath></defs>',
    '<defs><clipPath id="a"><rect clip-path="url(#b)"/></clipPath><clipPath id="b"><rect clip-path="url(#a)"/></clipPath></defs>',
  ];
  for (const payload of cyclic) assert.throws(() => validateSVG(wrap(payload)), /Циклические/);
  assert.throws(() => validateSVG(wrap('<rect fill="url(#missing)"/>')), /отсутствующий/);
  assert.throws(() => validateSVG(wrap('<rect id="a"/><circle id="a"/>')), /уникальны/);
  const longReferences = '<defs>' + '<linearGradient id="g0"><stop offset="0" stop-color="#123456"/></linearGradient>' + Array.from({length: 120}, (_, i) => `<linearGradient id="g${i+1}" xlink:href="#g${i}"/>`).join('') + '</defs>';
  assert.throws(() => validateSVG(wrap(longReferences)), /цепочка/);
  assert.doesNotThrow(() => validateSVG(wrap('<defs><linearGradient id="a"><stop offset="0" stop-color="#123456"/></linearGradient><linearGradient id="b" xlink:href="#a"/></defs><rect fill="url(#b)"/>')));
});

test("object styling uses native serializable Fabric gradients, strokes, shadows and bounded radii", () => {
  const object = new Rect({ width: 100, height: 60 });
  applyGradient(object, '#123456', '#fedcba', 90);
  assert.ok(object.fill instanceof Gradient);
  assert.equal(object.fill.type, 'linear');
  assert.ok(Math.abs(object.fill.coords.y1) < 1e-9);
  assert.ok(Math.abs(object.fill.coords.y2 - 1) < 1e-9);
  applyStroke(object, '#112233', 5, true);
  roundCorners(object, 999);
  applyShadow(object, { color: '#010203', blur: 20, offsetX: -4, offsetY: 12 });
  const serialized = object.toObject();
  assert.equal(serialized.strokeWidth, 5);
  assert.equal(serialized.strokeUniform, true);
  assert.deepEqual(serialized.strokeDashArray, [8, 5]);
  assert.equal(serialized.rx, 30);
  assert.equal(serialized.ry, 30);
  assert.equal(serialized.shadow.offsetX, -4);
  assert.equal(serialized.shadow.offsetY, 12);
  assert.equal(serialized.fill.colorStops[1].color, '#fedcba');
  applyGradient(object, '#123456', '#fedcba', 0, true);
  assert.equal(object.fill.type, 'radial');
  assert.throws(() => applyGradient(object, 'url(http://example.test)', '#fedcba'));
  applyShadow(object, null);
  assert.equal(object.shadow, null);
});
