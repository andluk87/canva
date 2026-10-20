import { parseCSV } from './csv.mjs';

export const DATA_LIMITS = Object.freeze({ rows: 30, columns: 8, pieRows: 12, cell: 1000, bytes: 100_000, value: 1e12 });
export const DATA_PALETTES = Object.freeze({
  violet: ['#7651d8', '#a787eb', '#d7c8fa', '#e697b1', '#a74b78', '#493181'],
  ocean: ['#167e9a', '#42b5bf', '#a1dad4', '#3485b8', '#214c75', '#89b4e0'],
  sunset: ['#dc603c', '#f1a34d', '#f7d68b', '#c97989', '#934a79', '#6d4271'],
});

export function numericValue(value, row = 0) {
  const source = String(value).trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(source))
    throw new Error(`Строка ${row + 2}: значение должно быть числом без единиц измерения`);
  const number = Number(source.replace(',', '.'));
  if (!Number.isFinite(number) || Math.abs(number) > DATA_LIMITS.value)
    throw new Error(`Строка ${row + 2}: число должно быть конечным и не больше 10¹² по модулю`);
  return number;
}

export function parseDesignData(csv, kind = 'chart', chartType = 'bar') {
  if (typeof csv !== 'string' || new TextEncoder().encode(csv).length > DATA_LIMITS.bytes)
    throw new Error('CSV данных должен быть не больше 100 КБ');
  const parsed = parseCSV(csv);
  const data = { headers: parsed.headers, rows: parsed.rows.map((row) => parsed.headers.map((header) => row[header])) };
  validateMatrix(data, kind, chartType);
  return data;
}

function validateMatrix(data, kind, chartType) {
  if (!['chart', 'table'].includes(kind) || !['bar', 'line', 'pie'].includes(chartType))
    throw new Error('Неизвестный тип диаграммы или таблицы');
  if (!data || !Array.isArray(data.headers) || !Array.isArray(data.rows) ||
    !data.rows.length || data.rows.length > DATA_LIMITS.rows)
    throw new Error('Добавьте от 1 до 30 строк данных');
  const columns = data.headers.length;
  if (!columns || columns > DATA_LIMITS.columns || data.headers.some((header) => typeof header !== 'string' || !header.trim() || header.length > 80))
    throw new Error('Укажите от 1 до 8 столбцов с заголовками до 80 символов');
  if (new Set(data.headers).size !== columns) throw new Error('Заголовки столбцов должны быть уникальными');
  for (const row of data.rows) {
    if (!Array.isArray(row) || row.length !== columns || row.some((cell) => typeof cell !== 'string' || cell.length > DATA_LIMITS.cell))
      throw new Error('В строках должно быть одинаковое число ячеек, до 1000 символов в каждой');
  }
  if (kind === 'table') return;
  if (columns !== 2) throw new Error('Для диаграммы нужны ровно два столбца: подпись и число');
  if (data.rows.some((row) => !row[0].trim() || row[0].length > 100))
    throw new Error('Подписи диаграммы должны содержать от 1 до 100 символов');
  const values = data.rows.map((row, index) => numericValue(row[1], index));
  if (chartType === 'pie') {
    if (values.length > DATA_LIMITS.pieRows) throw new Error('Для круговой диаграммы используйте не больше 12 строк');
    if (values.some((value) => value <= 0)) throw new Error('Для круговой диаграммы все числа должны быть больше нуля');
  }
}

/** Accept only a small known data model when a saved group is selected. */
export function validateDataConfig(input) {
  if (!input || typeof input !== 'object' || input.version !== 1) throw new Error('Неподдерживаемая версия данных');
  validateMatrix(input, input.kind, input.chartType);
  if (typeof input.title !== 'string' || input.title.length > 120) throw new Error('Заголовок должен быть не длиннее 120 символов');
  if (!Object.hasOwn(DATA_PALETTES, input.palette)) throw new Error('Неизвестная палитра');
  if (![input.width, input.height].every((value) => Number.isFinite(value) && value >= 40 && value <= 4000))
    throw new Error('Размер диаграммы или таблицы вне допустимого диапазона');
  return {
    version: 1, kind: input.kind, chartType: input.chartType,
    title: input.title, palette: input.palette, width: input.width, height: input.height,
    headers: [...input.headers], rows: input.rows.map((row) => [...row]),
  };
}

export function dataCSV(data) {
  const cell = (value) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return [data.headers, ...data.rows].map((row) => row.map(cell).join(',')).join('\r\n');
}

export function chartGeometry(values, width, height) {
  if (!Array.isArray(values) || !values.length || values.length > DATA_LIMITS.rows ||
    values.some((value) => !Number.isFinite(value) || Math.abs(value) > DATA_LIMITS.value) ||
    !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('Некорректные данные диаграммы');
  let min = Math.min(0, ...values), max = Math.max(0, ...values);
  if (min === max) max = 1;
  const span = max - min;
  const y = (value) => height - (value - min) / span * height;
  const step = width / values.length;
  const baseline = y(0);
  return {
    min, max, baseline,
    ticks: Array.from({ length: 5 }, (_, index) => ({ value: min + span * index / 4, y: y(min + span * index / 4) })),
    points: values.map((value, index) => ({
      x: step * (index + .5), y: y(value), value,
      left: step * (index + .16), top: Math.min(y(value), baseline),
      width: step * .68, height: Math.abs(y(value) - baseline),
    })),
  };
}

export function pieSlices(values) {
  if (!Array.isArray(values) || !values.length || values.length > DATA_LIMITS.pieRows || values.some((v) => !Number.isFinite(v) || v <= 0 || v > DATA_LIMITS.value))
    throw new Error('Для круговой диаграммы нужны от 1 до 12 положительных чисел');
  const total = values.reduce((sum, value) => sum + value, 0);
  let current = -Math.PI / 2;
  return values.map((value) => {
    const start = current;
    current += value / total * Math.PI * 2;
    return { start, end: current, fraction: value / total };
  });
}
