import { StaticCanvas } from 'fabric';
import type { DesignPage } from '../api';
import { EXPORT_LIMITS, exportName, exportOptions, pixelBudget, type ExportInput, type ExportSettings } from '../../shared/export-options.mjs';
export type ExportDesign={title:string;width:number;height:number;document:{pages:DesignPage[]}};
type Control={signal?:AbortSignal;onProgress?:(done:number,total:number)=>void};
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const stopped=(control:Control)=>{if(control.signal?.aborted)throw new Error('Экспорт отменён');};
function checked(blob:Blob){if(blob.size>EXPORT_LIMITS.bytes)throw new Error('Файл превышает 100 МБ. Выберите меньше страниц или меньший масштаб.');return blob;}
export function saveDownload(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function image(design:ExportDesign,page:DesignPage,settings:ExportSettings,control:Control):Promise<Blob>{
  stopped(control);await document.fonts?.ready;
  const canvas=new StaticCanvas(undefined,{width:settings.width,height:settings.height,enableRetinaScaling:false,renderOnAddRemove:false});
  try{
    await canvas.loadFromJSON(clone(page.canvas),undefined,{signal:control.signal});stopped(control);
    if(settings.transparent&&settings.format!=='jpg')canvas.backgroundColor='';
    canvas.setZoom(settings.scale);canvas.renderAll();
    if(settings.format==='svg')return checked(new Blob([canvas.toSVG({width:String(design.width),height:String(design.height),viewBox:{x:0,y:0,width:design.width,height:design.height}})],{type:'image/svg+xml'}));
    let element:HTMLCanvasElement=canvas.getElement();
    if(settings.format==='jpg'){
      const flattened=document.createElement('canvas');flattened.width=settings.width;flattened.height=settings.height;
      const context=flattened.getContext('2d');if(!context)throw new Error('Canvas недоступен');
      context.fillStyle='#ffffff';context.fillRect(0,0,flattened.width,flattened.height);context.drawImage(element,0,0);element=flattened;
    }
    return checked(await new Promise<Blob>((resolve,reject)=>element.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось сформировать изображение')),settings.format==='jpg'?'image/jpeg':'image/png',settings.quality)));
  }finally{await canvas.dispose();}
}
export async function exportDesign(design:ExportDesign,input:ExportInput,current=0,control:Control={}):Promise<{blob:Blob;name:string}>{
  const settings=exportOptions(input,design,current),name=exportName(design.title),pages=settings.indexes.map(index=>design.document.pages[index]);
  stopped(control);
  if(settings.format==='json')return{blob:checked(new Blob([JSON.stringify({schemaVersion:1,width:design.width,height:design.height,document:{pages}},null,2)],{type:'application/json'})),name:name+'.json'};
  if(settings.format==='pptx'){
    const {exportPptx}=await import('../presentation/exportPptx');const blob=checked(await exportPptx({pages:clone(pages),width:design.width,height:design.height,title:design.title}));stopped(control);return{blob,name:name+'.pptx'};
  }
  if(settings.format==='pdf'){
    const {jsPDF}=await import('jspdf');const orientation=design.width>design.height?'landscape':'portrait';
    const pdf=new jsPDF({orientation,unit:'px',format:[design.width,design.height],hotfixes:['px_scaling']});
    for(let i=0;i<pages.length;i++){
      const blob=await image(design,pages[i],{...settings,format:'png',transparent:false},control);stopped(control);
      if(i)pdf.addPage([design.width,design.height],orientation);
      pdf.addImage(new Uint8Array(await blob.arrayBuffer()),'PNG',0,0,design.width,design.height);
      control.onProgress?.(i+1,pages.length);
    }
    return{blob:checked(pdf.output('blob')),name:name+'.pdf'};
  }
  // SVG uses logical page coordinates rather than the bitmap export scale.
  const rasterSettings=settings.format==='svg'?{...settings,scale:1,width:design.width,height:design.height}:settings;
  if(pages.length===1&&!settings.zip){const blob=await image(design,pages[0],rasterSettings,control);stopped(control);return{blob,name:name+'.'+settings.format};}
  const {default:JSZip}=await import('jszip');const zip=new JSZip();let bytes=0;
  for(let i=0;i<pages.length;i++){
    const blob=await image(design,pages[i],rasterSettings,control);bytes+=blob.size;if(bytes>EXPORT_LIMITS.bytes)throw new Error('Архив превышает 100 МБ');
    zip.file(`${name}-${String(settings.indexes[i]+1).padStart(3,'0')}.${settings.format}`,await blob.arrayBuffer());control.onProgress?.(i+1,pages.length);stopped(control);
  }
  const blob=checked(await zip.generateAsync({type:'blob'}));stopped(control);return{blob,name:name+'.zip'};
}
export async function exportBatch(designs:ExportDesign[],format:'png'|'jpg'|'svg'|'json',control:Control={}):Promise<Blob>{
  if(!designs.length||designs.length>50)throw new Error('Выберите от 1 до 50 проектов');
  const count=designs.reduce((total,design)=>total+design.document.pages.length,0);
  if(count>EXPORT_LIMITS.pages)throw new Error('В одном архиве допустимо до 100 страниц');
  if(['png','jpg'].includes(format))pixelBudget(designs.map(d=>({width:d.width,height:d.height,pages:d.document.pages.length})));
  const {default:JSZip}=await import('jszip');const zip=new JSZip();let bytes=0,done=0;
  for(let i=0;i<designs.length;i++){
    const design=designs[i],folder=zip.folder(`${String(i+1).padStart(3,'0')}-${exportName(design.title)}`)!;
    if(format==='json'){
      const result=await exportDesign(design,{format,selection:'all'},0,control);bytes+=result.blob.size;if(bytes>EXPORT_LIMITS.bytes)throw new Error('Архив превышает 100 МБ');folder.file(result.name,await result.blob.arrayBuffer());done+=design.document.pages.length;control.onProgress?.(done,count);
    }else for(let index=0;index<design.document.pages.length;index++){
      const result=await exportDesign(design,{format,selection:String(index+1)},0,control);bytes+=result.blob.size;if(bytes>EXPORT_LIMITS.bytes)throw new Error('Архив превышает 100 МБ');folder.file(`page-${String(index+1).padStart(3,'0')}.${format}`,await result.blob.arrayBuffer());control.onProgress?.(++done,count);
    }
    stopped(control);
  }
  const blob=checked(await zip.generateAsync({type:'blob'}));stopped(control);return blob;
}
