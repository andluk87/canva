import {useEffect,useRef,useState} from 'react';
import {StaticCanvas} from 'fabric';
import type {DesignPage} from '../api';
import './export.css';
export default function DesignPreview({page,width,height}:{page:DesignPage;width:number;height:number}){
 const host=useRef<HTMLDivElement>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 useEffect(()=>{
  const root=host.current;if(!root)return;const element=document.createElement('canvas');root.appendChild(element);const controller=new AbortController();let active=true;
  const canvas=new StaticCanvas(element,{width:1,height:1,enableRetinaScaling:false,renderOnAddRemove:false});
  setBusy(true);setError('');const resize=()=>{if(!active)return;const scale=Math.min(Math.max(root.clientWidth-16,1)/width,240/height,1);canvas.setDimensions({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))});canvas.setZoom(scale);canvas.requestRenderAll()};
  const observer=new ResizeObserver(resize);observer.observe(root);
  void canvas.loadFromJSON(JSON.parse(JSON.stringify(page.canvas)),undefined,{signal:controller.signal}).then(()=>{if(active){resize();setBusy(false)}}).catch(()=>{if(active){setError('Не удалось отобразить ресурсы страницы');setBusy(false)}});
  return()=>{active=false;controller.abort();observer.disconnect();element.remove();void canvas.dispose()};
 },[page,width,height]);
 return <div className="design-preview" ref={host} role="img" aria-label="Предпросмотр персонального дизайна" aria-busy={busy}>{(error||busy)&&<span role="status">{error||'Подготавливаем дизайн…'}</span>}</div>
}
