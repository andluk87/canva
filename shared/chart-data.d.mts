export type ChartType = 'bar' | 'line' | 'pie';
export type DataMatrix = { headers: string[]; rows: string[][] };
export type DataConfig = DataMatrix & {
  version: 1; kind: 'chart' | 'table'; chartType: ChartType;
  title: string; palette: 'violet' | 'ocean' | 'sunset'; width: number; height: number;
};
export const DATA_LIMITS: Readonly<{rows:number;columns:number;pieRows:number;cell:number;bytes:number;value:number}>;
export const DATA_PALETTES: Readonly<Record<DataConfig['palette'], string[]>>;
export function numericValue(value: string, row?: number): number;
export function parseDesignData(csv: string, kind?: DataConfig['kind'], chartType?: ChartType): DataMatrix;
export function validateDataConfig(input: unknown): DataConfig;
export function dataCSV(data: DataMatrix): string;
export function chartGeometry(values: number[], width: number, height: number): {
  min:number;max:number;baseline:number;ticks:{value:number;y:number}[];
  points:{x:number;y:number;value:number;left:number;top:number;width:number;height:number}[];
};
export function pieSlices(values: number[]): {start:number;end:number;fraction:number}[];
