import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StaticCanvas } from "fabric";
import {
  ChevronLeft, ChevronRight, Clock3, Maximize, Minimize,
  Moon, StickyNote, X,
} from "lucide-react";
import "./presentation.css";

export type PresentationPage = {
  id: string;
  canvas: any;
  notes?: string;
  transition?: "none" | "fade" | "slide";
};

export type PresentationViewerProps = {
  pages: readonly PresentationPage[];
  width: number;
  height: number;
  title: string;
  onClose: () => void;
  initialIndex?: number;
};

function clampIndex(index: number, count: number) {
  return Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : 0, count - 1));
}

function elapsedTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remaining = seconds % 60;
  return [hours || null, String(minutes).padStart(2, "0"), String(remaining).padStart(2, "0")]
    .filter((part) => part !== null).join(":");
}

/** An independent renderer: the editable canvas and the original page stay untouched. */
function PresentationSlide({ page, width, height, index, direction }: {
  page: PresentationPage;
  width: number;
  height: number;
  index: number;
  direction: "forward" | "backward";
}) {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const container = host.current;
    const viewport = frame.current;
    if (!container || !viewport) return;
    let cancelled = false;
    let loaded = false;
    const controller = new AbortController();
    // A new DOM canvas for every lifetime also makes React StrictMode cleanup safe.
    const element = document.createElement("canvas");
    element.setAttribute("aria-hidden", "true");
    container.appendChild(element);
    const canvas = new StaticCanvas(element, {
      width: 1, height: 1, enableRetinaScaling: true, renderOnAddRemove: false,
    });
    const logicalWidth = Number.isFinite(width) && width > 0 ? width : 1920;
    const logicalHeight = Number.isFinite(height) && height > 0 ? height : 1080;
    const resize = () => {
      if (cancelled || !loaded) return;
      const availableWidth = Math.max(1, viewport.clientWidth - 32);
      const availableHeight = Math.max(1, viewport.clientHeight - 32);
      const scale = Math.min(availableWidth / logicalWidth, availableHeight / logicalHeight);
      canvas.setDimensions({
        width: Math.max(1, Math.round(logicalWidth * scale)),
        height: Math.max(1, Math.round(logicalHeight * scale)),
      });
      canvas.setViewportTransform([scale, 0, 0, scale, 0, 0]);
      canvas.requestRenderAll();
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(viewport);
    window.addEventListener("resize", resize);
    setRendering(true);
    setError("");
    void (async () => {
      try {
        // Fabric receives its own copy even if a renderer/plugin modifies the JSON.
        const source = typeof page.canvas === "string"
          ? page.canvas : JSON.parse(JSON.stringify(page.canvas ?? { objects: [] }));
        await canvas.loadFromJSON(source, undefined, { signal: controller.signal });
        if (cancelled) return;
        for (const object of canvas.getObjects()) object.set({ selectable: false, evented: false });
        loaded = true;
        resize();
        canvas.renderAll();
        setRendering(false);
      } catch {
        if (!cancelled) {
          setError("Не удалось отобразить слайд. Перейдите к следующему или закройте просмотр.");
          setRendering(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      element.remove();
      void canvas.dispose().catch(() => {});
    };
  }, [page.canvas, width, height]);

  const transition = page.transition === "fade" || page.transition === "slide" ? page.transition : "none";
  return <div className="forma-presentation__frame" ref={frame}>
    <div ref={host}
      className={`forma-presentation__artwork${!rendering && !error ? " forma-presentation__artwork--ready" : ""}`}
      data-transition={transition} data-direction={direction}
      role="img" aria-label={`Слайд ${index + 1}`} aria-busy={rendering}
      style={{ visibility: rendering || error ? "hidden" : "visible" }} />
    {rendering && <p className="forma-presentation__message" role="status">Загружаем слайд…</p>}
    {error && <p className="forma-presentation__message forma-presentation__message--error" role="alert">{error}</p>}
  </div>;
}

export default function PresentationViewer({
  pages, width, height, title, onClose, initialIndex = 0,
}: PresentationViewerProps) {
  const [index, setIndex] = useState(() => clampIndex(initialIndex, pages.length));
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [notesVisible, setNotesVisible] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const hintId = useId();
  const notesId = useId();
  const activeIndex = clampIndex(index, pages.length);
  const page = pages[activeIndex];
  useEffect(() => {
    setIndex((current) => clampIndex(current, pages.length));
  }, [pages.length]);
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const node = root.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node?.focus();
    const onFullscreen = () => {
      setFullscreen(document.fullscreenElement === node);
      setFullscreenError("");
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.body.style.overflow = previousOverflow;
      if (node && document.fullscreenElement === node) void document.exitFullscreen().catch(() => {});
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  function navigate(next: number) {
    const target = clampIndex(next, pages.length);
    setDirection(target < activeIndex ? "backward" : "forward");
    setIndex(target);
  }
  async function toggleFullscreen() {
    setFullscreenError("");
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
      else setFullscreenError("Полноэкранный режим недоступен в этом браузере.");
    } catch {
      setFullscreenError("Браузер не разрешил полноэкранный режим. Просмотр можно продолжить в этом окне.");
    }
  }

  return createPortal(<div ref={root} className="forma-presentation" tabIndex={-1}
    role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={hintId}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); closeRef.current(); return;
      }
      if (event.key === "Tab") {
        const controls = root.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], textarea, select, input, [tabindex='0']");
        if (!controls?.length) { event.preventDefault(); root.current?.focus(); return; }
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) {
          event.preventDefault(); first.focus();
        }
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      const isButton = !!target.closest("button");
      switch (event.key) {
        case "ArrowRight": case "ArrowDown": case "PageDown":
          event.preventDefault(); event.stopPropagation(); navigate(activeIndex + 1); break;
        case " ":
          // Space keeps its native activation behavior while a toolbar button has focus.
          if (!isButton) { event.preventDefault(); event.stopPropagation(); navigate(activeIndex + (event.shiftKey ? -1 : 1)); }
          break;
        case "ArrowLeft": case "ArrowUp": case "PageUp":
          event.preventDefault(); event.stopPropagation(); navigate(activeIndex - 1); break;
        case "Home": event.preventDefault(); event.stopPropagation(); navigate(0); break;
        case "End": event.preventDefault(); event.stopPropagation(); navigate(pages.length - 1); break;
        case "b": case "B": case "и": case "И":
          event.preventDefault(); event.stopPropagation(); setBlackout((value) => !value); break;
      }
    }}>
    <header className="forma-presentation__header">
      <div className="forma-presentation__heading">
        <span className="forma-presentation__eyebrow">ПРЕЗЕНТАЦИЯ</span>
        <h1 id={titleId}>{title || "Презентация"}</h1>
      </div>
      <div className="forma-presentation__elapsed" aria-label={`Время показа ${elapsedTime(elapsed)}`}>
        <Clock3 size={16} aria-hidden="true" /><time>{elapsedTime(elapsed)}</time>
      </div>
      <button type="button" className="forma-presentation__icon-button" onClick={onClose}
        aria-label="Закрыть презентацию" title="Закрыть (Esc)"><X size={21} aria-hidden="true" /></button>
    </header>
    <main className="forma-presentation__stage" aria-label="Область показа">
      <div className="forma-presentation__slides" aria-hidden={blackout}>
        {page ? <PresentationSlide key={`${page.id}-${activeIndex}`} page={page} width={width} height={height}
          index={activeIndex} direction={direction} />
          : <p className="forma-presentation__message" role="status">В презентации пока нет слайдов.</p>}
      </div>
      {blackout && <div className="forma-presentation__blackout" role="status">
        <span className="forma-presentation__sr-only">Чёрный экран включён. Нажмите B, чтобы вернуться к слайду.</span>
      </div>}
    </main>
    {notesVisible && <section className="forma-presentation__notes" id={notesId} aria-label="Заметки докладчика">
      <h2><StickyNote size={15} aria-hidden="true" />Заметки докладчика</h2>
      <p>{page?.notes?.trim() ? page.notes : "Для этого слайда нет заметок."}</p>
    </section>}
    {fullscreenError && <p className="forma-presentation__notice" role="status">{fullscreenError}</p>}
    <footer className="forma-presentation__footer">
      <nav className="forma-presentation__navigation" aria-label="Навигация по слайдам">
        <button type="button" className="forma-presentation__icon-button" onClick={() => navigate(activeIndex - 1)}
          disabled={!pages.length || activeIndex === 0} aria-label="Предыдущий слайд" title="Предыдущий слайд (←)">
          <ChevronLeft size={22} aria-hidden="true" /></button>
        <span className="forma-presentation__counter" aria-live="polite" aria-atomic="true">
          {pages.length ? `${activeIndex + 1} / ${pages.length}` : "0 / 0"}
        </span>
        <button type="button" className="forma-presentation__icon-button" onClick={() => navigate(activeIndex + 1)}
          disabled={!pages.length || activeIndex >= pages.length - 1} aria-label="Следующий слайд" title="Следующий слайд (→)">
          <ChevronRight size={22} aria-hidden="true" /></button>
      </nav>
      <p className="forma-presentation__hint" id={hintId}>← → слайды · Пробел — далее · B — чёрный экран · Esc — выход</p>
      <div className="forma-presentation__tools">
        <button type="button" className="forma-presentation__tool-button" aria-pressed={notesVisible}
          aria-controls={notesId} onClick={() => setNotesVisible((value) => !value)} title="Заметки докладчика">
          <StickyNote size={18} aria-hidden="true" /><span>Заметки</span></button>
        <button type="button" className="forma-presentation__tool-button" aria-pressed={blackout}
          onClick={() => setBlackout((value) => !value)} title="Чёрный экран (B)">
          <Moon size={18} aria-hidden="true" /><span>Экран</span></button>
        <button type="button" className="forma-presentation__icon-button" aria-pressed={fullscreen}
          onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Выйти из полноэкранного режима" : "На весь экран"}
          title={fullscreen ? "Выйти из полноэкранного режима" : "На весь экран"}>
          {fullscreen ? <Minimize size={19} aria-hidden="true" /> : <Maximize size={19} aria-hidden="true" />}</button>
      </div>
    </footer>
  </div>, document.body);
}
