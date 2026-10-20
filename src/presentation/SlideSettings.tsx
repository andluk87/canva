import { useId } from "react";
import { ArrowRight, StickyNote } from "lucide-react";
import type { PresentationPage } from "./PresentationViewer";
import "./presentation.css";

export type SlideSettingsProps = {
  page: PresentationPage;
  readOnly: boolean;
  onChange: (patch: { notes?: string; transition?: string }) => void;
};

export default function SlideSettings({ page, readOnly, onChange }: SlideSettingsProps) {
  const notesId = useId();
  const hintId = useId();
  const transitionId = useId();
  const notes = page.notes || "";
  const transition = page.transition === "fade" || page.transition === "slide" ? page.transition : "none";
  return <section className="forma-slide-settings" aria-label="Настройки слайда">
    <div className="forma-slide-settings__intro">
      <h3>Подготовьте выступление</h3>
      <p>Выберите переход и добавьте подсказки для текущего слайда.</p>
    </div>
    <label className="forma-slide-settings__label" htmlFor={transitionId}>
      <ArrowRight size={16} aria-hidden="true" />Переход к слайду
    </label>
    <select id={transitionId} value={transition} disabled={readOnly}
      onChange={(event) => { if (!readOnly) onChange({ transition: event.target.value }); }}>
      <option value="none">Без анимации</option>
      <option value="fade">Плавное появление</option>
      <option value="slide">Сдвиг</option>
    </select>
    <p className="forma-slide-settings__help">Переход работает при показе презентации. Настройка действует только на этот слайд.</p>
    <label className="forma-slide-settings__label" htmlFor={notesId}>
      <StickyNote size={16} aria-hidden="true" />Заметки докладчика
    </label>
    <textarea id={notesId} value={notes} maxLength={10000} rows={10} disabled={readOnly}
      aria-describedby={hintId} placeholder="Главная мысль, примеры и слова, которые важно не забыть…"
      onChange={(event) => { if (!readOnly) onChange({ notes: event.target.value.slice(0, 10000) }); }} />
    <div className="forma-slide-settings__notes-meta">
      <span id={hintId}>Заметки доступны в панели докладчика.</span>
      <span aria-label={`${notes.length} из 10000 символов`}>{notes.length.toLocaleString("ru-RU")} / 10 000</span>
    </div>
    {readOnly && <p className="forma-slide-settings__readonly">У вас доступ к просмотру. Изменять заметки и переходы могут редакторы проекта.</p>}
  </section>;
}
