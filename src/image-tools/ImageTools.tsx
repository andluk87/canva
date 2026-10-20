import { useEffect, useRef, useState } from "react";
import { Canvas, FabricImage, FabricObject } from "fabric";
import { Circle, Crop, FlipHorizontal2, FlipVertical2, Image, RotateCcw, Scan, RectangleHorizontal } from "lucide-react";
import {
  type CropPreset, type CropRegion, type ImageDimensions,
  applyImageCrop, applyImageMask, centerCrop, flipImage, imageCrop, imageMask,
  presetCrop, resetImageCrop, sourceDimensions, validateCrop,
} from "./operations";
import "./image-tools.css";

export type ImageToolsProps = {
  canvas: Canvas;
  selected: FabricObject | null;
  readOnly: boolean;
  onChange: () => void;
  toast: (message: string) => void;
  tick?: number;
};
type CropDraft = Record<keyof CropRegion, string>;
const draftOf = (crop: CropRegion): CropDraft => ({ x: String(crop.x), y: String(crop.y), width: String(crop.width), height: String(crop.height) });
function readDraft(draft: CropDraft) {
  if (Object.values(draft).some((value) => !value.trim())) throw new Error("Заполните все четыре поля кадра");
  return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Number(value)])) as CropRegion;
}
const empty: CropDraft = { x: "0", y: "0", width: "1", height: "1" };

export default function ImageTools({ canvas, selected, readOnly, onChange, toast, tick }: ImageToolsProps) {
  const image = selected instanceof FabricImage ? selected : null;
  const [draft, setDraft] = useState<CropDraft>(empty);
  const [preset, setPreset] = useState("free");
  const [radius, setRadius] = useState("24");
  const [version, setVersion] = useState(0);
  const last = useRef<{ image: FabricImage | null; crop: string }>({ image: null, crop: "" });
  useEffect(() => {
    const crop = image ? imageCrop(image) : null;
    const key = JSON.stringify(crop);
    if (last.current.image !== image || last.current.crop !== key) {
      setDraft(crop ? draftOf(crop) : empty);
      setPreset("free");
    }
    if (image) {
      const mask = imageMask(image);
      if (mask.kind === "rounded") setRadius(String(mask.radius));
    }
    last.current = { image, crop: key };
  }, [image, tick, version]);

  if (!image) return <div className="image-tools" data-testid="image-tools"><div className="image-tools-empty"><Image size={29} /><h4>Выберите фотографию</h4><p>Добавьте изображение из загрузок или выберите его на холсте. Здесь можно обрезать оригинал, добавить маску и отразить изображение.</p></div></div>;
  let source: ImageDimensions;
  try { source = sourceDimensions(image); } catch (error) {
    return <div className="image-tools" data-testid="image-tools"><p role="alert">{(error as Error).message}</p></div>;
  }
  const current = imageCrop(image), mask = imageMask(image);
  let parsed: CropRegion | null = null, error = "";
  try { parsed = readDraft(draft); validateCrop(parsed, source); } catch (caught) { error = (caught as Error).message; }
  const unchanged = parsed && parsed.x === current.x && parsed.y === current.y && parsed.width === current.width && parsed.height === current.height;
  const cropped = current.x !== 0 || current.y !== 0 || current.width !== source.width || current.height !== source.height;
  const radiusNumber = Number(radius);
  const validRadius = radius.trim() !== "" && Number.isFinite(radiusNumber) && radiusNumber >= 0 && radiusNumber <= Math.min(image.width, image.height) / 2;
  const stretched = Math.abs(image.scaleX - image.scaleY) > .001;
  const preview = parsed && !error ? parsed : current;

  function perform(action: () => boolean | void) {
    if (readOnly) return;
    try {
      const changed = action();
      if (changed === false) return;
      image!.setCoords();
      canvas.requestRenderAll();
      onChange();
      setVersion((value) => value + 1);
    } catch (caught) { toast((caught as Error).message); }
  }
  function changeDraft(key: keyof CropDraft, value: string) {
    setPreset("free");
    setDraft((old) => ({ ...old, [key]: value }));
  }
  function choosePreset(value: string) {
    setPreset(value);
    if (value === "free") return;
    try { setDraft(draftOf(presetCrop(source, value as CropPreset, parsed && !error ? parsed : current))); }
    catch (caught) { setPreset("free"); toast((caught as Error).message); }
  }
  return <div className="image-tools" data-testid="image-tools">
    <p className="image-tools-intro">Кадрирование и маски сохраняют исходный файл. Ненужные края скрываются, а не удаляются.</p>
    {readOnly && <p className="image-tools-warning">Изображение доступно только для просмотра.</p>}
    <div className="image-tools-preview" aria-label="Предпросмотр кадра на оригинале">
      <img src={image.getSrc()} alt="Исходное изображение" />
      <span className="image-tools-preview-crop" style={{ left: `${preview.x / source.width * 100}%`, top: `${preview.y / source.height * 100}%`, width: `${preview.width / source.width * 100}%`, height: `${preview.height / source.height * 100}%` }} />
    </div>
    <p className="image-tools-meta">Оригинал: <b>{source.width} × {source.height} px</b><br />Текущий кадр: {Math.round(image.width)} × {Math.round(image.height)} px</p>
    <section className="image-tools-section">
      <h4><Crop size={15} /> Кадрирование</h4>
      <fieldset disabled={readOnly}>
        <label>Пропорции кадра<select aria-label="Пропорции кадра" value={preset} onChange={(event) => choosePreset(event.target.value)}>
          <option value="free">Свободное</option><option value="1:1">1:1 — квадрат</option><option value="4:3">4:3 — фотография</option><option value="16:9">16:9 — широкий</option>
        </select></label>
        <div className="image-tools-grid">
          {([["x", "Кадр X"], ["y", "Кадр Y"], ["width", "Ширина кадра"], ["height", "Высота кадра"]] as const).map(([key, label]) => <label key={key}>{label}, px<input type="number" step="1" min={key === "x" || key === "y" ? 0 : 1} max={key === "x" || key === "width" ? source.width : source.height} aria-label={label} value={draft[key]} onChange={(event) => changeDraft(key, event.target.value)} /></label>)}
        </div>
        {error && <p className="image-tools-error" role="alert">{error}</p>}
        <button type="button" disabled={!!error || !parsed} onClick={() => {
          try { setDraft(draftOf(centerCrop(readDraft(draft), source))); } catch (caught) { toast((caught as Error).message); }
        }}><Scan size={15} /> Центрировать кадр</button>
        <button type="button" className="image-tools-primary" disabled={!!error || !parsed || !!unchanged} onClick={() => {
          if (!parsed || error) return;
          perform(() => applyImageCrop(image, parsed!));
        }}>Применить кадрирование</button>
        <button type="button" disabled={!cropped} onClick={() => perform(() => resetImageCrop(image))}><RotateCcw size={15} /> Сбросить кадрирование</button>
      </fieldset>
      <p className="image-tools-hint">Координаты заданы в пикселях оригинала до отражения. Центр, поворот и масштаб сохраняются; размер изображения на странице меняется вместе с кадром.</p>
      {stretched && <p className="image-tools-warning">Изображение уже растянуто по разным осям. Текущий масштаб сохранится; круглая маска на странице будет выглядеть овальной.</p>}
    </section>
    <section className="image-tools-section">
      <h4><Circle size={15} /> Маска</h4>
      <fieldset disabled={readOnly}>
        <div className="image-tools-masks">
          <button type="button" aria-pressed={mask.kind === "circle"} onClick={() => perform(() => applyImageMask(image, "circle"))}><Circle size={19} /> Круг</button>
          <button type="button" aria-pressed={mask.kind === "rounded"} onClick={() => perform(() => applyImageMask(image, "rounded", validRadius ? radiusNumber : Math.min(24, image.width / 2, image.height / 2)))}><RectangleHorizontal size={19} /> Скруглённая</button>
        </div>
        {mask.kind === "rounded" && <>
          <label>Радиус маски, px<input type="number" aria-label="Радиус маски" min="0" max={Math.min(image.width, image.height) / 2} step="1" value={radius} onChange={(event) => setRadius(event.target.value)} /></label>
          <button type="button" disabled={!validRadius || mask.radius === radiusNumber} onClick={() => perform(() => applyImageMask(image, "rounded", radiusNumber))}>Применить радиус</button>
        </>}
        {mask.kind === "custom" && <p className="image-tools-hint">У изображения есть другая маска. Выбор формы заменит её; отменить замену можно через Undo.</p>}
        <button type="button" disabled={mask.kind === "none"} onClick={() => perform(() => applyImageMask(image, "none"))}>Убрать маску</button>
      </fieldset>
      <p className="image-tools-hint">Круг вписан по меньшей стороне кадра. Маска скрывает края и не меняет исходный файл. Сброс кадрирования сохраняет выбранную форму маски.</p>
      <p className="image-tools-hint">Скрытые пиксели остаются в оригинале и публичном снимке. Для окончательного удаления скрытых частей используйте растровый экспорт страницы.</p>
    </section>
    <section className="image-tools-section">
      <h4>Отражение</h4>
      <fieldset disabled={readOnly} className="image-tools-grid">
        <button type="button" aria-label="Фото: отразить по горизонтали" aria-pressed={image.flipX} onClick={() => perform(() => flipImage(image, "horizontal"))}><FlipHorizontal2 size={18} /> По горизонтали</button>
        <button type="button" aria-label="Фото: отразить по вертикали" aria-pressed={image.flipY} onClick={() => perform(() => flipImage(image, "vertical"))}><FlipVertical2 size={18} /> По вертикали</button>
      </fieldset>
    </section>
  </div>;
}
