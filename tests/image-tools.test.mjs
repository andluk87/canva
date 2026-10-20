import test from "node:test";
import assert from "node:assert/strict";
import { Circle, FabricImage, Rect } from "fabric";
import {
  sourceDimensions, imageCrop, validateCrop, presetCrop, centerCrop,
  applyImageCrop, resetImageCrop, applyImageMask, imageMask, flipImage,
} from "../src/image-tools/operations.ts";

function image(options = {}) {
  // Fabric accepts image-like sources for geometry; pixel rendering is covered in Chromium.
  return new FabricImage({
    naturalWidth: 320, naturalHeight: 200, width: 320, height: 200,
    src: "data:image/png;base64,original-source-retained",
  }, { left: 45, top: 55, scaleX: 2, scaleY: 2, ...options });
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("image crop validates whole source pixels and rejects invalid/overflow regions before mutation", () => {
  const photo = image();
  const before = photo.toObject();
  for (const crop of [
    { x: -1, y: 0, width: 20, height: 20 },
    { x: 0, y: 0, width: 0, height: 20 },
    { x: 0, y: 0, width: 10.5, height: 20 },
    { x: 310, y: 0, width: 20, height: 20 },
    { x: 0, y: 195, width: 20, height: 20 },
    { x: NaN, y: 0, width: 20, height: 20 },
    { x: 0, y: Infinity, width: 20, height: 20 },
  ]) {
    assert.throws(() => applyImageCrop(photo, crop));
    assert.deepEqual(photo.toObject(), before);
  }
  assert.doesNotThrow(() => validateCrop({ x: 319, y: 199, width: 1, height: 1 }, sourceDimensions(photo)));
});

test("crop and reset preserve source URI, transformed center, rotation, scale and mirrors", () => {
  const photo = image({ angle: 37, flipX: true, flipY: true, scaleX: 1.7, scaleY: .8, skewX: 13 });
  const before = photo.toObject(), center = photo.getRelativeCenterPoint();
  assert.equal(applyImageCrop(photo, { x: 20, y: 35, width: 160, height: 90 }), true);
  near(photo.getRelativeCenterPoint().x, center.x);
  near(photo.getRelativeCenterPoint().y, center.y);
  for (const name of ["angle", "scaleX", "scaleY", "flipX", "flipY", "skewX"]) assert.equal(photo[name], before[name]);
  assert.equal(photo.getSrc(), before.src);
  assert.deepEqual(imageCrop(photo), { x: 20, y: 35, width: 160, height: 90 });
  assert.equal(applyImageCrop(photo, imageCrop(photo)), false);
  assert.equal(resetImageCrop(photo), true);
  near(photo.getRelativeCenterPoint().x, center.x);
  near(photo.getRelativeCenterPoint().y, center.y);
  near(photo.left, before.left);
  near(photo.top, before.top);
  assert.deepEqual(imageCrop(photo), { x: 0, y: 0, width: 320, height: 200 });
  assert.equal(photo.toObject().src, before.src);
  assert.equal(resetImageCrop(photo), false);
});

test("source geometry reads the retained original when a filter substitutes a resized canvas", () => {
  const photo = image();
  photo._element = { width: 80, height: 50 };
  assert.deepEqual(sourceDimensions(photo), { width: 320, height: 200 });
  assert.doesNotThrow(() => applyImageCrop(photo, { x: 160, y: 100, width: 160, height: 100 }));
  assert.equal(photo.toObject().src, "data:image/png;base64,original-source-retained");
});

test("ratio presets and centering produce exact integer ratios without leaving source bounds", () => {
  const source = { width: 320, height: 200 };
  const square = presetCrop(source, "1:1");
  assert.deepEqual(square, { x: 60, y: 0, width: 200, height: 200 });
  for (const [name, ratio] of [["4:3", 4 / 3], ["16:9", 16 / 9]]) {
    const crop = presetCrop(source, name, { x: 310, y: 190, width: 10, height: 10 });
    near(crop.width / crop.height, ratio);
    validateCrop(crop, source);
  }
  assert.deepEqual(centerCrop({ x: 0, y: 0, width: 120, height: 80 }, source), { x: 100, y: 60, width: 120, height: 80 });
  assert.throws(() => presetCrop({ width: 5, height: 5 }, "16:9"), /слишком мал/);
});

test("circle and rounded masks serialize as relative native clipPaths and follow crop/reset dimensions", () => {
  const photo = image();
  applyImageMask(photo, "circle");
  assert.ok(photo.clipPath instanceof Circle);
  assert.equal(photo.clipPath.radius, 100);
  assert.equal(photo.clipPath.originX, "center");
  assert.equal(photo.clipPath.absolutePositioned, false);
  applyImageCrop(photo, { x: 50, y: 40, width: 120, height: 80 });
  assert.equal(photo.clipPath.radius, 40);
  assert.equal(photo.toObject().clipPath.type, "Circle");
  resetImageCrop(photo);
  assert.equal(photo.clipPath.radius, 100);
  applyImageMask(photo, "rounded", 500);
  assert.ok(photo.clipPath instanceof Rect);
  assert.equal(photo.clipPath.rx, 100);
  assert.equal(photo.clipPath.ry, 100);
  assert.equal(photo.clipPath.width, 320);
  assert.equal(photo.clipPath.height, 200);
  assert.deepEqual(imageMask(photo), { kind: "rounded", radius: 100 });
  assert.throws(() => applyImageMask(photo, "rounded", -1));
  applyImageMask(photo, "none");
  assert.equal(photo.clipPath, undefined);
  assert.equal(photo.toObject().clipPath, undefined);
});

test("custom masks are retained during crop and can be explicitly replaced or removed", () => {
  const photo = image();
  const custom = new Rect({ left: 10, top: 20, width: 50, height: 50, angle: 30 });
  photo.set("clipPath", custom);
  assert.equal(imageMask(photo).kind, "custom");
  applyImageCrop(photo, { x: 20, y: 30, width: 200, height: 100 });
  assert.equal(photo.clipPath, custom);
  applyImageMask(photo, "circle");
  assert.equal(imageMask(photo).kind, "circle");
  const source = photo.getSrc();
  flipImage(photo, "horizontal");
  flipImage(photo, "vertical");
  assert.equal(photo.flipX, true);
  assert.equal(photo.flipY, true);
  flipImage(photo, "horizontal");
  assert.equal(photo.flipX, false);
  assert.equal(photo.getSrc(), source);
});
