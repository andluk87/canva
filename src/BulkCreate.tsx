import { useEffect, useMemo, useState, useRef } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api, json, type Project } from './api';
import { Modal } from './ui';
import { CSV_LIMITS, parseCSV, documentVariables, textVariables, replaceVariables, personalizeDocument } from '../shared/csv.mjs';
import './BulkCreate.css';
import DesignPreview from './export/DesignPreview';
import {exportBatch,saveDownload} from './export/render';

type Props = {
  projectId: string;
  onClose: () => void;
  onCreated: (projects: any[]) => void;
  toast?: (message: string) => void;
};

export default function BulkCreate({ projectId, onClose, onCreated, toast }: Props) {
  const [mode,setMode]=useState<'projects'|'pages'>('projects'),[combinedTitle,setCombinedTitle]=useState(''),[previewRow,setPreviewRow]=useState(0),[previewPage,setPreviewPage]=useState(0),[archiveFormat,setArchiveFormat]=useState<'png'|'jpg'|'svg'|'json'>('png'),[archiving,setArchiving]=useState(false),[archiveProgress,setArchiveProgress]=useState('');
  const archiveTask=useRef<AbortController|null>(null),lifetime=useRef(0);
  useEffect(()=>{lifetime.current++;return()=>{lifetime.current++;archiveTask.current?.abort()}},[]);
  const [source, setSource] = useState<Project | null>(null);
  const [csv, setCSV] = useState('');
  const [titlePattern, setTitlePattern] = useState('');
  const [loadError, setLoadError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [created, setCreated] = useState<Project[]>([]);
  useEffect(() => {
    let active = true;
    setLoadError('');
    setSource(null);
    api<{ project: Project }>('/projects/' + encodeURIComponent(projectId))
      .then(({ project }) => { if (active) setSource(project); })
      .catch((error: Error) => { if (active) setLoadError(error.message); });
    return () => { active = false; };
  }, [projectId, retry]);
  const sourceVariables = useMemo(() => {
    try { return source ? documentVariables(source.document) : []; }
    catch { return []; }
  }, [source]);
  const preview = useMemo(() => {
    if (!csv.trim()) return { parsed: null, error: '' };
    try { return { parsed: parseCSV(csv), error: '' }; }
    catch (error) { return { parsed: null, error: (error as Error).message }; }
  }, [csv]);
  const variables = [...new Set([...sourceVariables, ...textVariables(mode==='projects'?titlePattern:'')])];
  const missing = preview.parsed ? variables.filter((v) => !preview.parsed!.headers.includes(v)) : [];
  let titleError = '';
  if (preview.parsed && titlePattern&&mode==='projects') {
    try {
      const invalid = preview.parsed.rows.findIndex((row) => {
        const title = replaceVariables(titlePattern, row).trim();
        return !title || title.length > 200;
      });
      if (invalid >= 0) titleError = `Строка ${invalid + 2}: название должно содержать от 1 до 200 символов`;
    } catch (error) { titleError = (error as Error).message; }
  }
  const pageError=mode==='pages'&&source&&preview.parsed&&source.document.pages.length*preview.parsed.rows.length>100?'Один проект может содержать до 100 страниц. Уменьшите число строк или страниц исходника.':'';
  const inputError = pageError||preview.error || (missing.length ? 'В CSV отсутствуют столбцы: ' + missing.join(', ') : '') || titleError;
  const error = requestError || inputError;
  const ready = !!source && !!preview.parsed && !inputError && !busy && source.role !== 'viewer';
  async function importFile(file?: File) {
    if (!file) return;
    setRequestError('');
    if (file.size > CSV_LIMITS.bytes) { setRequestError('CSV слишком большой: максимум 1 МБ'); return; }
    try { setCSV(await file.text()); }
    catch { setRequestError('Не удалось прочитать файл. Сохраните его как CSV UTF-8 и повторите.'); }
  }
  function downloadExample() {
    const columns = sourceVariables.length ? sourceVariables : ['имя', 'город'];
    const escaped = (text: string) => '"' + text.replaceAll('"', '""') + '"';
    const sample = '\uFEFF' + [columns.map(escaped).join(','), columns.map((_, i) => escaped(i ? 'Москва' : 'Анна')).join(','), columns.map((_, i) => escaped(i ? 'Казань' : 'Иван')).join(',')].join('\r\n');
    const url = URL.createObjectURL(new Blob([sample], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'forma-bulk-example.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function generate() {
    if (!ready) return;
    const ticket=lifetime.current;setBusy(true); setRequestError('');
    try {
      const result = await api<{ projects: Project[] }>('/projects/' + encodeURIComponent(projectId) + '/bulk', json({ csv, ...(mode==='projects'&&titlePattern ? { titlePattern } : {}),...(mode==='pages'&&combinedTitle.trim()?{title:combinedTitle.trim()}:{}),mode }));
      if(ticket!==lifetime.current)return;
      setCreated(result.projects);
      toast?.(`Создано дизайнов: ${result.projects.length}`);
      onCreated(result.projects);
    } catch (error) { setRequestError((error as Error).message); }
    finally { setBusy(false); }
  }
  const personalized=useMemo(()=>{if(!source||!preview.parsed||inputError)return null;try{return personalizeDocument(source.document,preview.parsed.rows[Math.min(previewRow,preview.parsed.rows.length-1)])}catch{return null}},[source,preview.parsed,inputError,previewRow]);
  async function archive(){const task=new AbortController();archiveTask.current=task;setArchiving(true);setRequestError('');try{const blob=await exportBatch(created,archiveFormat,{signal:task.signal,onProgress:(done,total)=>setArchiveProgress(`Подготовлено страниц: ${done} из ${total}`)});if(!task.signal.aborted)saveDownload(blob,'forma-bulk.zip')}catch(e){if(!task.signal.aborted)setRequestError((e as Error).message)}finally{if(!task.signal.aborted)setArchiving(false)}}
  return <Modal title="Массовое создание" onClose={() => { if (!busy) onClose(); }}>
    <div className="bulk-create" aria-busy={busy}>
      <div className="bulk-intro"><span className="bulk-icon"><FileSpreadsheet size={25} /></span><div><strong>Один дизайн — много персональных версий</strong><p>Добавьте в текст переменные, например {'{{имя}}'}, загрузите таблицу и выберите отдельные проекты или страницы одного нового проекта.</p></div></div>
      {loadError ? <div role="alert" className="bulk-error">{loadError} <button type="button" onClick={() => setRetry((n) => n + 1)}>Повторить</button></div> : !source ? <p role="status">Загружаем исходный дизайн…</p> : <>
        <div className="bulk-source"><span>Исходный дизайн</span><strong>{source.title}</strong><small>{source.document.pages.length} стр. · {source.width} × {source.height} px</small></div>
        {source.role === 'viewer' && <p role="alert" className="bulk-error">Для массового создания нужен доступ редактора или владельца.</p>}
        <div className="bulk-variables"><strong>Переменные в дизайне</strong>{sourceVariables.length ? <div>{sourceVariables.map((name) => <code key={name}>{'{{' + name + '}}'}</code>)}</div> : <p>Переменных пока нет. Будут созданы точные копии. Для персонализации добавьте {'{{имя}}'} в текст дизайна.</p>}</div>
      </>}
      {!created.length ? <>
        <label className="bulk-label">Результат генерации<select aria-label="Результат генерации" value={mode} disabled={busy} onChange={e=>{setMode(e.target.value as 'projects'|'pages');setRequestError('')}}><option value="projects">Отдельный проект для каждой строки</option><option value="pages">Все строки — страницы одного проекта</option></select></label>
        {mode==='pages'&&<label className="bulk-label">Название общего проекта<input aria-label="Название общего проекта" value={combinedTitle} maxLength={200} placeholder={source?source.title+' — страницы':''} disabled={busy} onChange={e=>setCombinedTitle(e.target.value)}/><p className="bulk-help">Для каждой строки копируются все страницы источника; исходник не изменяется. До 100 страниц суммарно.</p></label>}

        <div className="bulk-file-actions"><label className="bulk-file-button"><Upload size={16} />Загрузить CSV<input aria-label="Загрузить CSV" type="file" accept=".csv,text/csv,text/plain" disabled={busy} onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></label><button type="button" className="bulk-example" onClick={downloadExample}><Download size={16} />Скачать пример</button></div>
        <label className="bulk-label">Данные CSV<textarea aria-label="Данные CSV" placeholder={'имя,город\nАнна,Москва\nИван,Казань'} value={csv} disabled={busy} onChange={(e) => { setCSV(e.target.value); setRequestError(''); }} spellCheck={false} /></label>
        <p className="bulk-help">CSV UTF-8, до 50 строк и 1 МБ. Разделители: запятая или точка с запятой. Названия столбцов должны совпадать с переменными.</p>
        {mode==='projects'&&<label className="bulk-label">Шаблон названий проектов<input aria-label="Шаблон названий проектов" placeholder={source ? source.title + ' — 1, 2, …' : 'Приглашение — {{имя}}'} value={titlePattern} maxLength={1000} disabled={busy} onChange={(e) => { setTitlePattern(e.target.value); setRequestError(''); }} /></label>}
        {mode==='projects'&&<p className="bulk-help">Необязательно. Можно использовать переменные из CSV, например «Приглашение — {'{{имя}}'}».</p>}
        {preview.parsed && <div className="bulk-preview"><div className="bulk-preview-title"><strong>Предпросмотр таблицы</strong><span>{preview.parsed.rows.length} дизайнов · разделитель {preview.parsed.delimiter === ';' ? 'точка с запятой' : 'запятая'}</span></div><div className="bulk-table-scroll"><table><thead><tr><th scope="col">№</th>{preview.parsed.headers.map((name) => <th scope="col" key={name}>{name}{variables.includes(name) && <span title="Используется в дизайне или названии"> ●</span>}</th>)}</tr></thead><tbody>{preview.parsed.rows.slice(0, 5).map((row, i) => <tr key={i}><th scope="row">{i + 1}</th>{preview.parsed!.headers.map((name) => <td key={name}>{row[name] || <span className="bulk-empty">пусто</span>}</td>)}</tr>)}</tbody></table></div>{preview.parsed.rows.length > 5 && <p className="bulk-help">Показаны первые 5 из {preview.parsed.rows.length} строк.</p>}</div>}
        {personalized&&source&&<section className="bulk-render-preview"><header><label>Строка предпросмотра<select aria-label="Строка предпросмотра" value={Math.min(previewRow,(preview.parsed?.rows.length||1)-1)} onChange={e=>setPreviewRow(Number(e.target.value))}>{preview.parsed?.rows.map((_,i)=><option key={i} value={i}>{i+1}</option>)}</select></label><label>Страница предпросмотра<select aria-label="Страница предпросмотра" value={Math.min(previewPage,personalized.pages.length-1)} onChange={e=>setPreviewPage(Number(e.target.value))}>{personalized.pages.map((_,i)=><option key={i} value={i}>{i+1}</option>)}</select></label></header><DesignPreview key={previewRow+'-'+previewPage} page={personalized.pages[Math.min(previewPage,personalized.pages.length-1)]} width={source.width} height={source.height}/></section>}
        {error && <p role="alert" className="bulk-error">{error}</p>}
        <div className="bulk-footer"><span>Исходный проект сохранится. Доступ участников не копируется.</span><button type="button" className="primary" disabled={!ready} onClick={() => void generate()}>{busy ? 'Создаём дизайны…' : mode==='pages'?`Создать проект${preview.parsed&&source?' ('+preview.parsed.rows.length*source.document.pages.length+' стр.)':''}`:`Создать дизайны${preview.parsed ? ' (' + preview.parsed.rows.length + ')' : ''}`} </button></div>
      </> : <div className="bulk-results" role="status"><h3>Готово: {mode==='pages'?created[0].document.pages.length+' страниц':created.length+' дизайнов'}</h3><p>Новые проекты находятся в разделе «Мои проекты».</p><ul>{created.map((p) => <li key={p.id}><a href={'/?project=' + encodeURIComponent(p.id)}>{p.title}</a></li>)}</ul><div className="bulk-zip-controls"><select aria-label="Формат массового экспорта" value={archiveFormat} disabled={archiving} onChange={e=>setArchiveFormat(e.target.value as typeof archiveFormat)}><option value="png">PNG</option><option value="jpg">JPG</option><option value="svg">SVG</option><option value="json">JSON</option></select><button className="secondary" type="button" disabled={archiving} onClick={()=>void archive()}>Скачать результаты ZIP</button></div>{archiving&&<p role="status">{archiveProgress||'Готовим архив…'}</p>}{requestError&&<p role="alert" className="bulk-error">{requestError}</p>}<button type="button" className="primary" onClick={onClose}>Готово</button></div>}
    </div>
  </Modal>;
}
