import { Circle, FabricObject, FabricText, FixedLayout, Group, LayoutManager, Line, Path, Rect } from 'fabric';
import {
  chartGeometry, DATA_PALETTES, numericValue, pieSlices, validateDataConfig,
  type DataConfig,
} from '../../shared/chart-data.mjs';

export type DataGroup = Group & { id: string; formaData: DataConfig };
const INK = '#252837';
const MUTED = '#656b7c';
const GRID = '#e2e5ed';
const bound = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const numberLabel = (n: number) => new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const newId = (): string => crypto.randomUUID?.() || `data-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function fittedText(value: string, x: number, y: number, available: number, size: number, fill = INK, bold = false) {
  const source = value.replace(/\s+/g, ' ');
  const text = new FabricText(source, {
    left: x, top: y, fontSize: size, fontFamily: 'Arial', fontWeight: bold ? 'bold' : 'normal',
    fill, strokeWidth: 0, selectable: false, evented: false, objectCaching: false,
  });
  if (text.width > available) text.set('fontSize', Math.max(Math.min(6, size), size * available / text.width));
  if (text.width > available) {
    // Labels shorten visually; the complete source remains in formaData and CSV.
    // Binary search bounds font measurement work even for 240 long table cells.
    let low = 0, high = source.length;
    while (low < high) {
      const length = Math.ceil((low + high) / 2);
      text.set('text', source.slice(0, length) + '…');
      if (text.width <= available) low = length;
      else high = length - 1;
    }
    text.set('text', low ? source.slice(0, low) + '…' : '');
  }
  return text;
}
function line(x1: number, y1: number, x2: number, y2: number, color = GRID, strokeWidth = 1) {
  return new Line([x1, y1, x2, y2], { stroke: color, strokeWidth, selectable: false, evented: false });
}

/** Native Fabric children, never a raster screenshot of the chart or table. */
export function createDataGroup(input: DataConfig, id = newId()): DataGroup {
  const config = validateDataConfig(input);
  const { width, height, title, rows, headers } = config;
  const palette = DATA_PALETTES[config.palette];
  const padding = Math.min(width, height) * .045;
  const titleSize = bound(width / 27, 9, 24);
  const titleSpace = title ? titleSize * 1.8 : padding;
  const children: FabricObject[] = [new Rect({
    left: 0, top: 0, width, height, fill: '#ffffff', strokeWidth: 0,
    selectable: false, evented: false,
  })];
  if (title) children.push(fittedText(title, padding, padding, width - padding * 2, titleSize, INK, true));
  if (config.kind === 'table') {
    const x = padding, y = titleSpace + padding;
    const contentWidth = width - padding * 2;
    const rowHeight = (height - y - padding) / (rows.length + 1);
    const columnWidth = contentWidth / headers.length;
    const fontSize = bound(Math.min(rowHeight * .48, columnWidth / 7), 1, 18);
    [headers, ...rows].forEach((row, rowIndex) => {
      children.push(new Rect({
        left: x, top: y + rowIndex * rowHeight, width: contentWidth, height: rowHeight,
        fill: rowIndex === 0 ? palette[0] : rowIndex % 2 ? '#f3f4f8' : '#ffffff',
        stroke: GRID, strokeWidth: .5, selectable: false, evented: false,
      }));
      row.forEach((cell, columnIndex) => {
        children.push(fittedText(cell, x + columnWidth * columnIndex + 5,
          y + rowIndex * rowHeight + (rowHeight - fontSize * 1.15) / 2,
          Math.max(1, columnWidth - 10), fontSize, rowIndex === 0 ? '#ffffff' : INK, rowIndex === 0));
      });
    });
    for (let index = 1; index < headers.length; index++) children.push(line(
      x + index * columnWidth, y, x + index * columnWidth, y + rowHeight * (rows.length + 1),
    ));
  } else if (config.chartType === 'pie') {
    const values = rows.map((row, index) => numericValue(row[1], index));
    const slices = pieSlices(values);
    const plotHeight = height - titleSpace - padding * 2;
    const diameter = Math.min(width * .49, plotHeight * .9);
    const radius = diameter / 2;
    const cx = padding + diameter / 2, cy = titleSpace + padding + plotHeight / 2;
    slices.forEach((slice, index) => {
      const point = (angle: number) => `${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)}`;
      // Two semicircles render a complete circle for a one-row dataset.
      const path = slices.length === 1
        ? `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius} Z`
        : `M ${cx} ${cy} L ${point(slice.start)} A ${radius} ${radius} 0 ${slice.end - slice.start > Math.PI ? 1 : 0} 1 ${point(slice.end)} Z`;
      children.push(new Path(path, { fill: palette[index % palette.length], stroke: '#ffffff', strokeWidth: 1, selectable: false, evented: false }));
    });
    const legendX = width * .56, legendWidth = width - legendX - padding;
    const rowHeight = plotHeight / Math.max(rows.length, 5);
    const font = bound(Math.min(rowHeight * .48, width / 44), 6, 16);
    rows.forEach((row, index) => {
      const y = titleSpace + padding + rowHeight * index;
      children.push(new Rect({ left: legendX, top: y + 2, width: font * .8, height: font * .8,
        fill: palette[index % palette.length], strokeWidth: 0, selectable: false, evented: false }));
      children.push(fittedText(`${row[0]} · ${numberLabel(values[index])} (${Math.round(slices[index].fraction * 1000) / 10}%)`,
        legendX + font * 1.4, y, legendWidth - font * 1.4, font));
    });
  } else {
    const left = Math.max(padding, width * .12), right = padding;
    const top = titleSpace + padding, bottom = height - padding * 2.6;
    const plotWidth = width - left - right, plotHeight = bottom - top;
    const values = rows.map((row, index) => numericValue(row[1], index));
    const geometry = chartGeometry(values, plotWidth, plotHeight);
    const labelSize = bound(width / 47, 6, 14);
    for (const tick of geometry.ticks) {
      children.push(line(left, top + tick.y, width - right, top + tick.y));
      children.push(fittedText(numberLabel(tick.value), padding * .2, top + tick.y - labelSize / 2, left - padding * .4, labelSize, MUTED));
    }
    children.push(line(left, top + geometry.baseline, width - right, top + geometry.baseline, '#9ba3b7', 1.5));
    if (config.chartType === 'bar') {
      geometry.points.forEach((point, index) => children.push(new Rect({
        left: left + point.left, top: top + point.top, width: point.width,
        height: Math.max(.5, point.height), fill: palette[index % palette.length],
        strokeWidth: 0, selectable: false, evented: false,
      })));
    } else {
      const path = geometry.points.map((point, index) => `${index ? 'L' : 'M'} ${left + point.x} ${top + point.y}`).join(' ');
      children.push(new Path(path, { fill: null, stroke: palette[0], strokeWidth: Math.max(1, width / 220), strokeLineJoin: 'round', selectable: false, evented: false }));
      geometry.points.forEach((point) => children.push(new Circle({
        left: left + point.x, top: top + point.y, originX: 'center', originY: 'center',
        radius: Math.max(1.5, width / 180), fill: palette[0], stroke: '#ffffff', strokeWidth: 1,
        selectable: false, evented: false,
      })));
    }
    const stride = Math.max(1, Math.ceil(rows.length / 9));
    rows.forEach((row, index) => {
      if (index % stride && index !== rows.length - 1) return;
      const available = plotWidth / Math.min(rows.length, 9) * .9;
      const x = bound(left + geometry.points[index].x - available / 2, left, width - right - available);
      children.push(fittedText(row[0], x, bottom + labelSize * .6, available, labelSize, MUTED));
    });
  }
  children.forEach((child, index) => { (child as FabricObject & { id: string }).id = `${id}:data:${index}`; });
  const group = new Group(children, {
    left: 0, top: 0, width, height, subTargetCheck: false, interactive: false,
    layoutManager: new LayoutManager(new FixedLayout()),
  }) as DataGroup;
  group.id = id;
  group.formaData = config;
  return group;
}

export function readDataGroup(object: FabricObject | null): DataConfig | null {
  if (!(object instanceof Group)) return null;
  try { return validateDataConfig((object as unknown as Partial<DataGroup>).formaData); } catch { return null; }
}

/** Retain the actual group instance, transform, locks, identity and stacking order. */
export function updateDataGroup(group: Group, input: DataConfig): DataGroup {
  const before = readDataGroup(group);
  if (!before) throw new Error('Выберите диаграмму или таблицу с исходными данными');
  const id = (group as DataGroup).id || newId();
  const config = validateDataConfig({ ...input, width: before.width, height: before.height });
  const replacement = createDataGroup(config, id);
  replacement.set({
    left: group.left, top: group.top, originX: group.originX, originY: group.originY,
    scaleX: group.scaleX, scaleY: group.scaleY, angle: group.angle,
    skewX: group.skewX, skewY: group.skewY, flipX: group.flipX, flipY: group.flipY,
  });
  // removeAll converts generated children to canvas coordinates. add converts
  // them into this group's coordinates. FixedLayout keeps its frame unchanged.
  const children = replacement.removeAll();
  group.layoutManager.strategy = new FixedLayout();
  group.removeAll();
  group.add(...children);
  (group as DataGroup).formaData = config;
  (group as DataGroup).id = id;
  group.set('dirty', true);
  group.setCoords();
  replacement.dispose();
  return group as DataGroup;
}
