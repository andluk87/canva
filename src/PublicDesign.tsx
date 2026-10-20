import { useEffect, useRef, useState } from "react";
import { StaticCanvas } from "fabric";
import { ChevronLeft, ChevronRight, Globe } from "lucide-react";
import { api, type DesignPage } from "./api";
import "./publications.css";

type PublicSnapshot = {
  title: string; width: number; height: number; version: number;
  document: { pages: DesignPage[] };
};
export default function PublicDesign({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  const [page, setPage] = useState(0), [error, setError] = useState("");
  const [rendering, setRendering] = useState(false);
  const canvasEl = useRef<HTMLCanvasElement>(null), stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    setSnapshot(null); setPage(0); setError("");
    api<{ publication: PublicSnapshot }>(`/publications/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((data) => { if (!cancelled) setSnapshot(data.publication); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [token]);
  useEffect(() => {
    if (!snapshot || !canvasEl.current || !stage.current) return;
    let cancelled = false;
    setRendering(true);
    const canvas = new StaticCanvas(canvasEl.current, {
      width: snapshot.width, height: snapshot.height,
      enableRetinaScaling: true, renderOnAddRemove: false,
    });
    const resize = () => {
      if (cancelled || !stage.current) return;
      const scale = Math.min((stage.current.clientWidth - 32) / snapshot.width,
        Math.max(180, window.innerHeight - 220) / snapshot.height, 1);
      canvas.setDimensions({ width: Math.round(snapshot.width * scale), height: Math.round(snapshot.height * scale) });
      canvas.setZoom(scale); canvas.requestRenderAll();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage.current);
    window.addEventListener("resize", resize);
    void canvas.loadFromJSON(snapshot.document.pages[page].canvas).then(() => {
      if (cancelled) return;
      for (const object of canvas.getObjects()) object.set({ selectable: false, evented: false });
      resize(); setRendering(false);
    }).catch(() => { if (!cancelled) { setError("Не удалось отобразить опубликованный снимок"); setRendering(false); } });
    return () => {
      cancelled = true; observer.disconnect(); window.removeEventListener("resize", resize);
      void canvas.dispose();
    };
  }, [snapshot, page]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setPage((index) => Math.min(index + 1, (snapshot?.document.pages.length || 1) - 1));
      if (event.key === "ArrowLeft") setPage((index) => Math.max(index - 1, 0));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [snapshot]);
  return <main className="public-design">
    <header className="public-design-header"><a href="/" className="public-design-logo">FORMA<span>публичный просмотр</span></a>
      <div><Globe size={16} />Только просмотр</div></header>
    {error ? <section className="public-design-message" role="alert"><h1>Публикация недоступна</h1><p>{error}</p>
      <a href="/">На главную</a></section> : !snapshot
      ? <section className="public-design-message" role="status">Загружаем опубликованный дизайн…</section>
      : <>
        <div className="public-design-title"><h1>{snapshot.title}</h1><p>Опубликованный снимок · версия {snapshot.version}</p></div>
        <section className="public-design-stage" ref={stage} aria-label={`Страница ${page + 1} дизайна`}>
          <canvas key={`${token}-${snapshot.version}-${page}`} ref={canvasEl} aria-label={`Содержимое страницы ${page + 1}`} />
          {rendering && <span className="public-design-rendering" role="status">Отображаем страницу…</span>}
        </section>
        <nav className="public-design-pages" aria-label="Страницы публикации">
          <button aria-label="Предыдущая страница" disabled={page === 0 || rendering} onClick={() => setPage((index) => index - 1)}><ChevronLeft size={18} /></button>
          <span aria-live="polite">Страница {page + 1} из {snapshot.document.pages.length}</span>
          <button aria-label="Следующая страница" disabled={page >= snapshot.document.pages.length - 1 || rendering} onClick={() => setPage((index) => index + 1)}><ChevronRight size={18} /></button>
        </nav>
      </>}
  </main>;
}
