export const EXPORT_LIMITS = Object.freeze({ pages:100, edge:12000, pagePixels:36_000_000, totalPixels:100_000_000, bytes:100*1024*1024 });
export function exportName(title) {
  return String(title||'').normalize('NFC').replace(/[^\p{L}\p{N}_\- ]/gu,'').trim().slice(0,80)||'forma';
}
export function pageSelection(input,total,current=0) {
  if(!Number.isInteger(total)||total<1||total>EXPORT_LIMITS.pages||!Number.isInteger(current)||current<0||current>=total)throw new Error('Некорректное число страниц');
  if(input==='all')return Array.from({length:total},(_,i)=>i);
  if(input==='current')return[current];
  if(typeof input!=='string'||!input.trim()||input.length>500)throw new Error('Укажите страницы: например 1, 3–5');
  const result=new Set();
  for(const part of input.split(',')){
    const match=part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if(!match)throw new Error('Страницы: целые номера и диапазоны, например 1, 3–5');
    const start=Number(match[1]),end=Number(match[2]||match[1]);
    if(start<1||end>total||start>end)throw new Error(`Номера страниц должны быть от 1 до ${total}, диапазоны — по возрастанию`);
    for(let i=start;i<=end;i++)result.add(i-1);
  }
  return[...result];
}
export function exportOptions(input,design,current=0){
  if(!['png','jpg','svg','pdf','pptx','json'].includes(input.format))throw new Error('Неизвестный формат экспорта');
  if(![design.width,design.height].every(n=>Number.isInteger(n)&&n>=100&&n<=6000)||!Array.isArray(design.document?.pages))throw new Error('Некорректный размер документа');
  const indexes=pageSelection(input.selection,design.document.pages.length,current);
  const scale=input.scale??1,quality=input.quality??.95;
  if(typeof scale!=='number'||!Number.isFinite(scale)||scale<.1||scale>4)throw new Error('Масштаб должен быть от 0,1 до 4');
  if(typeof quality!=='number'||!Number.isFinite(quality)||quality<.1||quality>1)throw new Error('Качество JPG должно быть от 10 до 100%');
  if(input.transparent!==undefined&&typeof input.transparent!=='boolean')throw new Error('Некорректный прозрачный фон');
  if(input.zip!==undefined&&typeof input.zip!=='boolean')throw new Error('Некорректный режим архива');
  const width=Math.round(design.width*scale),height=Math.round(design.height*scale);
  if(['png','jpg','pdf'].includes(input.format))pixelBudget([{width,height,pages:indexes.length}]);
  return{format:input.format,indexes,scale,quality,transparent:!!input.transparent,zip:!!input.zip,width,height};
}
export function pixelBudget(items){
  let pages=0,pixels=0;
  for(const item of items){
    if(![item.width,item.height,item.pages].every(n=>Number.isInteger(n)&&n>0)||item.width>EXPORT_LIMITS.edge||item.height>EXPORT_LIMITS.edge||item.width*item.height>EXPORT_LIMITS.pagePixels)throw new Error('Одна страница экспорта: не более 12 000 px по стороне и 36 мегапикселей');
    pages+=item.pages;pixels+=item.width*item.height*item.pages;
  }
  if(pages>EXPORT_LIMITS.pages||pixels>EXPORT_LIMITS.totalPixels)throw new Error('Экспортируйте до 100 страниц и 100 мегапикселей суммарно за один раз');
}
