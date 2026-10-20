import { useEffect, useRef, useState } from "react";
import { Check, Copy, FolderOpen, LayoutTemplate, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, json, type Project } from "./api";
import { Modal } from "./ui";
import "./PersonalTemplates.css";

type PersonalTemplate = { id: string; title: string; category: string; kind: string; width: number; height: number;
  thumbnail: string | null; pageCount: number; revision: number; created: string; updated: string };
type Library = { templates: PersonalTemplate[]; categories: string[]; usage: { count: number; storageBytes: number };
  limits: { maxTemplates: number; maxStorageBytes: number } };
const safePreview = (source: string | null) => !!source && source.length <= 1000000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source);

export default function PersonalTemplates({ projectId, beforeSave, readOnly = false, onCreated, toast }: {
  projectId?: string; beforeSave?: () => Promise<boolean>; readOnly?: boolean;
  onCreated: (project: Project) => void; toast: (message: string) => void;
}) {
  const [library, setLibrary] = useState<Library | null>(null), [sources, setSources] = useState<Project[]>([]);
  const [query, setQuery] = useState(""), [category, setCategory] = useState("__all__");
  const [selectedSource, setSelectedSource] = useState(projectId || ""), [title, setTitle] = useState(""), [newCategory, setNewCategory] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [editing, setEditing] = useState<PersonalTemplate | null>(null), [editTitle, setEditTitle] = useState(""), [editCategory, setEditCategory] = useState("");
  const [replaceSnapshot, setReplaceSnapshot] = useState(false), [removing, setRemoving] = useState<PersonalTemplate | null>(null);
  const [creating, setCreating] = useState<PersonalTemplate | null>(null), [designTitle, setDesignTitle] = useState("");
  const [dialogError, setDialogError] = useState("");
  const request = useRef(0), titleEdited = useRef(false), lifetime=useRef(0), mounted=useRef(false);
  useEffect(()=>{mounted.current=true;lifetime.current++;return()=>{mounted.current=false;lifetime.current++;request.current++;}},[]);
  const source = sources.find((project) => project.id === selectedSource);
  const canSave = !!selectedSource && !(readOnly && selectedSource === projectId) && (!source || source.role !== "viewer");
  async function load() {
    const sequence = ++request.current;
    const parameters = new URLSearchParams();
    if (query.trim()) parameters.set("q", query.trim());
    if (category !== "__all__") parameters.set("category", category);
    const data = await api<Library>("/personal-templates?" + parameters);
    if (sequence === request.current) setLibrary(data);
  }
  async function loadSources() {
    try {
      const result = await api<{ projects: Project[] }>("/projects");
      const projects = result.projects.filter((project) => !project.deleted && project.role !== "viewer");
      setSources(projects); setSourceError("");
      if (projectId && !titleEdited.current) setTitle(projects.find((project) => project.id === projectId)?.title || "Мой шаблон");
    } catch (failure) { setSourceError((failure as Error).message); }
  }
  useEffect(() => { void loadSources(); }, [projectId]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => { load().catch((failure) => { if (!cancelled) setError(failure.message); })
      .finally(() => { if (!cancelled) setLoading(false); }); }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, category]);
  useEffect(() => { setSelectedSource(projectId || ""); }, [projectId]);
  async function saveSource() {
    if (!canSave) throw new Error("Выберите доступный для редактирования исходный дизайн");
    if (selectedSource === projectId && beforeSave && !await beforeSave())
      throw new Error("Не удалось сохранить текущий дизайн. Проверьте соединение и повторите.");
  }
  async function action(key: string, operation: (current:()=>boolean) => Promise<void>, inDialog = false) {
    const generation=lifetime.current;const current=()=>mounted.current&&lifetime.current===generation;
    setBusy(key); (inDialog ? setDialogError : setError)("");
    try { await operation(current); }
    catch (failure) { if(current())(inDialog ? setDialogError : setError)((failure as Error).message); }
    finally { if(current())setBusy(""); }
  }
  const closeDialog = () => { if (!busy) { setEditing(null); setRemoving(null); setCreating(null); setDialogError(""); } };
  return <section className={"personal-templates" + (projectId ? " personal-templates-editor" : "")} aria-label="Библиотека личных шаблонов">
    <div className="personal-intro"><span className="personal-symbol"><LayoutTemplate size={23} /></span><div><h2>Личная библиотека</h2><p>Сохраните дизайн один раз и начинайте новые проекты со своего шаблона.</p></div></div>
    <details className="personal-save" open={projectId ? true : undefined}><summary><Plus size={16} /> Сохранить дизайн как шаблон</summary>
      <form onSubmit={(event) => { event.preventDefault(); void action("save", async () => {
        await saveSource();
        await api("/personal-templates", json({ projectId: selectedSource, title, category: newCategory }));
        await load(); toast("Личный шаблон сохранён");
      }); }}>
        {projectId ? <p className="personal-source-caption"><Check size={14} /> Исходник: {source?.title || "текущий дизайн"}</p> :
          <label>Исходный дизайн<select aria-label="Исходный дизайн для шаблона" value={selectedSource} onChange={(event) => {
            setSelectedSource(event.target.value); const next = sources.find((project) => project.id === event.target.value);
            if (next && !titleEdited.current) setTitle(next.title);
          }} required><option value="">Выберите сохранённый дизайн</option>{sources.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>}
        {sourceError && <p className="personal-error" role="alert">{sourceError} <button type="button" onClick={() => void loadSources()}>Повторить загрузку проектов</button></p>}
        {readOnly && projectId && <p className="personal-help">Для сохранения текущего дизайна нужен доступ редактора или владельца.</p>}
        <label>Название шаблона<input aria-label="Название шаблона" value={title} onChange={(event) => { titleEdited.current = true; setTitle(event.target.value); }} required maxLength={200} placeholder="Например, приглашение на встречу" /></label>
        <label>Категория<input aria-label="Категория шаблона" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} maxLength={60} placeholder="Например, приглашения" list="personal-template-categories" /></label>
        <datalist id="personal-template-categories">{library?.categories.filter(Boolean).map((value) => <option value={value} key={value} />)}</datalist>
        <p className="personal-help">Сохраняется отдельный снимок всех страниц. Дальнейшие изменения исходника не меняют шаблон.</p>
        <button type="submit" className="primary" disabled={!!busy || !canSave || !title.trim()}>{busy === "save" ? "Сохраняем…" : "Сохранить шаблон"}</button>
      </form>
    </details>
    <div className="personal-library-heading"><h3>Мои шаблоны {library && <span>{library.usage.count}</span>}</h3>
      <button className="personal-icon" aria-label="Обновить библиотеку шаблонов" disabled={!!busy} onClick={() => action("reload", async () => { await Promise.all([load(), loadSources()]); })}><RefreshCw size={16} /></button></div>
    <div className="personal-filters"><label className="personal-search"><Search size={16} /><input aria-label="Поиск личных шаблонов" placeholder="Найти шаблон" value={query} onChange={(event) => { setQuery(event.target.value); setError(""); }} maxLength={200} /></label>
      <select aria-label="Фильтр категории шаблонов" value={category} onChange={(event) => { setCategory(event.target.value); setError(""); }}><option value="__all__">Все категории</option>{library?.categories.map((value) => <option key={value} value={value}>{value || "Без категории"}</option>)}</select></div>
    {error && <p className="personal-error" role="alert">{error}</p>}
    {loading ? <p className="personal-empty" role="status">Загружаем библиотеку…</p> : library && !library.templates.length ? <div className="personal-empty"><FolderOpen size={32} /><h3>{query || category !== "__all__" ? "Шаблоны не найдены" : "Ваш первый шаблон — начало коллекции"}</h3><p>{query || category !== "__all__" ? "Измените поисковый запрос или категорию." : "Выберите дизайн в форме выше и сохраните его в библиотеку."}</p></div> :
      <div className="personal-grid">{library?.templates.map((template) => <article className="personal-card" key={template.id} data-template-id={template.id}>
        <div className="personal-preview" style={{ aspectRatio: Math.max(.7, Math.min(1.8, template.width / template.height)) }}>
          {safePreview(template.thumbnail) ? <img src={template.thumbnail!} alt={"Предпросмотр: " + template.title} loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <><span><LayoutTemplate size={32} /></span><b>{template.title}</b></>}
          <small>{template.pageCount} стр.</small></div>
        <div className="personal-card-content"><span className="personal-category">{template.category || "Без категории"}</span><h4 title={template.title}>{template.title}</h4><p>{template.width} × {template.height} px · версия {template.revision}</p>
          <div className="personal-card-actions"><button className="personal-use" onClick={() => { setCreating(template); setDesignTitle(template.title); setDialogError(""); }} disabled={!!busy}><Copy size={14} /> Использовать</button>
            <button className="personal-icon" aria-label={"Изменить шаблон «" + template.title + "»"} disabled={!!busy} onClick={() => { setEditing(template); setEditTitle(template.title); setEditCategory(template.category); setReplaceSnapshot(false); setDialogError(""); }}><Pencil size={15} /></button>
            <button className="personal-icon personal-delete" aria-label={"Удалить шаблон «" + template.title + "»"} disabled={!!busy} onClick={() => { setRemoving(template); setDialogError(""); }}><Trash2 size={15} /></button></div></div>
      </article>)}</div>}
    {library && <p className="personal-usage">{library.usage.count} из {library.limits.maxTemplates} шаблонов · {(library.usage.storageBytes / 1024 / 1024).toFixed(1)} из {Math.round(library.limits.maxStorageBytes / 1024 / 1024)} МБ</p>}
    {editing && <Modal title="Изменить личный шаблон" onClose={closeDialog}><form className="personal-dialog" onSubmit={(event) => { event.preventDefault(); void action("edit", async () => {
      if (replaceSnapshot) await saveSource();
      await api("/personal-templates/" + editing.id, json({ title: editTitle, category: editCategory, revision: editing.revision,
        ...(replaceSnapshot ? { projectId: selectedSource } : {}) }, "PATCH"));
      await load(); setEditing(null); toast("Личный шаблон обновлён");
    }, true); }}>
      <label>Название шаблона<input aria-label="Новое название шаблона" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required maxLength={200} /></label>
      <label>Категория<input aria-label="Новая категория шаблона" value={editCategory} onChange={(event) => setEditCategory(event.target.value)} maxLength={60} /></label>
      <label className="personal-checkbox"><input type="checkbox" checked={replaceSnapshot} disabled={!canSave || !!busy} onChange={(event) => setReplaceSnapshot(event.target.checked)} /> Обновить снимок из {projectId ? "текущего" : "выбранного"} дизайна</label>
      <p className="personal-help">{canSave ? "Будут заменены все страницы, размеры и предпросмотр шаблона. Созданные раньше проекты сохранят свои документы." : "Чтобы обновить страницы шаблона, выберите исходный дизайн в форме сохранения."}</p>
      {dialogError && <p className="personal-error" role="alert">{dialogError}</p>}<div className="personal-dialog-actions"><button className="personal-secondary" type="button" disabled={!!busy} onClick={closeDialog}>Отмена</button><button className="primary" disabled={!!busy}>{busy === "edit" ? "Сохраняем…" : "Сохранить изменения"}</button></div>
    </form></Modal>}
    {creating && <Modal title="Создать дизайн из шаблона" onClose={closeDialog}><form className="personal-dialog" onSubmit={(event) => { event.preventDefault(); void action("create", async (current) => {
      const result = await api<{ project: Project }>("/personal-templates/" + creating.id + "/instantiate", json({ title: designTitle }));
      if(!current())return;
      setCreating(null); onCreated(result.project); toast("Создан самостоятельный дизайн из шаблона");
    }, true); }}><p className="personal-dialog-description">Шаблон «{creating.title}» станет новым проектом в вашем пространстве.</p>
      <label>Название нового дизайна<input aria-label="Название нового дизайна" value={designTitle} onChange={(event) => setDesignTitle(event.target.value)} maxLength={200} required autoFocus /></label>
      {dialogError && <p className="personal-error" role="alert">{dialogError}</p>}<div className="personal-dialog-actions"><button type="button" className="personal-secondary" disabled={!!busy} onClick={closeDialog}>Отмена</button><button className="primary" disabled={!!busy}>{busy === "create" ? "Создаём…" : "Создать дизайн"}</button></div>
    </form></Modal>}
    {removing && <Modal title="Удалить личный шаблон?" onClose={closeDialog}><div className="personal-dialog"><p className="personal-dialog-description">Шаблон «{removing.title}» будет удалён из библиотеки. Исходный дизайн и уже созданные проекты сохранятся.</p>
      {dialogError && <p className="personal-error" role="alert">{dialogError}</p>}<div className="personal-dialog-actions"><button className="personal-secondary" disabled={!!busy} onClick={closeDialog}>Отмена</button><button className="personal-remove" disabled={!!busy} onClick={() => action("remove", async () => {
        await api("/personal-templates/" + removing.id, json({ revision: removing.revision }, "DELETE")); await load(); setRemoving(null); toast("Личный шаблон удалён");
      }, true)}>{busy === "remove" ? "Удаляем…" : "Удалить шаблон"}</button></div></div></Modal>}
  </section>;
}
