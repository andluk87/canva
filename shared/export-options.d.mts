export type ExportFormat='png'|'jpg'|'svg'|'pdf'|'pptx'|'json';
export type ExportInput={format:ExportFormat;selection:string;scale?:number;quality?:number;transparent?:boolean;zip?:boolean};
export type ExportSettings={format:ExportFormat;indexes:number[];scale:number;quality:number;transparent:boolean;zip:boolean;width:number;height:number};
export const EXPORT_LIMITS:Readonly<{pages:number;edge:number;pagePixels:number;totalPixels:number;bytes:number}>;
export function exportName(title:unknown):string;
export function pageSelection(input:string,total:number,current?:number):number[];
export function exportOptions(input:ExportInput,design:{width:number;height:number;document:{pages:unknown[]}},current?:number):ExportSettings;
export function pixelBudget(items:{width:number;height:number;pages:number}[]):void;
