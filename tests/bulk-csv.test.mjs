import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_LIMITS, parseCSV, documentVariables, textVariables, replaceVariables, personalizeDocument } from '../shared/csv.mjs';

test('bulk CSV: BOM, semicolon, quoted delimiters, escaped quotes and multiline fields', () => {
  const parsed = parseCSV('\uFEFF имя ;город;сообщение\r\n"Анна; А.";Москва;"Привет, ""мир""!\nВторая строка"\r\nИван;Казань;""\r\n');
  assert.equal(parsed.delimiter, ';');
  assert.deepEqual(parsed.headers, ['имя', 'город', 'сообщение']);
  assert.equal(parsed.rows[0]['имя'], 'Анна; А.');
  assert.equal(parsed.rows[0]['сообщение'], 'Привет, "мир"!\nВторая строка');
  assert.equal(parsed.rows[1]['сообщение'], '');
  assert.equal(parseCSV('"name; alias",city\n"A, B",London').delimiter, ',');
  assert.equal(parseCSV('name\nAlice\n\n').rows.length, 1);
  assert.equal(parseCSV('name\n""\n').rows[0].name, '');
  assert.equal(parseCSV('\n\nname;city\nAlice;London').delimiter, ';');
});

test('bulk CSV: malformed, missing and duplicate headers fail with actionable errors', () => {
  for (const [csv, error] of [
    ['', /хотя бы/], ['name', /хотя бы/], [',city\nA,B', /название/],
    ['name, name \nA,B', /повторяться/], ['{{name}}\nAlice', /без скобок/],
    ['name,city\nAlice', /Строка 2.*2 ячеек/], ['name\n"Alice', /не закрыта/],
    ['name\nAli"ce', /кавычки/], ['name\n"Alice"oops', /закрывающей/],
  ]) assert.throws(() => parseCSV(csv), error, csv);
});

test('bulk CSV: strict row, column, cell and UTF-8 byte limits', () => {
  assert.equal(parseCSV('name\n' + Array(50).fill('A').join('\n')).rows.length, 50);
  assert.throws(() => parseCSV('name\n' + Array(51).fill('A').join('\n')), /максимум 50/);
  assert.throws(() => parseCSV('a\n' + 'x'.repeat(CSV_LIMITS.cell + 1)), /ячейка/);
  assert.throws(() => parseCSV(Array(101).fill('a').join(',') + '\nx'), /максимум 100/);
  assert.throws(() => parseCSV('имя\n' + 'я'.repeat(500_000)), /1 МБ/);
});

test('bulk CSV: recursive text replacement is literal and preserves source, styles, IDs and URLs', () => {
  const source = { pages: [{ id: '{{name}}', canvas: { objects: [
    { type: 'Textbox', text: 'Здравствуйте, {{ name }}! {{name}}', fill: '{{name}}' },
    { type: 'Group', objects: [{ type: 'IText', text: '{{city}} / {{name}}' }] },
    { type: 'Image', src: 'https://example.test/{{ignored}}.png' },
  ] } }] };
  const original = JSON.stringify(source);
  assert.deepEqual(documentVariables(source), ['name', 'city']);
  assert.deepEqual(textVariables('{{ name }} {{name}} {{город}}'), ['name', 'город']);
  const row = Object.assign(Object.create(null), { name: '$& <script>alert(1)</script> {{city}}', city: 'Москва\nКазань' });
  const result = personalizeDocument(source, row);
  assert.equal(result.pages[0].canvas.objects[0].text, 'Здравствуйте, $& <script>alert(1)</script> {{city}}! $& <script>alert(1)</script> {{city}}');
  assert.equal(result.pages[0].canvas.objects[1].objects[0].text, 'Москва\nКазань / ' + row.name);
  assert.equal(result.pages[0].canvas.objects[0].fill, '{{name}}');
  assert.equal(result.pages[0].id, '{{name}}');
  assert.equal(result.pages[0].canvas.objects[2].src, 'https://example.test/{{ignored}}.png');
  assert.equal(JSON.stringify(source), original);
  assert.throws(() => replaceVariables('{{missing}}', row), /отсутствует.*missing/);
});

test('bulk CSV: prototype-looking column names are safe own properties', () => {
  const { rows } = parseCSV('__proto__,constructor\nsafe,value');
  assert.equal(rows[0].__proto__, 'safe');
  assert.equal(replaceVariables('{{__proto__}} {{constructor}}', rows[0]), 'safe value');
  assert.equal({}.safe, undefined);
});
