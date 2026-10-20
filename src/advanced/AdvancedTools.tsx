import { useEffect, useRef, useState } from "react";
import { Canvas, Color, FabricImage, FabricObject, Gradient, Group, Line, Rect } from "fabric";
import {
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignCenterVertical,
  AlignEndVertical, Download, Upload, RotateCcw, SlidersHorizontal,
} from "lucide-react";
import {
  type Adjustments, type Alignment, type AlignmentTarget,
  alignObjects, applyAdjustments, applyGradient, applyShadow, applyStroke,
  distributeObjects, exportSVG, importSVG, neutralAdjustments, readAdjustments,
  roundCorners, saveBlob,
} from "./operations";
import "./advanced.css";

export type AdvancedToolsProps = {
  canvas: Canvas;
  selected: FabricObject | null;
  readOnly: boolean;
  onChange: () => void;
  toast: (message: string) => void;
  width: number;
  height: number;
  tick?: number;
};
function colorHex(color: unknown, fallback: string) {
  return typeof color === "string" && /^#[\da-f]{6}$/i.test(color) ? color : fallback;
}
function properties(object: FabricObject | null) {
  const shadow = object?.shadow;
  return {
    strokeColor: colorHex(object?.stroke, "#262638"),
    strokeWidth: object?.strokeWidth || 0,
    dashed: !!object?.strokeDashArray?.length,
    radius: object instanceof Rect ? object.rx : 0,
    shadow: !!shadow,
    shadowColor: shadow ? "#" + new Color(shadow.color).toHex() : "#242438",
    shadowOpacity: shadow ? Math.round(new Color(shadow.color).getAlpha() * 100) : 25,
    shadowBlur: shadow?.blur ?? 20,
    shadowX: shadow?.offsetX ?? 0,
    shadowY: shadow?.offsetY ?? 10,
    adjustments: object instanceof FabricImage ? readAdjustments(object) : { ...neutralAdjustments },
  };
}

export default function AdvancedTools(props: AdvancedToolsProps) {
  const { canvas, selected, readOnly, onChange, toast, width, height, tick } = props;
  const [state, setState] = useState(() => properties(selected));
  const [gradientStart, setGradientStart] = useState("#8561df");
  const [gradientEnd, setGradientEnd] = useState("#f6c3ce");
  const [gradientAngle, setGradientAngle] = useState(0);
  const [gradientType, setGradientType] = useState("linear");
  const [target, setTarget] = useState<AlignmentTarget>("page");
  const [svgText, setSVGText] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = useRef(props);
  latest.current = props;
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, [canvas]);
  useEffect(() => { setState(properties(selected)); }, [selected, tick]);
  useEffect(() => {
    if (selected?.fill instanceof Gradient) {
      setGradientStart(colorHex(selected.fill.colorStops[0]?.color, "#8561df"));
      setGradientEnd(colorHex(selected.fill.colorStops.at(-1)?.color, "#f6c3ce"));
      setGradientType(selected.fill.type);
      if (selected.fill.type === "linear") {
        const coords = selected.fill.coords;
        setGradientAngle(Math.round((Math.atan2(coords.y2 - coords.y1, coords.x2 - coords.x1) * 180 / Math.PI + 360) % 360));
      }
    }
  }, [selected]);
  const isSingle = !!selected && selected.type !== "activeselection";
  const isImage = selected instanceof FabricImage;
  const isGroup = selected instanceof Group;
  const count = canvas.getActiveObjects().filter((object) =>
    !object.lockMovementX && !object.lockMovementY && object.selectable,
  ).length;
  function perform(action: () => void) {
    if (latest.current.readOnly || busy) return;
    try {
      action();
      selected?.setCoords();
      canvas.requestRenderAll();
      onChange();
      setState(properties(canvas.getActiveObject() || null));
    } catch (error) {
      toast((error as Error).message);
    }
  }
  function adjust(patch: Partial<Adjustments>) {
    if (!isImage) return;
    const next = { ...readAdjustments(selected), ...patch };
    perform(() => applyAdjustments(selected, next));
  }
  function stroke(patch: Partial<Pick<typeof state, "strokeColor" | "strokeWidth" | "dashed">>) {
    if (!selected) return;
    const next = { ...state, ...patch };
    perform(() => applyStroke(selected, next.strokeColor, next.strokeWidth, next.dashed));
  }
  function shadow(patch: Partial<typeof state>) {
    if (!selected) return;
    const next = { ...state, ...patch };
    perform(() => applyShadow(selected, next.shadow ? {
      color: new Color(next.shadowColor).setAlpha(next.shadowOpacity / 100).toRgba(), blur: next.shadowBlur,
      offsetX: next.shadowX, offsetY: next.shadowY,
    } : null));
  }
  async function addSVG(source: string) {
    if (latest.current.readOnly || busy) return;
    setBusy(true);
    const signal = lifetime.current.signal;
    try {
      const object = await importSVG(source, width, height, signal);
      if (signal.aborted || latest.current.readOnly) return;
      canvas.add(object);
      canvas.setActiveObject(object);
      canvas.requestRenderAll();
      onChange();
      toast("Векторный SVG добавлен на страницу");
    } catch (error) {
      if (!signal.aborted) toast("Ошибка SVG: " + (error as Error).message);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  async function downloadSVG() {
    if (busy) return;
    setBusy(true);
    const signal = lifetime.current.signal;
    try {
      const source = await exportSVG(canvas, width, height);
      if (signal.aborted) return;
      saveBlob(source, "forma-page.svg", "image/svg+xml;charset=utf-8");
      toast("Текущая страница экспортирована в SVG");
    } catch (error) {
      if (!signal.aborted) toast("Ошибка экспорта SVG: " + (error as Error).message);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  const alignments: { value: Alignment; title: string; Icon: typeof AlignLeft }[] = [
    { value: "left", title: "Выровнять слева", Icon: AlignLeft },
    { value: "center", title: "Выровнять по центру горизонтали", Icon: AlignCenter },
    { value: "right", title: "Выровнять справа", Icon: AlignRight },
    { value: "top", title: "Выровнять сверху", Icon: AlignStartVertical },
    { value: "middle", title: "Выровнять по центру вертикали", Icon: AlignCenterVertical },
    { value: "bottom", title: "Выровнять снизу", Icon: AlignEndVertical },
  ];
  return (
    <div className="advanced-tools" data-testid="advanced-tools">
      <p className="advanced-intro">Точные настройки, эффекты и работа с вектором. Изменения сохраняются автоматически.</p>
      {readOnly && <p className="advanced-notice">Редактирование недоступно. Экспорт текущей страницы доступен ниже.</p>}
      <section className="advanced-section">
        <h4>Расположение</h4>
        <label>Выровнять относительно
          <select aria-label="Область выравнивания" value={target} onChange={(event) => setTarget(event.target.value as AlignmentTarget)}>
            <option value="page">Страницы</option>
            <option value="selection">Выделенных объектов</option>
          </select>
        </label>
        <fieldset disabled={readOnly || busy || !count || (target === "selection" && count < 2)}>
          <div className="advanced-alignments">{alignments.map(({ value, title, Icon }) => (
            <button key={value} type="button" aria-label={title} title={title}
              onClick={() => perform(() => { alignObjects(canvas, value, width, height, target); })}>
              <Icon size={19} />
            </button>
          ))}</div>
        </fieldset>
        <fieldset disabled={readOnly || busy || count < 3} className="advanced-distribute">
          <button type="button" onClick={() => perform(() => { distributeObjects(canvas, "horizontal"); })}>
            <AlignHorizontalDistributeCenter size={17} /> По горизонтали
          </button>
          <button type="button" onClick={() => perform(() => { distributeObjects(canvas, "vertical"); })}>
            <AlignVerticalDistributeCenter size={17} /> По вертикали
          </button>
        </fieldset>
        <p className="advanced-hint">Для распределения выделите от 3 объектов с Shift. Крайние объекты сохраняют позицию.</p>
      </section>
      {!isSingle && <div className="advanced-empty"><SlidersHorizontal size={22} /><span>Выберите один объект для настройки заливки, обводки и эффектов.</span></div>}
      {isSingle && (
        <>
          {isGroup && <p className="advanced-hint">Чтобы изменить заливку и обводку отдельных фигур группы, сначала разгруппируйте её (Ctrl+Shift+G).</p>}
          {!isImage && !isGroup && !(selected instanceof Line) && <section className="advanced-section">
            <h4>Градиентная заливка</h4>
            <fieldset disabled={readOnly || busy}>
              <div className="advanced-gradient-preview" style={{ background: gradientType === "radial"
                ? `radial-gradient(${gradientStart}, ${gradientEnd})` : `linear-gradient(${gradientAngle + 90}deg, ${gradientStart}, ${gradientEnd})` }} />
              <div className="advanced-row">
                <label>Первый цвет<input type="color" aria-label="Первый цвет градиента" value={gradientStart} onChange={(e) => setGradientStart(e.target.value)} /></label>
                <label>Второй цвет<input type="color" aria-label="Второй цвет градиента" value={gradientEnd} onChange={(e) => setGradientEnd(e.target.value)} /></label>
              </div>
              <label>Тип градиента<select aria-label="Тип градиента" value={gradientType} onChange={(e) => setGradientType(e.target.value)}>
                <option value="linear">Линейный</option><option value="radial">Радиальный</option>
              </select></label>
              {gradientType === "linear" && <label>Угол, °<input type="number" aria-label="Угол градиента" min="0" max="360" value={gradientAngle} onChange={(e) => setGradientAngle(Math.max(0, Math.min(360, Number(e.target.value))))} /></label>}
              <button type="button" className="advanced-primary" onClick={() => perform(() => applyGradient(selected, gradientStart, gradientEnd, gradientAngle, gradientType === "radial"))}>Применить градиент</button>
              {selected.fill instanceof Gradient && <button type="button" onClick={() => perform(() => selected.set("fill", gradientStart))}>Заменить сплошным цветом</button>}
            </fieldset>
          </section>}
          {!isGroup && <section className="advanced-section">
            <h4>Обводка{selected instanceof Rect ? " и углы" : ""}</h4>
            <fieldset disabled={readOnly || busy}>
              <div className="advanced-row">
                <label>Цвет обводки<input type="color" aria-label="Цвет обводки" value={state.strokeColor} onChange={(e) => stroke({ strokeColor: e.target.value })} /></label>
                <label>Толщина, px<input type="number" aria-label="Толщина обводки" min="0" max="100" value={state.strokeWidth} onChange={(e) => stroke({ strokeWidth: Number(e.target.value) })} /></label>
              </div>
              <label className="advanced-check"><input type="checkbox" checked={state.dashed} onChange={(e) => stroke({ dashed: e.target.checked })} /> Пунктирная обводка</label>
              {selected instanceof Rect && <label>Скругление углов, px<input type="number" aria-label="Скругление углов" min="0" max={Math.floor(Math.min(selected.width, selected.height) / 2)} value={state.radius} onChange={(e) => perform(() => roundCorners(selected, Number(e.target.value)))} /></label>}
            </fieldset>
          </section>}
          <section className="advanced-section">
            <h4>Тень</h4>
            <fieldset disabled={readOnly || busy}>
              <label className="advanced-check"><input type="checkbox" checked={state.shadow} onChange={(e) => shadow({ shadow: e.target.checked })} /> Включить тень</label>
              {state.shadow && <>
                <label>Непрозрачность тени, %<input type="number" aria-label="Непрозрачность тени" min="0" max="100" value={state.shadowOpacity} onChange={(e) => shadow({ shadowOpacity: Math.max(0, Math.min(100, Number(e.target.value))) })} /></label>
                <div className="advanced-row">
                  <label>Цвет тени<input type="color" aria-label="Цвет тени" value={state.shadowColor} onChange={(e) => shadow({ shadowColor: e.target.value })} /></label>
                  <label>Размытие, px<input type="number" aria-label="Размытие тени" min="0" max="200" value={state.shadowBlur} onChange={(e) => shadow({ shadowBlur: Number(e.target.value) })} /></label>
                </div>
                <div className="advanced-row">
                  <label>Смещение X<input type="number" aria-label="Смещение тени X" min="-500" max="500" value={state.shadowX} onChange={(e) => shadow({ shadowX: Number(e.target.value) })} /></label>
                  <label>Смещение Y<input type="number" aria-label="Смещение тени Y" min="-500" max="500" value={state.shadowY} onChange={(e) => shadow({ shadowY: Number(e.target.value) })} /></label>
                </div>
              </>}
            </fieldset>
          </section>
          {isImage && <section className="advanced-section">
            <h4>Коррекция изображения</h4>
            <fieldset disabled={readOnly || busy}>
              {([
                ["brightness", "Яркость", -100, 100],
                ["contrast", "Контраст", -100, 99],
                ["saturation", "Насыщенность", -100, 100],
                ["blur", "Размытие изображения", 0, 100],
              ] as const).map(([key, title, min, max]) => (
                <label key={key} className="advanced-slider">{title}<output>{Math.round(state.adjustments[key] * 100)}%</output>
                  <input type="range" aria-label={title} min={min} max={max} step="1" value={Math.round(state.adjustments[key] * 100)} onChange={(e) => adjust({ [key]: Number(e.target.value) / 100 })} />
                </label>
              ))}
              <label className="advanced-check"><input type="checkbox" checked={state.adjustments.grayscale} onChange={(e) => adjust({ grayscale: e.target.checked })} /> Чёрно-белое изображение</label>
              <label className="advanced-check"><input type="checkbox" checked={state.adjustments.sepia} onChange={(e) => adjust({ sepia: e.target.checked })} /> Сепия</label>
              <button type="button" onClick={() => adjust({ ...neutralAdjustments })}><RotateCcw size={15} /> Сбросить коррекцию</button>
            </fieldset>
            <p className="advanced-hint">Фильтры применяются к оригиналу и сохраняются в проекте. Исходный файл остаётся доступен в загрузках.</p>
          </section>}
        </>
      )}
      <section className="advanced-section">
        <h4>Вектор SVG</h4>
        <p className="advanced-hint">Импортируйте векторные фигуры, текст и градиенты. Внешние ресурсы, скрипты, HTML и встроенные изображения не поддерживаются.</p>
        <fieldset disabled={readOnly || busy}>
          <label className="advanced-file"><Upload size={16} /> Импортировать SVG
            <input aria-label="Файл SVG" type="file" accept=".svg,image/svg+xml" disabled={readOnly || busy} onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) { toast("SVG должен быть не больше 2 МБ"); return; }
              try { await addSVG(await file.text()); } catch (error) { toast((error as Error).message); }
            }} />
          </label>
          <details className="advanced-svg-code"><summary>Вставить SVG-код</summary>
            <textarea aria-label="Код SVG" rows={5} maxLength={2 * 1024 * 1024} placeholder={'<svg xmlns="http://www.w3.org/2000/svg"…'} value={svgText} onChange={(e) => setSVGText(e.target.value)} />
            <button type="button" disabled={!svgText.trim() || busy || readOnly} onClick={() => void addSVG(svgText)}>Добавить SVG на страницу</button>
          </details>
        </fieldset>
        <button type="button" disabled={busy} onClick={() => void downloadSVG()}><Download size={16} /> Скачать страницу SVG</button>
        {busy && <p role="status" className="advanced-hint">Обработка SVG…</p>}
      </section>
    </div>
  );
}
