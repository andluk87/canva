import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { getEnv } from "fabric/node";
import { exportPptx, pptxPageMode } from "../src/presentation/exportPptx.ts";

const parser = new (getEnv().window.DOMParser)();
const NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const XML = "http://schemas.openxmlformats.org/drawingml/2006/main";
const text = (value = "Редактируемый & <текст>") => ({
  type: "Textbox", text: value, left: 120, top: 80, width: 700, height: 56,
  fontFamily: "Arial", fontSize: 48, fill: "#123456", fontWeight: "bold",
});
const page = (id, objects = [text()]) => ({
  id, notes: `Заметки ${id}: & <важно>\nВторая строка`, transition: "fade",
  canvas: { version: "6.7.1", background: "#eaf0ff", objects },
});
async function unzip(input) {
  const blob = await exportPptx(input);
  assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  for (const name of Object.keys(zip.files).filter((name) => name.endsWith(".xml") || name.endsWith(".rels"))) {
    const document = parser.parseFromString(await zip.file(name).async("string"), "text/xml");
    assert.equal(document.getElementsByTagName("parsererror").length, 0, `Invalid Open XML part ${name}`);
  }
  return zip;
}
const parse = async (zip, path) => parser.parseFromString(await zip.file(path).async("string"), "text/xml");

test("PPTX-01 actual ZIP/Open XML includes every slide, correct landscape ratio and speaker notes", async () => {
  const pages = [page("one"), page("two", []), page("three", [text("Последний слайд")])];
  const original = JSON.stringify(pages);
  const zip = await unzip({ pages, width: 1920, height: 1080, title: "Презентация & <тест>" });
  assert.equal(JSON.stringify(pages), original, "Export must not mutate the editor snapshot");
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slides.length, 3);
  const doc = await parse(zip, "ppt/presentation.xml");
  assert.equal(doc.getElementsByTagNameNS(NS, "sldId").length, 3);
  const size = doc.getElementsByTagNameNS(NS, "sldSz")[0];
  assert.ok(Math.abs(Number(size.getAttribute("cx")) / Number(size.getAttribute("cy")) - 16 / 9) < 0.00001);
  const core = await zip.file("docProps/core.xml").async("string");
  assert.match(core, /Презентация &amp; &lt;тест&gt;/);
  for (let index = 1; index <= 3; index++) {
    const note = await parse(zip, `ppt/notesSlides/notesSlide${index}.xml`);
    assert.match(note.documentElement.textContent, /Заметки .*: & <важно>/);
    assert.match(note.documentElement.textContent, /Вторая строка/);
    assert.match(await zip.file(`ppt/slides/_rels/slide${index}.xml.rels`).async("string"), new RegExp(`notesSlide${index}\\.xml`));
  }
});

test("PPTX-02 simple text and shapes are native editable elements with scaled positions and colors", async () => {
  const pages = [page("native", [text(),
    { type: "Rect", left: 96, top: 192, width: 200, height: 100, fill: "#cc3300", opacity: 0.5 },
    { type: "Circle", left: 400, top: 300, radius: 80, fill: "#55aa77" },
    { ...text("Скрытый текст"), visible: false },
  ])];
  const zip = await unzip({ pages, width: 1920, height: 1080, title: "Editable" });
  const xml = await zip.file("ppt/slides/slide1.xml").async("string");
  const doc = await parse(zip, "ppt/slides/slide1.xml");
  assert.equal(doc.getElementsByTagNameNS(NS, "pic").length, 0);
  assert.equal(doc.getElementsByTagNameNS(NS, "sp").length, 3);
  const texts = [...doc.getElementsByTagNameNS(XML, "t")].map((element) => element.textContent);
  assert.ok(texts.includes("Редактируемый & <текст>"));
  assert.ok(!texts.includes("Скрытый текст"));
  const geometries = [...doc.getElementsByTagNameNS(XML, "prstGeom")].map((element) => element.getAttribute("prst"));
  assert.ok(geometries.includes("rect")); assert.ok(geometries.includes("ellipse"));
  assert.match(xml, /<a:srgbClr val="CC3300"><a:alpha val="50000"/);
  assert.match(xml, /<a:rPr[^>]*sz="2400"/); // 48 source px -> 24 pt at this slide scale.
  assert.match(xml, /<a:off x="762000" y="508000"/);
  assert.equal(Object.keys(zip.files).filter((name) => /^ppt\/media\/.+\.png$/.test(name)).length, 0);
});

test("PPTX-03 portrait and square slides preserve the source aspect ratio", async () => {
  for (const [width, height] of [[1080, 1920], [800, 800], [6000, 1000]]) {
    const zip = await unzip({ pages: [page("ratio", [])], width, height, title: "Ratio" });
    const doc = await parse(zip, "ppt/presentation.xml");
    const size = doc.getElementsByTagNameNS(NS, "sldSz")[0];
    const ratio = Number(size.getAttribute("cx")) / Number(size.getAttribute("cy"));
    assert.ok(Math.abs(ratio - width / height) < 0.00001);
  }
});

test("PPTX-04 complex effects and layout choose a whole-slide visual fallback", () => {
  assert.equal(pptxPageMode(page("plain")), "native");
  const objects = [
    { ...text(), text: "Строка 1\nСтрока 2" },
    { ...text(), height: 180 },
    { ...text(), styles: { 0: { 0: { fill: "#ff0000" } } } },
    { ...text(), scaleX: 2, scaleY: 1 },
    { type: "Rect", width: 100, height: 100, fill: { type: "linear", colorStops: [] } },
    { type: "Rect", width: 100, height: 100, fill: "#ffffff", shadow: { color: "#000000", blur: 8 } },
    { type: "Rect", width: 100, height: 100, fill: "#ffffff", stroke: "#112233", strokeWidth: 2 },
    { type: "Rect", width: 100, height: 100, fill: "#ffffff", angle: 15 },
    { type: "Rect", width: 100, height: 100, fill: "#ffffff", rx: 12 },
    { type: "Group", objects: [text()] },
    { type: "Path", path: [["M", 0, 0], ["L", 10, 10]] },
  ];
  for (const object of objects) assert.equal(pptxPageMode(page("complex", [object])), "raster", JSON.stringify(object));
  assert.equal(pptxPageMode({ ...page("overlay", []), canvas: { objects: [], background: { type: "radial" } } }), "raster");
});

test("PPTX-05 invalid inputs and external image sources fail before rendering or document generation", async () => {
  const base = { pages: [page("valid")], width: 1080, height: 1080, title: "Valid" };
  for (const patch of [{ width: 0 }, { height: Infinity }, { width: 6001 }, { pages: [] }, { pages: Array.from({ length: 101 }, () => page("x")) }])
    await assert.rejects(exportPptx({ ...base, ...patch }));
  await assert.rejects(exportPptx({ ...base, pages: [{ ...page("notes"), notes: "x".repeat(10001) }] }), /10000/);
  for (const source of ["https://example.test/track.png", "//example.test/a.png", "/api/assets/private/file", "data:image/svg+xml;base64,PHN2Zy8+"])
    await assert.rejects(exportPptx({ ...base, pages: [page("source", [{ type: "Image", src: source }])] }), /внешние изображения/);
});
