import {
  ActiveSelection,
  Canvas,
  FabricImage,
  FabricObject,
  Gradient,
  Point,
  Rect,
  Shadow,
  StaticCanvas,
  filters,
  loadSVGFromString,
  util,
} from "fabric";

export type Adjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
  grayscale: boolean;
  sepia: boolean;
};
export const neutralAdjustments: Adjustments = {
  brightness: 0, contrast: 0, saturation: 0, blur: 0,
  grayscale: false, sepia: false,
};
const managedFilters = new Set([
  "Brightness", "Contrast", "Saturation", "Blur", "Grayscale", "Sepia",
]);
const bounded = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

export function readAdjustments(image: FabricImage): Adjustments {
  const state = { ...neutralAdjustments };
  for (const filter of image.filters) {
    if (filter instanceof filters.Brightness) state.brightness = filter.brightness;
    else if (filter instanceof filters.Contrast) state.contrast = filter.contrast;
    else if (filter instanceof filters.Saturation) state.saturation = filter.saturation;
    else if (filter instanceof filters.Blur) state.blur = filter.blur;
    else if (filter instanceof filters.Grayscale) state.grayscale = true;
    else if (filter instanceof filters.Sepia) state.sepia = true;
  }
  return state;
}

/** Preserve filters from other tools and replace only adjustments owned here. */
export function applyAdjustments(image: FabricImage, state: Adjustments) {
  const next = image.filters.filter((filter) => !managedFilters.has(filter.type));
  const brightness = bounded(state.brightness, -1, 1);
  const contrast = bounded(state.contrast, -1, 0.99);
  const saturation = bounded(state.saturation, -1, 1);
  const blur = bounded(state.blur, 0, 1);
  if (brightness) next.push(new filters.Brightness({ brightness }));
  if (contrast) next.push(new filters.Contrast({ contrast }));
  if (saturation) next.push(new filters.Saturation({ saturation }));
  if (blur) next.push(new filters.Blur({ blur }));
  if (state.grayscale) next.push(new filters.Grayscale({ mode: "luminosity" }));
  if (state.sepia) next.push(new filters.Sepia());
  image.filters = next;
  image.applyFilters();
  image.set("dirty", true);
}

export function applyGradient(
  object: FabricObject,
  start: string,
  end: string,
  angle = 0,
  radial = false,
) {
  if (!/^#[a-f\d]{6}$/i.test(start) || !/^#[a-f\d]{6}$/i.test(end)) {
    throw new Error("Укажите два цвета в формате #RRGGBB");
  }
  const radians = bounded(angle, 0, 360) * Math.PI / 180;
  const dx = Math.cos(radians) / 2, dy = Math.sin(radians) / 2;
  object.set("fill", radial
    ? new Gradient({
      type: "radial", gradientUnits: "percentage",
      coords: { x1: .5, y1: .5, r1: 0, x2: .5, y2: .5, r2: .7 },
      colorStops: [{ offset: 0, color: start }, { offset: 1, color: end }],
    })
    : new Gradient({
      type: "linear", gradientUnits: "percentage",
      coords: { x1: .5 - dx, y1: .5 - dy, x2: .5 + dx, y2: .5 + dy },
      colorStops: [{ offset: 0, color: start }, { offset: 1, color: end }],
    }));
}

export function applyShadow(
  object: FabricObject,
  options: { color: string; blur: number; offsetX: number; offsetY: number } | null,
) {
  object.set("shadow", options ? new Shadow({
    color: options.color,
    blur: bounded(options.blur, 0, 200),
    offsetX: bounded(options.offsetX, -500, 500),
    offsetY: bounded(options.offsetY, -500, 500),
    nonScaling: false,
  }) : null);
}

export function applyStroke(object: FabricObject, color: string, width: number, dashed: boolean) {
  object.set({
    stroke: color,
    strokeWidth: bounded(width, 0, 100),
    strokeUniform: true,
    strokeDashArray: dashed ? [8, 5] : null,
  });
  object.setCoords();
}

/** Rect radii live in the object's coordinates and remain serializable. */
export function roundCorners(object: FabricObject, radius: number) {
  if (!(object instanceof Rect)) throw new Error("Скругление доступно для прямоугольников");
  const value = bounded(radius, 0, Math.min(object.width, object.height) / 2);
  object.set({ rx: value, ry: value });
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type AlignmentTarget = "page" | "selection";

function chosen(canvas: Canvas) {
  return canvas.getActiveObjects().filter((object) =>
    !object.lockMovementX && !object.lockMovementY && object.selectable,
  );
}
function restoreSelection(canvas: Canvas, objects: FabricObject[]) {
  if (objects.length > 1) canvas.setActiveObject(new ActiveSelection(objects, { canvas }));
  else if (objects[0]) canvas.setActiveObject(objects[0]);
  canvas.requestRenderAll();
}
function move(object: FabricObject, x: number, y: number) {
  object.setXY(object.getXY().add(new Point(x, y)));
  object.setCoords();
}
export function alignObjects(
  canvas: Canvas,
  alignment: Alignment,
  width: number,
  height: number,
  target: AlignmentTarget = "page",
) {
  const objects = chosen(canvas);
  if (!objects.length) throw new Error("Выделите незаблокированный объект");
  if (target === "selection" && objects.length < 2) {
    throw new Error("Для выравнивания по выделению нужны минимум два объекта");
  }
  // Release ActiveSelection first: its children then use document coordinates.
  canvas.discardActiveObject();
  const boxes = objects.map((object) => object.getBoundingRect());
  const left = target === "page" ? 0 : Math.min(...boxes.map((box) => box.left));
  const top = target === "page" ? 0 : Math.min(...boxes.map((box) => box.top));
  const right = target === "page" ? width : Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = target === "page" ? height : Math.max(...boxes.map((box) => box.top + box.height));
  for (let i = 0; i < objects.length; i++) {
    const box = boxes[i];
    const dx = alignment === "left" ? left - box.left
      : alignment === "center" ? (left + right - box.width) / 2 - box.left
      : alignment === "right" ? right - box.width - box.left : 0;
    const dy = alignment === "top" ? top - box.top
      : alignment === "middle" ? (top + bottom - box.height) / 2 - box.top
      : alignment === "bottom" ? bottom - box.height - box.top : 0;
    move(objects[i], dx, dy);
  }
  restoreSelection(canvas, objects);
  return objects.length;
}

/** Equal edge-to-edge gaps; first and last objects stay in place. */
export function distributeObjects(canvas: Canvas, axis: "horizontal" | "vertical") {
  const objects = chosen(canvas);
  if (objects.length < 3) throw new Error("Для распределения выделите минимум три объекта");
  canvas.discardActiveObject();
  const key = axis === "horizontal" ? "left" : "top";
  const size = axis === "horizontal" ? "width" : "height";
  const entries = objects.map((object) => ({ object, box: object.getBoundingRect() }))
    .sort((a, b) => a.box[key] - b.box[key]);
  const first = entries[0].box[key], last = entries.at(-1)!.box;
  const extent = last[key] + last[size] - first;
  const occupied = entries.reduce((total, entry) => total + entry.box[size], 0);
  const gap = (extent - occupied) / (entries.length - 1);
  let cursor = first;
  for (const { object, box } of entries) {
    const delta = cursor - box[key];
    move(object, axis === "horizontal" ? delta : 0, axis === "vertical" ? delta : 0);
    cursor += box[size] + gap;
  }
  restoreSelection(canvas, objects);
  return objects.length;
}

const svgTags = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polygon", "polyline",
  "text", "tspan", "defs", "lineargradient", "radialgradient", "stop", "clippath", "title", "desc",
]);
const svgAttributes = new Set([
  "xmlns", "xmlns:xlink", "version", "id", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "width", "height", "viewbox", "preserveaspectratio", "transform", "d", "points", "fill", "fill-rule",
  "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "color", "style",
  "clip-path", "clip-rule", "clippathunits", "gradientunits", "gradienttransform", "spreadmethod",
  "offset", "stop-color", "stop-opacity", "fx", "fy", "fr", "href", "xlink:href",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor", "text-decoration",
  "dominant-baseline", "letter-spacing", "xml:space", "dx", "dy", "visibility", "display",
]);
const safeStyleProperties = new Set([
  "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
  "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "color",
  "stop-color", "stop-opacity", "font-family", "font-size", "font-weight", "font-style", "text-anchor",
  "text-decoration", "dominant-baseline", "letter-spacing", "clip-path", "clip-rule", "visibility", "display",
]);
const localReference = /^#[\w:.-]{1,128}$/;
function validateSvgValue(value: string) {
  if (/\\|\/\*|\*\/|@|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error("SVG содержит неподдерживаемое CSS-выражение");
  }
  if (/(?:javascript|vbscript|data|https?|file|ftp)\s*:|expression\s*\(/i.test(value)) {
    throw new Error("Внешние ресурсы и активное содержимое SVG запрещены");
  }
  const withoutLocalUrls = value.replace(/url\(\s*(['"]?)(#[\w:.-]{1,128})\1\s*\)/gi, "");
  if (/url\s*\(/i.test(withoutLocalUrls)) {
    throw new Error("SVG может ссылаться только на внутренние градиенты и контуры");
  }
}

/** Validate before Fabric parsing: no network loads, executable tags or entity expansion. */
export function validateSVG(source: string): string {
  if (new TextEncoder().encode(source).byteLength > 2 * 1024 * 1024) {
    throw new Error("SVG должен быть не больше 2 МБ");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(source) || /<\?(?!xml\s)/i.test(source)) {
    throw new Error("DTD, сущности и инструкции обработки в SVG запрещены");
  }
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") {
    throw new Error("Не удалось прочитать SVG: проверьте XML-разметку");
  }
  const nodes = document.querySelectorAll("*");
  if (nodes.length > 5000) throw new Error("SVG слишком сложный: максимум 5000 элементов");
  const byId = new Map<string, Element>();
  for (const element of nodes) {
    if (element.id) {
      if (byId.has(element.id)) throw new Error("Идентификаторы SVG должны быть уникальны");
      byId.set(element.id, element);
    }
    let depth = 0;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (++depth > 64) throw new Error("Превышена глубина вложенности SVG");
    }
  }
  for (const element of nodes) {
    if (!svgTags.has(element.localName.toLowerCase()) ||
      (element.namespaceURI !== null && element.namespaceURI !== "http://www.w3.org/2000/svg")) {
      throw new Error("SVG содержит запрещённый элемент: " + element.localName);
    }
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      if (!svgAttributes.has(name)) throw new Error("SVG содержит запрещённый атрибут: " + attribute.name);
      if (name === "xmlns" || name === "xmlns:xlink") {
        const expected = name === "xmlns" ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xlink";
        if (attribute.value !== expected) throw new Error("Неподдерживаемое пространство имён SVG");
        continue;
      }
      if (name === "href" || name === "xlink:href") {
        if (!localReference.test(attribute.value)) throw new Error("Внешние ссылки в SVG запрещены");
      }
      validateSvgValue(attribute.value);
      if (name === "style") {
        for (const declaration of attribute.value.split(";")) {
          if (!declaration.trim()) continue;
          const separator = declaration.indexOf(":");
          if (separator < 1 || !safeStyleProperties.has(declaration.slice(0, separator).trim().toLowerCase())) {
            throw new Error("SVG содержит неподдерживаемое CSS-свойство");
          }
        }
      }
    }
  }
  // Fabric follows gradient inheritance and clip paths recursively. Detect cycles,
  // including references from a descendant back to its containing clip path.
  const visiting = new Set<Element>(), complete = new Map<Element, number>();
  function visit(element: Element, depth: number): number {
    if (visiting.has(element)) throw new Error("Циклические ссылки в SVG запрещены");
    const previous = complete.get(element);
    if (previous !== undefined) return previous;
    if (depth > 96) throw new Error("Слишком длинная цепочка ссылок SVG");
    visiting.add(element);
    let longestPath = 0;
    for (const child of element.children) longestPath = Math.max(longestPath, visit(child, depth + 1) + 1);
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      const references = [...attribute.value.matchAll(/url\(\s*['"]?(#[\w:.-]{1,128})['"]?\s*\)/gi)].map((match) => match[1]);
      if (name === "href" || name === "xlink:href") references.push(attribute.value);
      for (const reference of references) {
        const target = byId.get(reference.slice(1));
        if (!target) throw new Error("SVG ссылается на отсутствующий элемент: " + reference);
        longestPath = Math.max(longestPath, visit(target, depth + 1) + 1);
      }
    }
    visiting.delete(element);
    if (longestPath > 96) throw new Error("Слишком длинная цепочка ссылок SVG");
    complete.set(element, longestPath);
    return longestPath;
  }
  visit(document.documentElement, 0);
  return new XMLSerializer().serializeToString(document.documentElement);
}

export async function importSVG(source: string, width: number, height: number, signal?: AbortSignal) {
  const safe = validateSVG(source);
  const parsed = await loadSVGFromString(safe, undefined, { signal });
  const objects = parsed.objects.filter((object): object is FabricObject => object !== null);
  if (!objects.length) throw new Error("SVG не содержит доступных векторных объектов");
  const object = util.groupSVGElements(objects, parsed.options);
  const bounds = object.getBoundingRect();
  if (!Number.isFinite(bounds.width + bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("SVG должен иметь конечные ненулевые размеры");
  }
  object.scale(Math.min(1, width * .8 / bounds.width, height * .8 / bounds.height));
  object.setPositionByOrigin(new Point(width / 2, height / 2), "center", "center");
  object.setCoords();
  return object;
}

/** Render from a snapshot so editor zoom and multi-selection cannot change export dimensions. */
export async function exportSVG(canvas: Canvas, width: number, height: number) {
  const output = new StaticCanvas(undefined, { width, height, enableRetinaScaling: false });
  try {
    await output.loadFromJSON(canvas.toJSON());
    output.svgViewportTransformation = false;
    return output.toSVG({
      suppressPreamble: true,
      width: String(width), height: String(height),
      viewBox: { x: 0, y: 0, width, height },
    });
  } finally {
    await output.dispose();
  }
}

export function saveBlob(contents: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
