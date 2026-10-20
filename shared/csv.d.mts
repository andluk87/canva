export const CSV_LIMITS: Readonly<{ rows: number; bytes: number; columns: number; cell: number }>;
export type CSVData = { headers: string[]; rows: Record<string, string>[]; delimiter: string };
export function parseCSV(input: string): CSVData;
export function textVariables(text: string): string[];
export function documentVariables(document: unknown): string[];
export function replaceVariables(text: string, row: Record<string, string>): string;
export function personalizeDocument<T>(document: T, row: Record<string, string>): T;
