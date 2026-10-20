import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, FabricObject, Group } from 'fabric';
import { BarChart3, Download, FileUp, Table2 } from 'lucide-react';
import { dataCSV, parseDesignData, type ChartType, type DataConfig } from '../../shared/chart-data.mjs';
import { createDataGroup, readDataGroup, updateDataGroup } from './operations';
import './data-tools.css';

type Props = {
  canvas: Canvas; selected: FabricObject | null; readOnly: boolean;
  width: number; height: number; onChange: () => void;
  toast: (message: string) => void; tick?: number;
};
const example = 'Месяц,Продажи\nЯнварь,120\nФевраль,180\nМарт,95\nАпрель,240';
export default function DataTools({ canvas, selected, readOnly, width, height, onChange, toast, tick }: Props) {
  const [csv, setCSV] = useState(example);
  const [kind, setKind] = useState<DataConfig['kind']>('chart');
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [title, setTitle] = useState('Продажи по месяцам');
  const [palette, setPalette] = useState<DataConfig['palette']>('violet');
  const loaded = useRef('');
  const lifetime = useRef(new AbortController());
  const currentReadOnly = useRef(readOnly);
  currentReadOnly.current = readOnly;
  const current = readDataGroup(selected);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, [canvas]);
  useEffect(() => {
    const data = readDataGroup(selected);
    const key = data ? `${(selected as { id?: string }).id}:${JSON.stringify(data)}` : '';
    if (!key || !data) { loaded.current = ''; return; }
    if (key === loaded.current) return;
    loaded.current = key;
    setCSV(dataCSV(data)); setKind(data.kind); setChartType(data.chartType);
    setTitle(data.title); setPalette(data.palette);
  }, [selected, tick]);
  const parsed = useMemo(() => {
    try { return { data: parseDesignData(csv, kind, chartType), error: '' }; }
    catch (error) { return { data: null, error: (error as Error).message }; }
  }, [csv, kind, chartType]);
  function config(): DataConfig {
    if (!parsed.data) throw new Error(parsed.error);
    return {
      version: 1, kind, chartType, title, palette, ...parsed.data,
      width: current?.width || Math.max(360, Math.min(780, width * .84)),
      height: current?.height || Math.max(260, Math.min(520, height * .72)),
    };
  }
  function perform(update: boolean) {
    if (currentReadOnly.current) return;
    try {
      const source = config();
      if (update) {
        if (!(selected instanceof Group) || !readDataGroup(selected)) return;
        updateDataGroup(selected, source);
        canvas.setActiveObject(selected);
      } else {
        const group = createDataGroup(source);
        const scale = Math.min(1, width * .88 / source.width, height * .85 / source.height);
        group.set({ left: (width - source.width * scale) / 2, top: (height - source.height * scale) / 2, scaleX: scale, scaleY: scale });
        canvas.add(group); canvas.setActiveObject(group);
      }
      canvas.requestRenderAll();
      onChange();
      toast(update ? 'Данные выбранного объекта обновлены' : kind === 'table' ? 'Таблица добавлена на страницу' : 'Диаграмма добавлена на страницу');
    } catch (error) { toast((error as Error).message); }
  }
  function download() {
    // Export the saved backing data of the selected group. Draft edits are
    // exported only after applying them to prevent an ambiguous export.
    const source = readDataGroup(selected);
    if (!source) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF' + dataCSV(source)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = source.kind === 'table' ? 'forma-table.csv' : 'forma-chart.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="data-tools" data-testid="data-tools">
    <div className="data-tools-heading"><BarChart3 size={22} /><h3>Данные в дизайне</h3></div>
    <p className="data-tools-intro">Диаграммы и таблицы остаются векторными объектами. Выберите их на странице, чтобы изменить исходные данные.</p>
    {current && <p className="data-tools-selected" role="status">Выбрана {current.kind === 'table' ? 'таблица' : 'диаграмма'} · {current.rows.length} строк</p>}
    {readOnly && <p className="data-tools-notice">Сейчас доступен просмотр и экспорт данных выбранного объекта.</p>}
    <fieldset disabled={readOnly}>
      <label>Объект<select aria-label="Тип объекта данных" value={kind} onChange={(event) => setKind(event.target.value as DataConfig['kind'])}>
        <option value="chart">Диаграмма</option><option value="table">Таблица</option>
      </select></label>
      {kind === 'chart' && <label>Тип диаграммы<select aria-label="Тип диаграммы" value={chartType} onChange={(event) => setChartType(event.target.value as ChartType)}>
        <option value="bar">Столбчатая</option><option value="line">Линейная</option><option value="pie">Круговая</option>
      </select></label>}
      <label>Заголовок объекта<input aria-label="Заголовок объекта данных" type="text" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Палитра<select aria-label="Палитра данных" value={palette} onChange={(event) => setPalette(event.target.value as DataConfig['palette'])}>
        <option value="violet">Сирень</option><option value="ocean">Океан</option><option value="sunset">Закат</option>
      </select></label>
      <label className="data-tools-file"><FileUp size={16} /> Импортировать CSV
        <input type="file" aria-label="Файл данных CSV" accept=".csv,text/csv" onChange={async (event) => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          if (file.size > 100_000) { toast('CSV данных должен быть не больше 100 КБ'); return; }
          const signal = lifetime.current.signal;
          try {
            const content = await file.text();
            if (!signal.aborted && !currentReadOnly.current) setCSV(content);
          } catch { if (!signal.aborted) toast('Не удалось прочитать CSV'); }
        }} />
      </label>
      <label>Исходные данные CSV<textarea aria-label="Данные CSV" spellCheck={false} rows={9} value={csv} maxLength={100_000} onChange={(event) => setCSV(event.target.value)} /></label>
    </fieldset>
    <p className="data-tools-hint">Первая строка — заголовки. До 30 строк; разделитель — запятая или точка с запятой. {kind === 'chart' ? 'Ровно два столбца: подпись и число. Для круговой — до 12 положительных значений.' : 'До 8 столбцов. Ячейки с длинным текстом сокращаются на странице, полный текст сохраняется в CSV.'}</p>
    {parsed.error ? <p className="data-tools-error" role="alert">{parsed.error}</p> : <div className="data-tools-preview">
      <div><Table2 size={15} /> Предпросмотр: {parsed.data!.rows.length} строк × {parsed.data!.headers.length} столбцов</div>
      <div className="data-tools-preview-scroll"><table aria-label="Предпросмотр данных"><thead><tr>{parsed.data!.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{parsed.data!.rows.slice(0, 5).map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>
      {parsed.data!.rows.length > 5 && <small>Показаны первые 5 строк. В объект попадут все строки.</small>}
    </div>}
    <div className="data-tools-actions">
      {current && <button type="button" className="data-tools-primary" disabled={readOnly || !parsed.data} onClick={() => perform(true)}>Обновить выбранный объект</button>}
      <button type="button" className={current ? '' : 'data-tools-primary'} disabled={readOnly || !parsed.data} onClick={() => perform(false)}>{kind === 'table' ? 'Добавить таблицу' : 'Добавить диаграмму'}</button>
      {current && <button type="button" onClick={download}><Download size={16} /> Скачать данные CSV</button>}
    </div>
    <p className="data-tools-hint">При обновлении сохраняются положение, размер и порядок слоя. Формулы и XLSX здесь не поддерживаются.</p>
  </div>;
}
