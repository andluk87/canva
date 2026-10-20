/** A small, dependency-free CSV reader shared by the UI and bulk API. */
export const CSV_LIMITS = Object.freeze({ rows: 50, bytes: 1_000_000, columns: 100, cell: 20_000 });

function fail(message) {
  throw new Error(message);
}

function delimiterOf(text) {
  let quoted = false, commas = 0, semicolons = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (c === '\n' || c === '\r') break;
      if (c === ',') commas++;
      if (c === ';') semicolons++;
    }
  }
  return semicolons > commas ? ';' : ',';
}

/** Quoted commas, escaped quotes, CRLF, quoted newlines and UTF-8 BOM are supported. */
export function parseCSV(input) {
  if (typeof input !== 'string') fail('CSV должен быть текстом');
  if (new TextEncoder().encode(input).length > CSV_LIMITS.bytes)
    fail('CSV слишком большой: максимум 1 МБ');
  const text = input.replace(/^\uFEFF/, '');
  if (!text.trim()) fail('Добавьте CSV с заголовками и хотя бы одной строкой данных');
  const delimiter = delimiterOf(text.replace(/^(?:\r\n|\r|\n)+/, ''));
  const matrix = [];
  let row = [], field = '', quoted = false, closed = false;
  const pushField = () => {
    if (field.length > CSV_LIMITS.cell) fail('Слишком длинная ячейка: максимум 20 000 символов');
    row.push(field);
    if (row.length > CSV_LIMITS.columns) fail('Слишком много столбцов: максимум 100');
    field = '';
    closed = false;
  };
  const pushRow = () => {
    const explicitlyQuoted = closed;
    pushField();
    // Ignore empty physical lines; an explicit row such as "," is still data.
    if (row.length !== 1 || row[0] !== '' || explicitlyQuoted) matrix.push(row);
    row = [];
    if (matrix.length > CSV_LIMITS.rows + 1)
      fail('Слишком много строк: максимум 50 дизайнов за один запуск');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === delimiter) pushField();
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else if (c === '"') {
      if (field || closed) fail('Некорректные кавычки в CSV: заключите всю ячейку в двойные кавычки');
      quoted = true;
    } else if (closed) {
      if (c !== ' ' && c !== '\t') fail('После закрывающей кавычки ожидается разделитель или конец строки');
    } else field += c;
    if (field.length > CSV_LIMITS.cell) fail('Слишком длинная ячейка: максимум 20 000 символов');
  }
  if (quoted) fail('В CSV не закрыта двойная кавычка');
  if (row.length || field || closed) pushRow();
  if (matrix.length < 2) fail('CSV должен содержать заголовки и хотя бы одну строку данных');
  const headers = matrix.shift().map((s) => s.trim());
  if (headers.some((h) => !h)) fail('У каждого столбца должно быть непустое название');
  if (new Set(headers).size !== headers.length) fail('Названия столбцов не должны повторяться');
  if (headers.some((h) => h.includes('{{') || h.includes('}}')))
    fail('Названия столбцов укажите без скобок {{ и }}');
  const rows = matrix.map((cells, index) => {
    if (cells.length !== headers.length)
      fail(`Строка ${index + 2}: ожидается ${headers.length} ячеек, получено ${cells.length}`);
    const record = Object.create(null);
    headers.forEach((h, i) => { record[h] = cells[i]; });
    return record;
  });
  return { headers, rows, delimiter };
}

const variablePattern = /{{\s*([^{}\s](?:[^{}]*?[^{}\s])?)\s*}}/g;
export function textVariables(text) {
  return [...new Set([...String(text).matchAll(variablePattern)].map((m) => m[1].trim()))];
}

/** Only text properties are personalized; URLs, object IDs and styling stay intact. */
export function documentVariables(document) {
  const names = new Set();
  const visit = (value, depth = 0) => {
    if (depth > 80) fail('Слишком глубокая вложенность документа');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'text' && typeof child === 'string')
        textVariables(child).forEach((name) => names.add(name));
      else if (child && typeof child === 'object') visit(child, depth + 1);
    }
  };
  visit(document);
  return [...names];
}

export function replaceVariables(text, row) {
  return text.replace(variablePattern, (_, key) => {
    const name = key.trim();
    if (!Object.hasOwn(row, name)) fail(`В CSV отсутствует столбец «${name}»`);
    return row[name];
  });
}

export function personalizeDocument(document, row) {
  const visit = (value, depth = 0) => {
    if (depth > 80) fail('Слишком глубокая вложенность документа');
    if (Array.isArray(value)) return value.map((v) => visit(v, depth + 1));
    if (!value || typeof value !== 'object') return value;
    const copy = Object.create(null);
    for (const [key, child] of Object.entries(value))
      copy[key] = key === 'text' && typeof child === 'string'
        ? replaceVariables(child, row)
        : visit(child, depth + 1);
    return copy;
  };
  return visit(document);
}
