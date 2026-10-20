import { X } from "lucide-react";
import {useEffect,useRef} from 'react';
import type { Template } from "./templates";
let openDialogs=0;
let previousOverflow='';
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog=useRef<HTMLElement>(null);
  const close=useRef(onClose);close.current=onClose;
  const focusable=()=>Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')||[]).filter(element=>element.getClientRects().length>0&&!element.hidden);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    if(openDialogs++===0){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}
    const frame=requestAnimationFrame(()=>{const fields=focusable();(fields.find(element=>element.matches('input,textarea,select'))||fields[0]||dialog.current)?.focus();});
    return()=>{cancelAnimationFrame(frame);if(--openDialogs===0)document.body.style.overflow=previousOverflow;if(previous?.isConnected)previous.focus();};
  },[]);
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDownCapture={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close.current();}else if(e.key==='Tab'){const fields=focusable(),first=fields[0],last=fields.at(-1);if(!first){e.preventDefault();dialog.current?.focus();}else if(e.shiftKey&&(document.activeElement===first||!dialog.current?.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!dialog.current?.contains(document.activeElement))){e.preventDefault();first.focus();}}}}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialog}
        tabIndex={-1}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Artwork({ t }: { t: Template }) {
  return (
    <div
      className={"artwork " + t.style}
      style={{ background: t.bg, color: t.ink }}
    >
      <div className="art-orbit" style={{ background: t.accent }} />
      <small>FORMA / DESIGN STORIES</small>
      <strong>
        {t.headline.split("\n").map((s, i) => (
          <span key={i}>
            {s}
            <br />
          </span>
        ))}
      </strong>
      <p>{t.sub}</p>
      <span className="art-mark">✳︎</span>
    </div>
  );
}
