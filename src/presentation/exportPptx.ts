import type PptxGenJS from "pptxgenjs";

export type ExportSlide = {
  id: string;
  canvas: { objects: Record<string, any>[]; [key: string]: any };
  notes?: string;
  transition?: string;
};
export type ExportPptxInput = {
  pages: readonly ExportSlide[];
  width: number;
  height: number;
  title: string;
};
type Slide = ReturnType<PptxGenJS["addSlide"]>;
const MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const names: Record<string, string> = { white: "FFFFFF", black: "000000", red: "FF0000", blue: "0000FF", green: "008000" };
function color(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^#[a-f0-9]{6}$/i.test(value)) return value.slice(1).toUpperCase();
  if (/^#[a-f0-9]{3}$/i.test(value)) return value.slice(1).split("").map((digit) => digit + digit).join("").toUpperCase();
  return names[value.toLowerCase()] || null;
}
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
const absent = (value: unknown) => value === undefined || value === null || value === "";
const kind = (object: Record<string, any>) => String(object.type || "").toLowerCase();
const visible = (object: Record<string, any>) => object.visible !== false && object.excludeFromExport !== true && object.opacity !== 0;

function nativeObject(object: Record<string, any>): boolean {
  const type = kind(object);
  if (!["rect", "circle", "text", "i-text", "itext", "textbox"].includes(type)) return false;
  if (["clipPath", "shadow", "transformMatrix", "backgroundColor"].some((key) => !absent(object[key]))) return false;
  if (object.filters?.length || object.objects || object.flipX || object.flipY) return false;
  if (["angle", "skewX", "skewY"].some((key) => object[key] && object[key] !== 0)) return false;
  if (object.globalCompositeOperation && object.globalCompositeOperation !== "source-over") return false;
  if (![undefined, "left"].includes(object.originX) || ![undefined, "top"].includes(object.originY)) return false;
  if (!["left", "top"].every((key) => object[key] === undefined || Number.isFinite(object[key]))) return false;
  const sx = object.scaleX ?? 1, sy = object.scaleY ?? 1;
  if (!positive(sx) || !positive(sy)) return false;
  if (object.opacity !== undefined && (typeof object.opacity !== "number" || object.opacity < 0 || object.opacity > 1)) return false;
  // Fabric strokes expand bounds differently from PowerPoint; use the exact
  // canvas rendering for them instead of changing their apparent geometry.
  if (!absent(object.stroke) && object.stroke !== "transparent" && object.strokeWidth !== 0) return false;
  if (!color(object.fill ?? "#000000")) return false;
  if (type === "rect") return positive(object.width) && positive(object.height) && !object.rx && !object.ry;
  if (type === "circle") return positive(object.radius) && !object.startAngle && (object.endAngle === undefined || object.endAngle === 360);
  if (Math.abs(sx - sy) > 0.000001 || !positive(object.fontSize) || !positive(object.width) || !positive(object.height)) return false;
  if (typeof object.text !== "string" || /[\r\n\t]/.test(object.text)) return false;
  // Tall Textboxes have wrapped lines even when their source contains no newline.
  // Their wrapping must remain a rasterized Fabric result.
  if (object.height > object.fontSize * 1.5) return false;
  if (object.styles && Object.keys(object.styles).length > 0) return false;
  if (object.path || object.charSpacing || object.underline || object.overline || object.linethrough || !absent(object.textBackgroundColor)) return false;
  if (object.direction && object.direction !== "ltr") return false;
  if (object.fontWeight !== undefined && !["normal", "bold", "400", "700", 400, 700].includes(object.fontWeight)) return false;
  if (object.fontStyle !== undefined && !["normal", "italic"].includes(object.fontStyle)) return false;
  return [undefined, "left", "center", "right"].includes(object.textAlign);
}

/** A page is wholly native or wholly rasterized, keeping the original stacking. */
export function pptxPageMode(page: ExportSlide): "native" | "raster" {
  const canvas = page.canvas;
  if (["backgroundImage", "overlayImage", "overlayColor", "clipPath"].some((key) => !absent(canvas[key]))) return "raster";
  const background = canvas.background ?? canvas.backgroundColor;
  if (!absent(background) && background !== "transparent" && !color(background)) return "raster";
  return canvas.objects.filter(visible).every(nativeObject) ? "native" : "raster";
}

function addNativePage(slide: Slide, page: ExportSlide, unit: number, shapes: PptxGenJS["ShapeType"]) {
  const background = color(page.canvas.background ?? page.canvas.backgroundColor);
  slide.background = { color: background || "FFFFFF" };
  for (const object of page.canvas.objects.filter(visible)) {
    const type = kind(object), sx = object.scaleX ?? 1, sy = object.scaleY ?? 1;
    const x = (object.left || 0) * unit, y = (object.top || 0) * unit;
    const fill = color(object.fill ?? "#000000")!;
    const transparency = Math.round((1 - (object.opacity ?? 1)) * 100);
    if (type === "rect" || type === "circle") {
      const w = (type === "circle" ? object.radius * 2 : object.width) * sx * unit;
      const h = (type === "circle" ? object.radius * 2 : object.height) * sy * unit;
      slide.addShape(type === "circle" ? shapes.ellipse : shapes.rect, {
        x, y, w, h, fill: { color: fill, transparency }, line: { color: fill, transparency: 100 },
        objectName: type === "circle" ? "Круг" : "Прямоугольник",
      });
    } else {
      slide.addText(object.text, {
        x, y, w: object.width * sx * unit, h: object.height * sy * unit,
        fontFace: object.fontFamily || "Times New Roman",
        fontSize: object.fontSize * sx * unit * 72,
        bold: object.fontWeight === "bold" || Number(object.fontWeight) === 700,
        italic: object.fontStyle === "italic", color: fill, transparency,
        align: object.textAlign || "left", valign: "top", margin: 0,
        breakLine: false, wrap: false, fit: "none", paraSpaceAfter: 0, paraSpaceBefore: 0,
        lineSpacingMultiple: 1, objectName: "Редактируемый текст",
      });
    }
  }
}

function assertEmbeddedResources(value: unknown, depth = 0): void {
  if (depth > 80) throw new Error("Слишком глубокая вложенность документа");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["src", "source", "href", "xlink:href"].includes(key) && typeof child === "string" && child &&
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(child)) {
      throw new Error("Для PPTX загрузите изображения в редактор; внешние изображения и SVG data URI не поддерживаются");
    }
    if (child && typeof child === "object") assertEmbeddedResources(child, depth + 1);
  }
}

async function renderPage(page: ExportSlide, width: number, height: number): Promise<string> {
  const { StaticCanvas } = await import("fabric");
  if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;
  const scale = Math.min(1, 4096 / Math.max(width, height));
  const canvas = new StaticCanvas(undefined, {
    width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)),
    enableRetinaScaling: false, renderOnAddRemove: false,
  });
  try {
    await canvas.loadFromJSON(JSON.parse(JSON.stringify(page.canvas)));
    canvas.setZoom(scale);
    canvas.renderAll();
    return canvas.toDataURL({ format: "png", multiplier: 1, enableRetinaScaling: false });
  } finally { await canvas.dispose(); }
}

/** Export every page and its speaker notes as an actual Office Open XML file. */
export async function exportPptx({ pages, width, height, title }: ExportPptxInput): Promise<Blob> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 6000 || height > 6000)
    throw new Error("Некорректные размеры презентации");
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 100)
    throw new Error("Презентация должна содержать от 1 до 100 слайдов");
  for (const page of pages) {
    if (!page || !page.canvas || !Array.isArray(page.canvas.objects)) throw new Error("Некорректный слайд");
    if (page.notes !== undefined && (typeof page.notes !== "string" || page.notes.length > 10000))
      throw new Error("Заметки должны содержать не более 10000 символов");
    assertEmbeddedResources(page.canvas);
  }
  const { default: Presentation } = await import("pptxgenjs");
  const pptx = new Presentation();
  // Keep the canvas ratio at any orientation. The longest side fits comfortably
  // within PowerPoint's physical slide-size limit, including large source canvases.
  const unit = (40 / 3) / Math.max(width, height);
  const slideWidth = width * unit, slideHeight = height * unit;
  pptx.defineLayout({ name: "FORMA", width: slideWidth, height: slideHeight });
  pptx.layout = "FORMA";
  pptx.title = title || "Презентация Forma";
  pptx.subject = "Экспорт дизайна Forma";
  pptx.author = "Forma"; pptx.company = "Forma";
  pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };
  for (const page of pages) {
    const slide = pptx.addSlide();
    if (pptxPageMode(page) === "native") addNativePage(slide, page, unit, pptx.ShapeType);
    else slide.addImage({ data: await renderPage(page, width, height), x: 0, y: 0, w: slideWidth, h: slideHeight,
      altText: "Снимок слайда: сложные эффекты сохранены как изображение" });
    if (page.notes) slide.addNotes(page.notes);
  }
  const content = await pptx.write({ outputType: "arraybuffer", compression: true });
  return new Blob([content as ArrayBuffer], { type: MIME });
}
