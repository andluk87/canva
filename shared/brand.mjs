export const BRAND_FONTS = Object.freeze([
  "Arial",
  "Georgia",
  "Verdana",
  "Courier New",
  "Times New Roman",
]);
export const BRAND_LIMITS = Object.freeze({
  kits: 20,
  logos: 10,
  logoBytes: 1024 * 1024,
  storageBytes: 30 * 1024 * 1024,
});
const label = (value) =>
  typeof value === "string" &&
  !!value.trim() &&
  value.trim().length <= 100 &&
  !/[\u0000-\u001f\u007f]/.test(value);
export function brandSettings(input) {
  if (!input || typeof input !== "object" || !label(input.name))
    throw new Error("Название бренда: от 1 до 100 символов");
  if (
    !Array.isArray(input.colors) ||
    input.colors.length < 1 ||
    input.colors.length > 10 ||
    input.colors.some(
      (c) => typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c),
    )
  )
    throw new Error("Палитра: от 1 до 10 цветов HEX");
  if (!BRAND_FONTS.includes(input.font))
    throw new Error("Выберите поддерживаемый системный шрифт");
  const typography =
    input.typography === undefined
      ? {
          headingSize: 48,
          bodySize: 24,
          headingWeight: "bold",
          bodyWeight: "normal",
          lineHeight: 1.2,
        }
      : input.typography;
  if (
    !typography ||
    typeof typography !== "object" ||
    ![typography.headingSize, typography.bodySize].every(
      (n) => Number.isInteger(n) && n >= 8 && n <= 200,
    ) ||
    !["normal", "bold"].includes(typography.headingWeight) ||
    !["normal", "bold"].includes(typography.bodyWeight) ||
    typeof typography.lineHeight !== "number" ||
    !Number.isFinite(typography.lineHeight) ||
    typography.lineHeight < 0.8 ||
    typography.lineHeight > 2.5
  )
    throw new Error("Типографика: размеры 8–200 px, интерлиньяж 0,8–2,5");
  return {
    name: input.name.trim(),
    colors: input.colors.map((c) => c.toLowerCase()),
    font: input.font,
    typography: {
      headingSize: typography.headingSize,
      bodySize: typography.bodySize,
      headingWeight: typography.headingWeight,
      bodyWeight: typography.bodyWeight,
      lineHeight: typography.lineHeight,
    },
  };
}
// Pure per-object patch: positions, images, locked objects and data-driven groups stay intact.
export function brandObjectStyle(object, brand, index = 0, typography = false) {
  const type = String(object.type || "").toLowerCase();
  if (
    type === "image" ||
    type === "group" ||
    object.formaData ||
    (object.lockMovementX && object.lockMovementY)
  )
    return null;
  const text = ["textbox", "text", "i-text", "itext"].includes(type);
  const patch = {
    fill: brand.colors[
      text ? Math.min(1, brand.colors.length - 1) : index % brand.colors.length
    ],
  };
  if (text) {
    patch.fontFamily = brand.font;
    if (typography) {
      const heading = Number(object.fontSize) >= 32;
      patch.fontSize = heading
        ? brand.typography.headingSize
        : brand.typography.bodySize;
      patch.fontWeight = heading
        ? brand.typography.headingWeight
        : brand.typography.bodyWeight;
      patch.lineHeight = brand.typography.lineHeight;
    }
  }
  return patch;
}
