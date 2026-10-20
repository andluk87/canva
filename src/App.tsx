import { useEffect, useState, useRef, lazy, Suspense } from "react";
import {
  Home,
  FolderOpen,
  LayoutTemplate,
  Palette,
  Image,
  Trash2,
  Plus,
  Search,
  ChevronDown,
  ArrowUpRight,
  MoreHorizontal,
  Star,
  LogOut,
  X,
  SlidersHorizontal,
  ArrowRight,
  Sparkles,
  Check,
  Menu,
  Users,
  Heart,
  Grid2X2,
  LogIn,
  Settings,
} from "lucide-react";
import { api, json, Project, User } from "./api";
import { formats, templates, Template, templateDocument } from "./templates";
const Editor = lazy(() => import("./Editor"));
import { Modal, Artwork } from "./ui";
import BrandLibrary from './brand/BrandLibrary';
import AccountSettings from './AccountSettings';
import PersonalTemplates from './PersonalTemplates';
import {clearUserData} from './offline/store.mjs';
import {cachedUser,rememberUser,forgetUser,signOutPending,clearSignOutPending,cacheProject,cachedProject,cachedProjects,cacheProjects} from './offline/cache';
const PublicDesign=lazy(()=>import('./PublicDesign'));
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [checked, setChecked] = useState(false),
    [section, setSection] = useState("Главная"),
    [projects, setProjects] = useState<Project[]>([]),
    [active, setActive] = useState<Project | null>(null),
    [auth, setAuth] = useState(false),
    [register, setRegister] = useState(true),
    [create, setCreate] = useState(false),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("Все шаблоны"),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [menu, setMenu] = useState<string | null>(null);
  const [online,setOnline]=useState(navigator.onLine);
  const identity=useRef({id:null as string|null,generation:0});
  const navigation=useRef(0);
  const logoutTask=useRef<Promise<void>>(Promise.resolve());
  function acceptUser(next:User|null){if(identity.current.id!==next?.id){identity.current={id:next?.id||null,generation:identity.current.generation+1};navigation.current++;}setUser(next);}
  const current=(ticket:typeof identity.current)=>identity.current===ticket;
  const publicToken=new URLSearchParams(location.search).get("view");
  const toast = (s: string) => {
    setNotice(s);
    setTimeout(() => setNotice(""), 4500);
  };
  const reload = async () => {
    const ticket=identity.current;if(!ticket.id)return;
    try {
      const data=(await api("/projects")).projects;if(!current(ticket))return;setProjects(data);void cacheProjects(ticket.id,data);
    } catch (e) {
      if(!current(ticket))return;
      if(!(e as any).status||(e as any).status>=500){const saved=await cachedProjects(ticket.id);if(current(ticket))setProjects(saved);}else toast((e as Error).message);
    }
  };
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);addEventListener('online',update);addEventListener('offline',update);return()=>{removeEventListener('online',update);removeEventListener('offline',update)}},[]);
  useEffect(()=>{const changed=(event:StorageEvent)=>{if(!event.key?.startsWith('forma.offline.'))return;const id=identity.current.id;if(id&&cachedUser()?.id!==id){acceptUser(null);setActive(null);setProjects([]);history.replaceState({},'', '/');void clearUserData(id).catch(()=>{});}};addEventListener('storage',changed);return()=>removeEventListener('storage',changed)},[]);
  useEffect(() => {
    if(publicToken){setChecked(true);return;}
    const ticket=identity.current;
    if(signOutPending()){logoutTask.current=api('/auth/logout',json({})).then(()=>clearSignOutPending()).catch(e=>{if(e.status===401)clearSignOutPending()}).finally(()=>setChecked(true));return;}
    api("/auth/me")
      .then((d) => {if(!current(ticket))return;rememberUser(d.user);acceptUser(d.user)})
      .catch((error) => {if(!current(ticket))return;if(!error.status||error.status>=500)acceptUser(cachedUser());else void forgetUser(cachedUser()?.id)})
      .finally(() => setChecked(true));
  }, []);
  useEffect(() => {
    if (user) {
      reload();
      const p = new URLSearchParams(location.search).get("project");
      if (p) open(p);
    } else setProjects([]);
  }, [user?.id]);
  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(location.search).get("project");
      if (p && user) open(p);
      else {navigation.current++;setActive(null);}
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [user]);
  async function open(id: string) {
    const ticket=identity.current,request=++navigation.current;if(!ticket.id)return;
    const valid=()=>current(ticket)&&request===navigation.current;
    try {
      const d = await api("/projects/" + id);if(!valid())return;
      await cacheProject(ticket.id,d.project);if(!valid())return;
      setActive(d.project);
      history.replaceState({}, "", "?project=" + id);
    } catch (e) {
      if(!valid())return;
      if(!(e as any).status||(e as any).status>=500){const saved=await cachedProject(ticket.id,id);if(!valid())return;if(saved?.document?.pages?.length){setActive(saved);history.replaceState({},'', '?project='+id);return;}toast('Нет локальной копии. Откройте этот проект при доступном интернете.');}
      else toast((e as Error).message);
    }
  }
  const requireUser = () => {
    if (!user) {
      setAuth(true);
      return false;
    }
    return true;
  };
  async function make(
    t?: Template,
    custom?: { title: string; width: number; height: number; kind: string },
  ) {
    if (!requireUser()) return;
    const ticket=identity.current;
    setBusy(true);
    try {
      const f = custom || {
        title: t?.title || "Новый дизайн",
        width: t?.w || 1080,
        height: t?.h || 1080,
        kind: "design",
      };
      const d = await api(
        "/projects",
        json({ ...f, ...(t ? { document: templateDocument(t) } : {}) }),
      );
      if(!current(ticket))return;
      setCreate(false);
      await cacheProject(ticket.id!,d.project);
      if(!current(ticket))return;
      setActive(d.project);
      history.pushState({}, "", "?project=" + d.project.id);
      await reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function patch(p: Project, b: any) {
    const ticket=identity.current;
    try {
      await api(
        "/projects/" + p.id,
        json({ revision: p.revision, ...b }, "PUT"),
      );
      if(!current(ticket))return;
      await reload();
      setMenu(null);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function copyProject(p: Project) {
    if (!requireUser()) return;
    const ticket=identity.current;
    try {
      const { project } = await api("/projects/" + p.id);
      if(!current(ticket))return;
      await api(
        "/projects",
        json({
          title: p.title + " — копия",
          width: p.width,
          height: p.height,
          kind: p.kind,
          document: project.document,
        }),
      );
      if(!current(ticket))return;
      await reload();
      setMenu(null);
      toast("Копия проекта создана");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function authenticate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const ticket=identity.current;
    try {
      await logoutTask.current;
      if(!current(ticket))return;
      const d = await api(
        "/auth/" + (register ? "register" : "login"),
        json(f),
      );
      if(!current(ticket))return;
      rememberUser(d.user);acceptUser(d.user);
      setAuth(false);
      toast("Добро пожаловать в Forma!");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const nav = [
    { name: "Главная", icon: Home },
    { name: "Проекты", icon: FolderOpen },
    { name: "Шаблоны", icon: LayoutTemplate },
    { name: "Мои шаблоны", icon: LayoutTemplate },
    { name: "Бренд", icon: Palette },
    { name: "Мои загрузки", icon: Image },
    { name: "Общие проекты", icon: Users },
    { name: "Настройки", icon: Settings },
  ];
  const go = (s: string) => {
    navigation.current++;
    setSection(s);
    setMobile(false);
    setQuery("");
  };
  const filtered = projects.filter(
    (p) =>
      (section === "Корзина" ? p.deleted : !p.deleted) &&
      (section !== "Избранное" || p.favorite) &&
      (section !== "Общие проекты" || p.role !== "owner") &&
      (p.title + " " + p.folder).toLowerCase().includes(query.toLowerCase()),
  );
  const shownTemplates = templates.filter(
    (t) =>
      (category === "Все шаблоны" || t.category === category) &&
      (t.title + " " + t.tag + " " + t.category)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  async function localLogout(){const id=identity.current.id;acceptUser(null);setActive(null);setProjects([]);history.replaceState({},'', '/');const clearing=forgetUser(id||undefined,true).catch(()=>{});logoutTask.current=api('/auth/logout',json({})).then(()=>clearSignOutPending()).catch(e=>{if(e.status===401)clearSignOutPending()});await Promise.all([clearing,logoutTask.current]);}
  const viewIdentity=identity.current,viewNavigation=navigation.current;
  const openCreated=(p:Project)=>{if(identity.current!==viewIdentity||navigation.current!==viewNavigation||!viewIdentity.id)return;navigation.current++;void cacheProject(viewIdentity.id,p);setActive(p);history.pushState({},'', '?project='+p.id);};
  if(publicToken)return <Suspense fallback={<div className="editor-loading">Открываем публикацию…</div>}><PublicDesign token={publicToken}/></Suspense>;
  if (active && user)
    return (
      <>
        <Suspense
          fallback={<div className="editor-loading">Открываем редактор…</div>}
        >
          <Editor
            key={active.id}
            project={active}
            user={user}
            toast={toast}
            onOpenProject={openCreated}
            onExit={() => {
              navigation.current++;
              setActive(null);
              history.pushState({}, "", "/");
              reload();
            }}
          />
        </Suspense>
        {notice && (
          <div className="toast">
            <Check size={18} />
            {notice}
          </div>
        )}
      </>
    );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobile ? "mobile-open" : "")}>
        <a
          className="logo"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("Главная");
          }}
        >
          <span className="logo-symbol">f</span>forma
          <span className="logo-dot">.</span>
        </a>
        <button
          className="workspace"
          onClick={() => (user ? go("Общие проекты") : setAuth(true))}
        >
          <span className="workspace-icon">
            {user?.name[0].toUpperCase() || "Л"}
          </span>
          <span>
            <b>{user ? user.name : "Личное пространство"}</b>
            <small>Бесплатный план</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <button
          className="primary create-button"
          onClick={() => {
            if (requireUser()) setCreate(true);
          }}
        >
          <Plus size={19} />
          Создать дизайн
        </button>
        <nav>
          {nav.map((n) => (
            <button
              key={n.name}
              className={section === n.name ? "selected" : ""}
              onClick={() => go(n.name)}
            >
              <n.icon size={19} />
              {n.name}
              {n.name === "Шаблоны" && <span className="new-badge">NEW</span>}
            </button>
          ))}
          <div className="nav-rule" />
          <button
            className={section === "Избранное" ? "selected" : ""}
            onClick={() => go("Избранное")}
          >
            <Heart size={19} />
            Избранное
          </button>
          <button
            className={section === "Корзина" ? "selected" : ""}
            onClick={() => go("Корзина")}
          >
            <Trash2 size={19} />
            Корзина
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="inspiration">
            <span>✦</span>
            <b>Дайте идеям форму</b>
            <p>
              Всё для вашего следующего
              <br />
              большого проекта.
            </p>
            <button onClick={() => go("Шаблоны")}>
              Найти вдохновение <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className="account"
            onClick={()=>user?void localLogout():setAuth(true)}
          >
            <span className="avatar">{user?.name[0].toUpperCase() || "Г"}</span>
            <span>
              <b>{user?.name || "Гость"}</b>
              <small>
                {user ? "Выйти из аккаунта" : "Войти или зарегистрироваться"}
              </small>
            </span>
            {user ? <LogOut size={16} /> : <LogIn size={16} />}
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            aria-label="Меню"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            Ваше пространство <span>/</span> <b>{section}</b>
          </div>
          <div className="top-actions">
            <span className="local-badge">
              <i /> Все идеи в одном месте
            </span>
            <button
              className="help"
              onClick={() =>
                toast(
                  "Создайте дизайн, добавьте текст или изображения и скачайте результат. Данные сохраняются в вашем аккаунте.",
                )
              }
            >
              ?
            </button>
            <button
              className="avatar"
              onClick={() => (user ? go("Проекты") : setAuth(true))}
            >
              {user?.name[0].toUpperCase() || "Г"}
            </button>
          </div>
        </header>
        {!online&&<div className="offline-banner" role="status">Нет подключения. Открытые ранее проекты доступны из локальной копии; правки сохраняются на устройстве и синхронизируются после подключения.</div>}
        <main>
          {section === "Главная" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="eyebrow">
                    <Sparkles size={14} /> МЕСТО, ГДЕ РОЖДАЮТСЯ ИДЕИ
                  </span>
                  <h1>
                    Что создадим
                    <br />
                    <em>сегодня?</em>
                  </h1>
                  <p>
                    От первой мысли до «вау». Ваш следующий
                    <br className="desktop-break" /> дизайн начинается здесь.
                  </p>
                  <div className="hero-search">
                    <Search size={20} />
                    <input
                      aria-label="Поиск шаблонов"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setSection("Шаблоны");
                      }}
                      placeholder="Попробуйте «презентация» или «постер»"
                    />
                    <button
                      aria-label="Найти"
                      onClick={() => setSection("Шаблоны")}
                    >
                      <ArrowRight size={19} />
                    </button>
                  </div>
                  <div className="hero-tags">
                    <span>Популярное:</span>
                    {["Презентации", "Соцсети", "Постеры"].map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setCategory(s);
                          go("Шаблоны");
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="hero-composition" aria-hidden="true">
                  <div className="sticker sticker-top">создавай смело ↗</div>
                  <div className="hero-card purple">
                    <span>
                      IDEAS
                      <br />
                      IN
                      <br />
                      <i>MOTION.</i>
                    </span>
                    <small>MAKE SOMETHING GREAT</small>
                    <div>✳︎</div>
                  </div>
                  <div className="hero-card green">
                    <span>
                      the art
                      <br />
                      of slow
                      <br />
                      <i>living.</i>
                    </span>
                    <div className="leaf leaf-a" />
                    <div className="leaf leaf-b" />
                    <small>FIND YOUR BALANCE</small>
                  </div>
                  <div className="hero-spark">✧</div>
                  <div className="sticker sticker-bottom">
                    <span>✦</span> немножко вашей магии
                  </div>
                </div>
              </section>
              <section className="formats-section">
                <div className="section-heading">
                  <h2>Начните с идеи</h2>
                  <button
                    className="text-button"
                    onClick={() => {
                      if (requireUser()) setCreate(true);
                    }}
                  >
                    Свой размер <Plus size={15} />
                  </button>
                </div>
                <div className="format-grid">
                  {formats.map((f) => (
                    <button
                      className="format-card"
                      key={f.kind}
                      onClick={() =>
                        make(undefined, {
                          title: f.name,
                          width: f.w,
                          height: f.h,
                          kind: f.kind,
                        })
                      }
                    >
                      <div style={{ background: f.color }}>
                        <span>{f.icon}</span>
                        <span className="format-plus">+</span>
                      </div>
                      <b>{f.name}</b>
                      <small>
                        {f.w} × {f.h} px
                      </small>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
          {[
            "Главная",
            "Проекты",
            "Избранное",
            "Корзина",
            "Общие проекты",
          ].includes(section) && (
            <section className="projects-section">
              <div className="section-heading">
                <div>
                  <h2>
                    {section === "Главная" ? "Недавние дизайны" : section}
                  </h2>
                  {section === "Главная" && (
                    <p>Продолжайте с того места, где остановились</p>
                  )}
                </div>
                {section === "Главная" ? (
                  <button className="text-button" onClick={() => go("Проекты")}>
                    Все проекты <ArrowRight size={16} />
                  </button>
                ) : (
                  <div className="small-search">
                    <Search size={17} />
                    <input
                      placeholder="Найти проект или папку"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                )}
              </div>
              {filtered.length ? (
                <div className="project-grid">
                  {filtered
                    .slice(0, section === "Главная" ? 4 : 100)
                    .map((p) => (
                      <article className="project-card" key={p.id}>
                        <button
                          className="project-cover"
                          onClick={() => !p.deleted && open(p.id)}
                        >
                          {p.thumbnail ? (
                            <img src={p.thumbnail} alt={p.title} />
                          ) : (
                            <div className="empty-preview">
                              <span>F</span>
                              <b>{p.title}</b>
                              <small>
                                {p.width} × {p.height}
                              </small>
                            </div>
                          )}
                          {p.favorite ? (
                            <span className="favorite-star">★</span>
                          ) : null}
                          <span className="project-type">
                            {p.kind === "presentation"
                              ? "Презентация"
                              : "Дизайн"}
                          </span>
                        </button>
                        <div className="project-details">
                          <div>
                            <h3>{p.title}</h3>
                            <p>
                              {p.folder ? p.folder + " · " : ""}
                              {new Date(p.updated).toLocaleDateString("ru-RU", {
                                day: "numeric",
                                month: "short",
                              })}{" "}
                              ·{" "}
                              {p.role === "owner"
                                ? "Ваш проект"
                                : p.role === "editor"
                                  ? "Редактор"
                                  : "Просмотр"}
                            </p>
                          </div>
                          <div className="project-menu">
                            <button
                              className="icon-button"
                              aria-label={"Действия: " + p.title}
                              onClick={() =>
                                setMenu(menu === p.id ? null : p.id)
                              }
                            >
                              <MoreHorizontal size={20} />
                            </button>
                            {menu === p.id && (
                              <div className="dropdown">
                                {!p.deleted ? (
                                  <>
                                    <button onClick={() => open(p.id)}>
                                      Открыть
                                    </button>
                                    <button onClick={() => copyProject(p)}>
                                      Создать копию
                                    </button>
                                    {p.role !== "viewer" && (
                                      <>
                                        <button
                                          onClick={() =>
                                            patch(p, { favorite: !p.favorite })
                                          }
                                        >
                                          {p.favorite
                                            ? "Убрать из избранного"
                                            : "В избранное"}
                                        </button>
                                        <button
                                          onClick={() => {
                                            const folder = prompt(
                                              "Название папки",
                                              p.folder,
                                            );
                                            if (folder !== null)
                                              patch(p, { folder });
                                          }}
                                        >
                                          Переместить в папку
                                        </button>
                                      </>
                                    )}
                                    {p.role === "owner" && (
                                      <button
                                        className="danger"
                                        onClick={() =>
                                          patch(p, { deleted: true })
                                        }
                                      >
                                        В корзину
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() =>
                                        patch(p, { deleted: false })
                                      }
                                    >
                                      Восстановить
                                    </button>
                                    <button
                                      className="danger"
                                      onClick={async () => {
                                        if (
                                          confirm("Удалить проект навсегда?")
                                        ) {
                                          await api("/projects/" + p.id, {
                                            method: "DELETE",
                                          });
                                          reload();
                                          setMenu(null);
                                        }
                                      }}
                                    >
                                      Удалить навсегда
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-stack">
                    <FolderOpen size={30} />
                  </div>
                  <h3>
                    {!user
                      ? "Ваши идеи скоро будут здесь"
                      : section === "Корзина"
                        ? "В корзине пусто"
                        : "Здесь начнётся что-то классное"}
                  </h3>
                  <p>
                    {section === "Корзина"
                      ? "Удалённые проекты появятся в этом разделе."
                      : "Создайте первый дизайн с чистого листа или выберите шаблон."}
                  </p>
                  {section !== "Корзина" && (
                    <button
                      className="secondary"
                      onClick={() => {
                        if (requireUser()) setCreate(true);
                      }}
                    >
                      <Plus size={16} />
                      Создать первый дизайн
                    </button>
                  )}
                </div>
              )}
            </section>
          )}
          {["Главная", "Шаблоны"].includes(section) && (
            <section className="templates-section">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">НЕМНОГО ВДОХНОВЕНИЯ</span>
                  <h2>
                    {section === "Главная"
                      ? "Хороший дизайн начинается с шаблона"
                      : "Найдите свой следующий дизайн"}
                  </h2>
                </div>
                {section === "Главная" && (
                  <button className="text-button" onClick={() => go("Шаблоны")}>
                    Все шаблоны <ArrowRight size={16} />
                  </button>
                )}
              </div>
              <div className="template-filters">
                <div className="chips">
                  {[
                    "Все шаблоны",
                    "Соцсети",
                    "Презентации",
                    "Постеры",
                    "Визитки",
                  ].map((c) => (
                    <button
                      key={c}
                      className={category === c ? "active" : ""}
                      onClick={() => setCategory(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                {section === "Шаблоны" && (
                  <div className="small-search">
                    <Search size={16} />
                    <input
                      placeholder="Поиск шаблонов"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <div className="template-grid">
                {shownTemplates
                  .slice(0, section === "Главная" ? 4 : 100)
                  .map((t) => (
                    <article className="template-card" key={t.id}>
                      <button
                        className="template-cover"
                        onClick={() => make(t)}
                        disabled={busy}
                      >
                        <Artwork t={t} />
                        <span className="use-template">
                          Использовать шаблон <ArrowUpRight size={17} />
                        </span>
                      </button>
                      <h3>{t.title}</h3>
                      <p>
                        {t.category} <span>·</span> {t.tag}
                      </p>
                    </article>
                  ))}
              </div>
              {!shownTemplates.length && (
                <div className="empty-state">
                  Шаблоны не найдены. Измените запрос.
                </div>
              )}
              <div className="original-note">
                <Check size={14} />
                Все шаблоны созданы для Forma. Можно менять каждую деталь.
              </div>
            </section>
          )}
          {section === "Бренд" && (user?<BrandLibrary key={user.id} user={user} onUserChange={u=>{if(identity.current.id===u.id){rememberUser(u);acceptUser(u)}}} toast={toast}/>:<div className="empty-state"><h2>Войдите, чтобы сохранять бренды</h2><button className="primary" onClick={()=>setAuth(true)}>Войти</button></div>)}
          {section==='Мои шаблоны'&&(user?<PersonalTemplates key={user.id} onCreated={openCreated} toast={toast}/>:<div className="empty-state"><h2>Войдите, чтобы сохранять свои шаблоны</h2><button className="primary" onClick={()=>setAuth(true)}>Войти</button></div>)}
          {section==='Настройки' &&(user?<AccountSettings user={user} onUserChange={u=>{if(identity.current.id===u.id){rememberUser(u);acceptUser(u)}}} onLogout={()=>void localLogout()} toast={toast}/>:<div className="empty-state"><h2>Войдите в аккаунт</h2><button className="primary" onClick={()=>setAuth(true)}>Войти</button></div>)}
          {section === "Мои загрузки" && (
            <MediaLibrary user={user} requireUser={requireUser} toast={toast} />
          )}
          <footer className="page-footer">
            <span className="footer-logo">forma.</span>
            <span>Пространство для ваших идей</span>
            <span>Сделано с вниманием к деталям ✳︎</span>
          </footer>
        </main>
      </div>
      {auth && (
        <Modal
          title={
            register ? "Добро пожаловать в Forma" : "Рады видеть вас снова"
          }
          onClose={() => setAuth(false)}
        >
          <p className="muted">
            Создавайте, сохраняйте и делитесь своими идеями.
          </p>
          <form className="auth-form" onSubmit={authenticate}>
            {register && (
              <label>
                Ваше имя
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Анна"
                  required
                  maxLength={100}
                />
              </label>
            )}
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={register ? 10 : 1}
                maxLength={256}
                placeholder={register ? "Не менее 10 символов" : "Ваш пароль"}
                required
              />
            </label>
            {!register&&<label>Код двухфакторной защиты<input name="twoFactorCode" inputMode="text" autoComplete="one-time-code" placeholder="Код приложения или восстановления"/></label>}
            {error && <div className="error-box">{error}</div>}
            <button className="primary" disabled={busy}>
              {busy ? "Подождите…" : register ? "Создать аккаунт" : "Войти"}
              <ArrowRight size={17} />
            </button>
          </form>
          <button
            className="auth-switch"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register
              ? "Уже есть аккаунт? Войти"
              : "Нет аккаунта? Зарегистрироваться"}
          </button>
        </Modal>
      )}
      {create && (
        <CreateModal
          onClose={() => setCreate(false)}
          onCreate={make}
          busy={busy}
        />
      )}
      {notice && (
        <div className="toast">
          <Check size={18} />
          {notice}
        </div>
      )}
    </div>
  );
}
function CreateModal({
  onClose,
  onCreate,
  busy,
}: {
  onClose: () => void;
  onCreate: (t?: Template, c?: any) => void;
  busy: boolean;
}) {
  const [w, setW] = useState(1080),
    [h, setH] = useState(1080),
    [unit, setUnit] = useState("px");
  const scale = unit === "mm" ? 96 / 25.4 : unit === "in" ? 96 : 1;
  return (
    <Modal title="Дайте идее форму" onClose={onClose}>
      <p className="muted">Выберите формат или задайте свои размеры.</p>
      <div className="create-formats">
        {formats.map((f) => (
          <button
            key={f.kind}
            onClick={() =>
              onCreate(undefined, {
                title: f.name,
                width: f.w,
                height: f.h,
                kind: f.kind,
              })
            }
          >
            <span style={{ background: f.color }}>{f.icon}</span>
            <b>{f.name}</b>
            <small>
              {f.w} × {f.h}
            </small>
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(undefined, {
            title: "Новый дизайн",
            width: Math.round(w * scale),
            height: Math.round(h * scale),
            kind: "custom",
          });
        }}
      >
        <label>Произвольный размер</label>
        <div className="dimension-row">
          <input
            type="number"
            aria-label="Ширина"
            value={w}
            onChange={(e) => setW(+e.target.value)}
            min={100 / scale}
            max={6000 / scale}
            step="any"
            required
          />
          <span>×</span>
          <input
            type="number"
            aria-label="Высота"
            value={h}
            onChange={(e) => setH(+e.target.value)}
            min={100 / scale}
            max={6000 / scale}
            step="any"
            required
          />
          <select
            aria-label="Единицы"
            value={unit}
            onChange={(e) => {
              setW(
                Math.round(
                  ((w * scale) /
                    (e.target.value === "mm"
                      ? 96 / 25.4
                      : e.target.value === "in"
                        ? 96
                        : 1)) *
                    100,
                ) / 100,
              );
              setH(
                Math.round(
                  ((h * scale) /
                    (e.target.value === "mm"
                      ? 96 / 25.4
                      : e.target.value === "in"
                        ? 96
                        : 1)) *
                    100,
                ) / 100,
              );
              setUnit(e.target.value);
            }}
          >
            <option>px</option>
            <option>mm</option>
            <option>in</option>
          </select>
        </div>
        <button className="primary full" disabled={busy}>
          Создать дизайн <ArrowRight size={17} />
        </button>
      </form>
    </Modal>
  );
}
function MediaLibrary({
  user,
  requireUser,
  toast,
}: {
  user: User | null;
  requireUser: () => boolean;
  toast: (s: string) => void;
}) {
  const [assets, setAssets] = useState<any[]>([]);
  const load = () =>
    api("/assets")
      .then((d) => setAssets(d.assets))
      .catch((e) => toast(e.message));
  useEffect(() => {
    if (user) load();
  }, [user?.id]);
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="section-kicker">ЛИЧНАЯ БИБЛИОТЕКА</span>
          <h1>Ваши материалы</h1>
        </div>
        <label className="primary upload-button">
          <Plus size={17} />
          Загрузить изображение
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              if (!requireUser() || !e.target.files?.[0]) return;
              const body = new FormData();
              body.append("file", e.target.files[0]);
              try {
                await api("/assets", { method: "POST", body });
                load();
                toast("Изображение загружено");
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          />
        </label>
      </div>
      <p className="muted">
        PNG, JPG и WebP до 10 МБ. Доступны в панели загрузок редактора.
      </p>
      <div className="asset-grid">
        {assets.map((a) => (
          <figure key={a.id}>
            <img src={a.url} alt={a.name} />
            <figcaption>{a.name}</figcaption>
          </figure>
        ))}
      </div>
      {!assets.length && (
        <div className="empty-state">
          <Image size={36} />
          <h3>Добавьте что-то своё</h3>
          <p>Фотографии и иллюстрации для ваших будущих дизайнов.</p>
        </div>
      )}
    </section>
  );
}
