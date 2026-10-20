import type { BrandSettings } from "../../shared/brand.mjs";
export type BrandLogo = {
  id: string;
  name: string;
  src: string;
  width: number;
  height: number;
};
export type BrandKit = BrandSettings & {
  id: string;
  revision: number;
  logos: BrandLogo[];
};
export type BrandSummary = Pick<
  BrandKit,
  "id" | "name" | "colors" | "font" | "revision"
> & { logoCount: number };
