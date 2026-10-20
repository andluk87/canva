import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chartGeometry, dataCSV, numericValue, parseDesignData, pieSlices, validateDataConfig,
} from '../shared/chart-data.mjs';

test('chart data reads UTF-8 CSV, quoted labels, decimal commas and finite negative values', () => {
  const data = parseDesignData('\uFEFFКатегория;Значение\r\n"Кофе; чай";"12,5"\r\nВозврат;-2.5\r\nБез продаж;0');
  assert.deepEqual(data.headers, ['Категория', 'Значение']);
  assert.deepEqual(data.rows.map((row) => numericValue(row[1])), [12.5, -2.5, 0]);
  assert.deepEqual(parseDesignData(dataCSV(data)), data);
  assert.equal(numericValue(' -1.25e3 '), -1250);
});

test('chart validation rejects malformed shape, coercible strings, excessive rows and invalid pie values', () => {
  for (const value of ['', ' ', '0x10', '1_000', 'NaN', 'Infinity', '1e309', '123 EUR', '--2', '2.3.4', '1000000000001'])
    assert.throws(() => numericValue(value), undefined, value);
  assert.throws(() => parseDesignData('A,B,C\none,2,3'), /ровно два/);
  assert.throws(() => parseDesignData('A,B\n,2'), /Подписи/);
  assert.throws(() => parseDesignData('A,B\nx,2,3'), /ожидается/);
  assert.throws(() => parseDesignData('A,B\n' + Array.from({length:31}, (_, i) => `Row ${i},1`).join('\n')), /30 строк/);
  assert.throws(() => parseDesignData('A,B\nx,-1', 'chart', 'pie'), /больше нуля/);
  assert.throws(() => parseDesignData('A,B\nx,0', 'chart', 'pie'), /больше нуля/);
  assert.throws(() => parseDesignData('A,B\n' + Array.from({length:13}, (_, i) => `Row ${i},1`).join('\n'), 'chart', 'pie'), /12 строк/);
  assert.doesNotThrow(() => parseDesignData('A,B\nx,-1', 'chart', 'line'));
});

test('table data preserves arbitrary text, multiline cells and CSV round trips within bounded dimensions', () => {
  const csv = 'Товар,Описание,Цена\r\nКнига,"Первая строка\nВторая, с запятой",15\r\nПлакат,"Текст с ""кавычками""",бесплатно';
  const data = parseDesignData(csv, 'table');
  assert.equal(data.rows[0][1], 'Первая строка\nВторая, с запятой');
  assert.equal(data.rows[1][1], 'Текст с "кавычками"');
  assert.deepEqual(parseDesignData(dataCSV(data), 'table'), data);
  assert.throws(() => parseDesignData('A,B,C,D,E,F,G,H,I\n1,2,3,4,5,6,7,8,9', 'table'), /8 столбцов/);
  assert.throws(() => parseDesignData('A,A\n1,2', 'table'), /повторяться/);
  assert.throws(() => parseDesignData('A\n' + 'x'.repeat(1001), 'table'), /1000/);
  assert.throws(() => parseDesignData('A\n' + 'x'.repeat(100_001), 'table'), /100 КБ/);
});

test('persisted data model is validated, bounded and detached from imported object metadata', () => {
  const data = {version:1, kind:'chart', chartType:'bar', title:'Report', palette:'ocean', width:600, height:400,
    headers:['Name','Value'], rows:[['A','5']], unknown:'discard', privateURL:'https://example.test'};
  const result = validateDataConfig(data);
  assert.equal(result.unknown, undefined);
  assert.equal(result.privateURL, undefined);
  result.rows[0][1] = '9';
  assert.equal(data.rows[0][1], '5');
  for (const override of [{version:2}, {kind:'other'}, {chartType:'radar'}, {palette:'__proto__'}, {width:Infinity}, {height:0}, {title:'a'.repeat(121)}])
    assert.throws(() => validateDataConfig({...data,...override}), undefined, JSON.stringify(override));
});

test('bar and line geometry share a zero baseline for mixed, all-negative, zero and constant datasets', () => {
  const mixed = chartGeometry([-10, 0, 30], 300, 200);
  assert.equal(mixed.baseline, 150);
  assert.deepEqual(mixed.points.map(({y,height}) => [y,height]), [[200,50],[150,0],[0,150]]);
  assert.ok(mixed.points.every((point) => point.left >= 0 && point.left + point.width <= 300));
  assert.equal(chartGeometry([-1,-2], 100, 80).baseline, 0);
  assert.equal(chartGeometry([0,0], 100, 80).baseline, 80);
  assert.deepEqual(chartGeometry([2,2], 100, 80).points.map((point) => point.y), [0,0]);
  for (const values of [[0,0], [-1,-2], [2,2], [-1e12, 1e12]]) {
    const result = chartGeometry(values, 100, 80);
    assert.ok(result.points.every((point) => Object.values(point).every(Number.isFinite)));
    assert.ok(result.ticks.every((tick) => tick.y >= 0 && tick.y <= 80));
  }
  assert.throws(() => chartGeometry([NaN], 100, 80));
  assert.throws(() => chartGeometry([1], 0, 80));
});

test('pie geometry has exact bounded positive fractions including a complete single-value circle', () => {
  const slices = pieSlices([1,2,3]);
  assert.equal(slices[0].start, -Math.PI / 2);
  assert.ok(Math.abs(slices.at(-1).end - slices[0].start - 2 * Math.PI) < 1e-12);
  assert.ok(Math.abs(slices.reduce((sum,slice) => sum+slice.fraction, 0) - 1) < 1e-12);
  assert.deepEqual(pieSlices([7]), [{ start: -Math.PI / 2, end: 3 * Math.PI / 2, fraction: 1 }]);
  for (const values of [[], [0], [-1,3], [Infinity], Array(13).fill(1)]) assert.throws(() => pieSlices(values));
});
