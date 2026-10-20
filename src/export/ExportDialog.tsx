import {useEffect,useRef,useState} from 'react';
import {Download} from 'lucide-react';
import {Modal} from '../ui';
import {exportOptions,type ExportFormat,type ExportInput} from '../../shared/export-options.mjs';
import {exportDesign,saveDownload,type ExportDesign} from './render';
import './export.css';
export default function ExportDialog({design,current,onClose,toast}:{design:ExportDesign;current:number;onClose:()=>void;toast:(message:string)=>void}){
  const [format,setFormat]=useState<ExportFormat>('png'),[selection,setSelection]=useState('current'),[custom,setCustom]=useState('1');
  const [scale,setScale]=useState('1'),[quality,setQuality]=useState(95),[transparent,setTransparent]=useState(false),[zip,setZip]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('');
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const options:ExportInput={format,selection:selection==='custom'?custom:selection,scale:Number(scale),quality:quality/100,transparent,zip};
  let summary:ReturnType<typeof exportOptions>|null=null,validation='';
  try{summary=exportOptions(options,design,current)}catch(e){validation=(e as Error).message}
  const imageFormat=['png','jpg','svg'].includes(format),bitmap=['png','jpg','pdf'].includes(format);
  async function download(){
    if(!summary||busy)return;const task=new AbortController();controller.current=task;setBusy(true);setError('');setProgress('Готовим файл…');
    try{
      const result=await exportDesign(design,options,current,{signal:task.signal,onProgress:(done,total)=>setProgress(`Подготовлено страниц: ${done} из ${total}`)});
      if(task.signal.aborted)return;saveDownload(result.blob,result.name);toast('Файл экспортирован');onClose();
    }catch(e){if(!task.signal.aborted)setError((e as Error).message)}finally{if(!task.signal.aborted)setBusy(false)}
  }
  return <Modal title="Скачать дизайн" onClose={()=>{controller.current?.abort();onClose()}}><div className="export-options" aria-busy={busy}>
    <p className="muted">Выберите страницы и параметры. Несколько изображений скачиваются одним ZIP-архивом.</p>
    <label>Формат файла<select aria-label="Формат файла" value={format} disabled={busy} onChange={e=>{const next=e.target.value as ExportFormat;setFormat(next);setSelection(['pdf','pptx','json'].includes(next)?'all':'current');setError('')}}>
      <option value="png">PNG — изображение</option><option value="jpg">JPG — фотография</option><option value="svg">SVG — векторная страница</option><option value="pdf">PDF — растровые страницы</option><option value="pptx">PPTX — презентация</option><option value="json">JSON — редактируемый документ</option>
    </select></label>
    <label>Страницы<select aria-label="Страницы экспорта" value={selection} disabled={busy} onChange={e=>setSelection(e.target.value)}><option value="current">Текущая ({current+1})</option><option value="all">Все ({design.document.pages.length})</option><option value="custom">Указать номера</option></select></label>
    {selection==='custom'&&<label>Номера страниц<input aria-label="Номера страниц экспорта" value={custom} disabled={busy} placeholder="1, 3–5" maxLength={500} onChange={e=>setCustom(e.target.value)}/><small>Нумерация начинается с 1. Порядок сохранится; повторяющиеся номера учитываются один раз.</small></label>}
    {bitmap&&<label>Масштаб<input aria-label="Масштаб экспорта" type="number" min="0.1" max="4" step="0.1" value={scale} disabled={busy} onChange={e=>setScale(e.target.value)}/><small>От 0,1 до 4×. Для PDF меняется детализация изображения, размер страницы остаётся прежним.</small></label>}
    {format==='jpg'&&<label>Качество JPG: {quality}%<input aria-label="Качество JPG" type="range" min="10" max="100" value={quality} disabled={busy} onChange={e=>setQuality(Number(e.target.value))}/><small>Прозрачные области JPG заполняются белым.</small></label>}
    {['png','svg'].includes(format)&&<label className="export-check"><input type="checkbox" aria-label="Прозрачный фон" checked={transparent} disabled={busy} onChange={e=>setTransparent(e.target.checked)}/>Прозрачный фон<small>Убирает цвет страницы. Объекты и фоновые изображения сохраняются.</small></label>}
    {imageFormat&&<label className="export-check"><input type="checkbox" aria-label="Скачать архивом ZIP" checked={zip} disabled={busy} onChange={e=>setZip(e.target.checked)}/>Скачать архивом ZIP</label>}
    {summary&&<div className="export-summary"><span>{bitmap?summary.width:design.width} × {bitmap?summary.height:design.height} px</span><span>{summary.indexes.length} стр.{imageFormat&&(summary.zip||summary.indexes.length>1)?' · ZIP':''}</span></div>}
    {(error||validation)&&<p role="alert" className="error-box">{error||validation}</p>}
    {busy&&<p role="status">{progress}</p>}
    <button className="primary full" disabled={busy||!summary} onClick={()=>void download()}><Download size={18}/>{busy?'Готовим файл…':'Скачать'}</button>
    {busy&&<button className="secondary full" onClick={()=>{controller.current?.abort();onClose()}}>Отменить экспорт</button>}
  </div></Modal>
}
