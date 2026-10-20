import { Circle, FabricImage, Point, Rect } from "fabric";

export type ImageDimensions = { width: number; height: number };
export type CropRegion = { x: number; y: number; width: number; height: number };
export type CropPreset = "1:1" | "4:3" | "16:9";
export type ImageMask = { kind: "none" | "circle" | "rounded" | "custom"; radius: number };

/** Filters can replace getElement() with a resized canvas. Use the retained original. */
export function sourceDimensions(image: FabricImage): ImageDimensions {
  const element = image._originalElement;
  if (!element) throw new Error("Исходное изображение недоступно");
  const source = element as HTMLImageElement;
  const width = Number(source.naturalWidth || source.width);
  const height = Number(source.naturalHeight || source.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error("Не удалось определить исходные размеры изображения");
  }
  return { width, height };
}

export function imageCrop(image: FabricImage): CropRegion {
  return { x: image.cropX || 0, y: image.cropY || 0, width: image.width, height: image.height };
}

export function validateCrop(crop: CropRegion, source: ImageDimensions): void {
  for (const value of [source.width, source.height]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Некорректные размеры оригинала");
  }
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger)) {
    throw new Error("Координаты и размер кадра должны быть целыми пикселями");
  }
  if (crop.x < 0 || crop.y < 0) throw new Error("Координаты кадра не могут быть отрицательными");
  if (crop.width < 1 || crop.height < 1) throw new Error("Ширина и высота кадра должны быть не меньше 1 px");
  if (crop.x + crop.width > source.width || crop.y + crop.height > source.height) {
    throw new Error(`Кадр выходит за границы оригинала ${source.width} × ${source.height} px`);
  }
}

/** Integer source pixels, with the largest exact preset ratio that fits the original. */
export function presetCrop(source: ImageDimensions, preset: CropPreset, current?: CropRegion): CropRegion {
  const ratios = { "1:1": [1, 1], "4:3": [4, 3], "16:9": [16, 9] } as const;
  const [horizontal, vertical] = ratios[preset];
  const multiple = Math.floor(Math.min(source.width / horizontal, source.height / vertical));
  if (multiple < 1) throw new Error("Оригинал слишком мал для выбранного соотношения сторон");
  const width = horizontal * multiple, height = vertical * multiple;
  const centerX = current ? current.x + current.width / 2 : source.width / 2;
  const centerY = current ? current.y + current.height / 2 : source.height / 2;
  const crop = {
    x: Math.max(0, Math.min(source.width - width, Math.round(centerX - width / 2))),
    y: Math.max(0, Math.min(source.height - height, Math.round(centerY - height / 2))),
    width, height,
  };
  validateCrop(crop, source);
  return crop;
}

export function centerCrop(crop: CropRegion, source: ImageDimensions): CropRegion {
  const centered = {
    ...crop,
    x: Math.floor((source.width - crop.width) / 2),
    y: Math.floor((source.height - crop.height) / 2),
  };
  validateCrop(centered, source);
  return centered;
}

export function imageMask(image: FabricImage): ImageMask {
  const mask = image.clipPath;
  if (!mask) return { kind: "none", radius: 0 };
  const centered = mask.left === 0 && mask.top === 0 && mask.originX === "center" && mask.originY === "center"
    && !mask.absolutePositioned && !mask.inverted && mask.angle === 0
    && mask.scaleX === 1 && mask.scaleY === 1 && !mask.skewX && !mask.skewY;
  if (centered && mask instanceof Circle) return { kind: "circle", radius: mask.radius };
  if (centered && mask instanceof Rect) return { kind: "rounded", radius: Math.min(mask.rx, mask.ry) };
  return { kind: "custom", radius: 0 };
}

function makeMask(image: FabricImage, kind: "circle" | "rounded", radius: number) {
  const options = {
    left: 0, top: 0, originX: "center" as const, originY: "center" as const,
    absolutePositioned: false, inverted: false, fill: "#000000", strokeWidth: 0,
    selectable: false, evented: false,
  };
  return kind === "circle"
    ? new Circle({ ...options, radius: Math.min(image.width, image.height) / 2 })
    : new Rect({
      ...options, width: image.width, height: image.height,
      rx: Math.min(radius, image.width / 2, image.height / 2),
      ry: Math.min(radius, image.width / 2, image.height / 2),
    });
}

export function applyImageMask(image: FabricImage, kind: "none" | "circle" | "rounded", radius = 24): void {
  if (!Number.isFinite(radius) || radius < 0) throw new Error("Радиус маски должен быть неотрицательным числом");
  image.set("clipPath", kind === "none" ? undefined : makeMask(image, kind, radius));
  image.set("dirty", true);
  image.setCoords();
}

/** Keep center, scale, rotation and flips. Frame dimensions change; no new resampling/stretch. */
export function applyImageCrop(image: FabricImage, crop: CropRegion): boolean {
  validateCrop(crop, sourceDimensions(image));
  const previous = imageCrop(image);
  if (previous.x === crop.x && previous.y === crop.y && previous.width === crop.width && previous.height === crop.height) return false;
  const center = image.getRelativeCenterPoint();
  const mask = imageMask(image);
  image.set({ cropX: crop.x, cropY: crop.y, width: crop.width, height: crop.height });
  image.setPositionByOrigin(new Point(center.x, center.y), "center", "center");
  if (mask.kind === "circle" || mask.kind === "rounded") {
    image.set("clipPath", makeMask(image, mask.kind, mask.radius));
  }
  image.set("dirty", true);
  image.setCoords();
  return true;
}

export function resetImageCrop(image: FabricImage): boolean {
  const { width, height } = sourceDimensions(image);
  return applyImageCrop(image, { x: 0, y: 0, width, height });
}

export function flipImage(image: FabricImage, axis: "horizontal" | "vertical") {
  image.set(axis === "horizontal" ? "flipX" : "flipY", axis === "horizontal" ? !image.flipX : !image.flipY);
  image.set("dirty", true);
  image.setCoords();
}
