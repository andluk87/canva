export type BrandSettings = {
  name: string;
  colors: string[];
  font: string;
  typography: {
    headingSize: number;
    bodySize: number;
    headingWeight: "normal" | "bold";
    bodyWeight: "normal" | "bold";
    lineHeight: number;
  };
};
export const BRAND_FONTS: readonly string[];
export const BRAND_LIMITS: Readonly<{
  kits: number;
  logos: number;
  logoBytes: number;
  storageBytes: number;
}>;
export function brandSettings(input: unknown): BrandSettings;
export function brandObjectStyle(
  object: any,
  brand: BrandSettings,
  index?: number,
  typography?: boolean,
): Record<string, any> | null;
