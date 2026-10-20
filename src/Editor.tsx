import { useEffect, useRef, useState } from "react";
import {
  Canvas,
  Textbox,
  Rect,
  Circle,
  Triangle,
  Line,
  FabricImage,
  ActiveSelection,
  FabricObject,
  Group as FabricGroup,
} from "fabric";
import {
  ArrowLeft,
  Undo2,
  Redo2,
  Download,
  Share2,
  Plus,
  Minus,
  Type,
  Shapes,
  Image,
  LayoutTemplate,
  Palette,
  Layers,
  Trash2,
  Copy,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Play,
  History,
  MessageSquare,
  Check,
  MousePointer2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Group,
  Ungroup,
  MoveUp,
  MoveDown,
  Save,
  X,
  Upload,
  RotateCw,
  SlidersHorizontal,
  FileSpreadsheet,
  Globe,
} from "lucide-react";
import { api, json, Project, User, DesignPage, uid } from "./api";
import { templates, templateDocument } from "./templates";
import { Modal, Artwork } from "./ui";
import AdvancedTools from './advanced/AdvancedTools';
import ExportDialog from './export/ExportDialog';
import ImageTools from './image-tools/ImageTools';
import DataTools from './data-tools/DataTools';
import BrandPanel from './brand/BrandPanel';
import {brandObjectStyle,type BrandSettings} from '../shared/brand.mjs';
import type {BrandLogo} from './brand/api';
import PersonalTemplates from './PersonalTemplates';
import SlideSettings from './presentation/SlideSettings';
import PresentationViewer from './presentation/PresentationViewer';
import BulkCreate from './BulkCreate';
import PublishDesign from './PublishDesign';
import {cacheProject} from './offline/cache';
import {cacheGeneration} from './offline/store.mjs';
import { Collaboration, type Peer } from "./collaboration";
import type { Snapshot } from "../shared/collaboration.mjs";
FabricObject.customProperties = [
  "id",
  "formaData",
  "lockMovementX",
  "lockMovementY",
  "lockScalingX",
  "lockScalingY",
  "lockRotation",
];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
export default function Editor({
  project,
  user,
  onExit,
  toast,
  onOpenProject,
}: {
  project: Project;
  user: User;
  onExit: () => void;
  toast: (s: string) => void;
  onOpenProject:(p:Project)=>void;
}) {
  const [presentationIndex,setPresentationIndex]=useState(0);
  const localGeneration=useRef(cacheGeneration(user.id));
  const canvasEl = useRef<HTMLCanvasElement>(null),
    canvas = useRef<Canvas | null>(null),
    loading = useRef(false),
    disposed = useRef(false);
  const pagesRef = useRef<DesignPage[]>(clone(project.document.pages)),
    pageIndex = useRef(0),
    titleRef = useRef(project.title),
    revision = useRef(project.revision);
  const [pages, setPages] = useState(pagesRef.current),
    [page, setPage] = useState(0),
    [title, setTitle] = useState(project.title),
    [tab, setTab] = useState("Шаблоны"),
    [selected, setSelected] = useState<FabricObject | null>(null),
    [tick, setTick] = useState(0),
    [status, setStatus] = useState("Сохранено"),
    [zoom, setZoom] = useState(0.4),
    [modal, setModal] = useState(""),
    [assets, setAssets] = useState<any[]>([]),
    [versions, setVersions] = useState<any[]>([]),
    [comments, setComments] = useState<any[]>([]),
    [members, setMembers] = useState<any[]>([]),
    [exportSnapshot,setExportSnapshot]=useState<{pages:DesignPage[];current:number;title:string}|null>(null),
    [presentation, setPresentation] = useState(false),
    [snap, setSnap] = useState(false),
    [panelError, setPanelError] = useState("");
  const [historyTick, setHistoryTick] = useState(0);
  const dirty = useRef(false),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef<Collaboration | null>(null),
    pendingRemote = useRef<Snapshot | null>(null),
    remoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    dragging = useRef(false),
    drainRef = useRef<() => void>(() => {});
  const [liveReady, setLiveReady] = useState(false),
    [liveRole, setLiveRole] = useState<string>(project.role),
    [peers, setPeers] = useState<Peer[]>([]),
    [self, setSelf] = useState(""),
    [applying, setApplying] = useState(false);
  const readOnly = liveRole === "viewer" || !liveReady || applying;
  const editable = useRef(false);
  editable.current = !readOnly;
  const snapRef = useRef(false);
  snapRef.current = snap;
  const changeRef = useRef<() => void>(() => {});
  const saveRef = useRef<() => Promise<void>>(async () => {});
  function capture() {
    if (canvas.current && !loading.current) {
      for (const o of canvas.current.getObjects()) (o as any).id ||= uid();
      pagesRef.current[pageIndex.current] = {
        ...pagesRef.current[pageIndex.current],
        canvas: canvas.current.toJSON(),
      };
    }
  }
  function documentState() {
    capture();
    return JSON.stringify({ pages: pagesRef.current, title: titleRef.current });
  }
  function record() {
    if (loading.current || readOnly) return;
    const state = documentState();
    const snapshot = JSON.parse(state);
    snapshot.title =
      snapshot.title.trim() || live.current?.view.title || "Новый дизайн";
    live.current?.publish(snapshot);
    dirty.current = live.current?.pending || false;
    setHistoryTick((x) => x + 1);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveRef.current(), 1000);
    setTick((x) => x + 1);
  }
  changeRef.current = record;
  async function save() {
    if (readOnly) return;
    capture();
    void cacheProject(user.id,{...project,title:titleRef.current,document:{pages:clone(pagesRef.current)}},localGeneration.current);
    let thumbnail: string | undefined;
    const c = canvas.current;
    try {
      thumbnail = c?.toDataURL({
        format: "png",
        multiplier:
          Math.min(320 / project.width, 320 / project.height) /
          (c.getZoom() || 1),
      });
    } catch {}
    try {
      live.current?.publish(
        {
          title:
            titleRef.current.trim() ||
            live.current?.view.title ||
            "Новый дизайн",
          pages: clone(pagesRef.current),
        },
        thumbnail,
      );
      await live.current?.flush();
      dirty.current = live.current?.pending || false;
      revision.current = live.current?.revision || revision.current;
    } catch (e) {
      dirty.current = true;
      setStatus("Ошибка сохранения");
      toast((e as Error).message);
    }
  }
  saveRef.current = save;
  async function loadPage(index: number) {
    const c = canvas.current;
    if (!c) return;
    loading.current = true;
    c.discardActiveObject();
    setSelected(null);
    try {
      await c.loadFromJSON(pagesRef.current[index].canvas);
      for (const o of c.getObjects())
        o.set({ selectable: editable.current, evented: editable.current });
      c.requestRenderAll();
    } finally {
      loading.current = false;
    }
  }
  async function switchPage(index: number) {
    if (index < 0 || index >= pagesRef.current.length || loading.current)
      return;
    capture();
    pageIndex.current = index;
    setPage(index);
    await loadPage(index);
  }
  drainRef.current = () => {
    if (remoteTimer.current) clearTimeout(remoteTimer.current);
    const run = async () => {
      const c = canvas.current;
      if (!c || disposed.current || !pendingRemote.current) return;
      if (
        loading.current ||
        dragging.current ||
        (c.getActiveObject() as any)?.isEditing
      ) {
        remoteTimer.current = setTimeout(() => void run(), 60);
        return;
      }
      const state = live.current?.snapshot || pendingRemote.current;
      pendingRemote.current = null;
      const currentPageId = pagesRef.current[pageIndex.current]?.id;
      const currentId = (c.getActiveObject() as any)?.id;
      const oldCanvas = JSON.stringify(
        pagesRef.current[pageIndex.current]?.canvas,
      );
      pagesRef.current = clone(state.pages);
      titleRef.current = state.title;
      setTitle(state.title);
      setPages([...state.pages]);
      const next = state.pages.findIndex((p) => p.id === currentPageId);
      pageIndex.current = next >= 0 ? next : 0;
      setPage(pageIndex.current);
      try {
        if (
          oldCanvas !== JSON.stringify(state.pages[pageIndex.current]?.canvas)
        ) {
          setApplying(true);
          await loadPage(pageIndex.current);
          const object = c
            .getObjects()
            .find((o) => (o as any).id === currentId);
          if (object) {
            c.setActiveObject(object);
            setSelected(object);
            c.requestRenderAll();
          }
        }
        capture();
        live.current?.markDisplayed({
          title: titleRef.current,
          pages: pagesRef.current,
        });
        setLiveReady(true);
        setHistoryTick((x) => x + 1);
        setTick((x) => x + 1);
      } catch {
        toast("Не удалось отобразить совместное изменение");
      } finally {
        setApplying(false);
      }
      if (pendingRemote.current)
        remoteTimer.current = setTimeout(() => void run(), 0);
    };
    void run();
  };
  useEffect(() => {
    const c = canvas.current;
    if (c) {
      c.selection = !readOnly;
      for (const o of c.getObjects())
        o.set({ selectable: !readOnly, evented: !readOnly });
      c.requestRenderAll();
    }
  }, [readOnly]);
  useEffect(() => {
    disposed.current = false;
    let cancelled = false;
    const c = new Canvas(canvasEl.current!, {
      preserveObjectStacking: true,
      selection: !readOnly,
      backgroundColor: "#fff",
      stopContextMenu: true,
      fireRightClick: false,
    });
    canvas.current = c;
    const areaWidth = Math.max(250, window.innerWidth - 650),
      areaHeight = window.innerHeight - 260;
    const z = Math.max(
      0.06,
      Math.min(0.75, areaWidth / project.width, areaHeight / project.height),
    );
    c.setDimensions({ width: project.width * z, height: project.height * z });
    c.setZoom(z);
    setZoom(z);
    const select = () => {
      setSelected(c.getActiveObject() || null);
      setTick((v) => v + 1);
    };
    c.on("selection:created", select);
    c.on("selection:updated", select);
    c.on("selection:cleared", select);
    c.on("object:modified", () => changeRef.current());
    c.on("text:changed", () => changeRef.current());
    c.on("mouse:down", () => {
      dragging.current = true;
    });
    c.on("mouse:up", () => {
      dragging.current = false;
      if (pendingRemote.current) drainRef.current();
    });
    let lastCursor = 0;
    c.on("mouse:move", (event) => {
      if (Date.now() - lastCursor < 70) return;
      lastCursor = Date.now();
      const point = event.scenePoint;
      live.current?.cursor({
        x: Math.round(point.x),
        y: Math.round(point.y),
        page: pagesRef.current[pageIndex.current]?.id,
      });
    });
    c.on("text:editing:exited", () => {
      if (pendingRemote.current) drainRef.current();
    });
    c.on("object:moving", ({ target }) => {
      if (snapRef.current && target) {
        target.set({
          left: Math.round((target.left || 0) / 10) * 10,
          top: Math.round((target.top || 0) / 10) * 10,
        });
      }
    });
    loading.current = true;
    c.loadFromJSON(pagesRef.current[0].canvas).then(() => {
      if (cancelled) return;
      for (const o of c.getObjects())
        o.set({ selectable: editable.current, evented: editable.current });
      c.requestRenderAll();
      loading.current = false;
      live.current = new Collaboration({
        projectId: project.id,
        userId:user.id,
        onSnapshot: (state) => {
          pendingRemote.current = state;
          drainRef.current();
        },
        onStatus: (state) => {
          dirty.current = live.current?.pending || false;
          setStatus(state);
        },
        onPeers: (people, id) => {
          setPeers(people);
          setSelf(id);
        },
        onRole: (role) => setLiveRole(role),
        onError: toast,
        onHistory: () => setHistoryTick((x) => x + 1),
      });
    });
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current&&!live.current?.durable) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      cancelled = true;
      disposed.current = true;
      live.current?.destroy();
      live.current = null;
      if (remoteTimer.current) clearTimeout(remoteTimer.current);
      window.removeEventListener("beforeunload", unload);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void c.dispose();
      canvas.current = null;
    };
  }, [project.id]);
  useEffect(() => {
    if (tab === "Загрузки")
      api("/assets")
        .then((d) => setAssets(d.assets))
        .catch((e) => toast(e.message));
  }, [tab]);
  useEffect(() => {
    const online = () => {
      if (dirty.current) void saveRef.current();
    };
    addEventListener("online", online);
    return () => removeEventListener("online", online);
  }, []);
  async function undo(direction: number) {
    if (readOnly || loading.current) return;
    live.current?.undo(direction);
    setHistoryTick((x) => x + 1);
    dirty.current = live.current?.pending || false;
  }
  function renewIds(object: FabricObject) {
    (object as any).id = uid();
    if ("getObjects" in object) (object as any).getObjects().forEach(renewIds);
  }
  function add(o: FabricObject) {
    if (readOnly || !canvas.current) return;
    canvas.current.add(o);
    canvas.current.setActiveObject(o);
    canvas.current.requestRenderAll();
    record();
  }
  function text(size = 64) {
    add(
      new Textbox(
        size > 50 ? "Добавьте заголовок" : "Расскажите свою историю",
        {
          left: project.width * 0.1,
          top: project.height * 0.2,
          width: project.width * 0.7,
          fontFamily: user.brand.font || "Arial",
          fontSize: size,
          fill: user.brand.colors?.[1] || "#252837",
          fontWeight: size > 50 ? "bold" : "normal",
        },
      ),
    );
  }
  function shape(type: string) {
    const options = {
      left: project.width * 0.25,
      top: project.height * 0.3,
      fill: user.brand.colors?.[0] || "#8561df",
      width: project.width * 0.3,
      height: project.height * 0.25,
    };
    if (type === "circle")
      add(new Circle({ ...options, radius: project.width * 0.15 }));
    else if (type === "triangle") add(new Triangle(options));
    else if (type === "line")
      add(
        new Line([0, 0, project.width * 0.5, 0], {
          left: project.width * 0.2,
          top: project.height * 0.5,
          stroke: options.fill,
          strokeWidth: 6,
        }),
      );
    else
      add(
        new Rect({
          ...options,
          rx: type === "round" ? 40 : 0,
          ry: type === "round" ? 40 : 0,
        }),
      );
  }
  function update(values: Record<string, any>) {
    if (readOnly) return;
    const c = canvas.current;
    const obj = c?.getActiveObject();
    if (!obj) return;
    obj.set(values);
    obj.setCoords();
    c?.requestRenderAll();
    setSelected(obj);
    setTick((x) => x + 1);
    record();
  }
  function remove() {
    if (readOnly) return;
    const c = canvas.current;
    if (!c) return;
    c.getActiveObjects().forEach((o) => c.remove(o));
    c.discardActiveObject();
    c.requestRenderAll();
    record();
  }
  async function duplicate() {
    const c = canvas.current;
    if (readOnly || !c?.getActiveObject()) return;
    const original = c.getActiveObject()!;
    const copied = await original.clone();
    renewIds(copied);
    if (copied instanceof ActiveSelection) {
      copied.canvas = c;
      copied.set({ left: copied.left + 20, top: copied.top + 20 });
      copied.forEachObject((o) => c.add(o));
      c.setActiveObject(copied);
    } else {
      copied.set({ left: original.left + 20, top: original.top + 20 });
      add(copied);
    }
    c.requestRenderAll();
    record();
  }
  function layer(dir: number) {
    const c = canvas.current,
      o = c?.getActiveObject();
    if (!c || !o || readOnly) return;
    if (dir > 0) c.bringObjectForward(o);
    else c.sendObjectBackwards(o);
    c.requestRenderAll();
    record();
  }
  function group() {
    const c = canvas.current;
    if (!c || readOnly) return;
    const objs = c.getActiveObjects();
    if (objs.length < 2) return;
    const selection = c.getActiveObject() as ActiveSelection;
    selection.removeAll();
    c.discardActiveObject();
    objs.forEach((o) => c.remove(o));
    add(new FabricGroup(objs));
    record();
  }
  function ungroup() {
    const c = canvas.current,
      o = c?.getActiveObject();
    if (!c || !o || o.type !== "group" || readOnly) return;
    const objects = (o as any).removeAll() as FabricObject[];
    c.remove(o);
    objects.forEach((v) => c.add(v));
    c.discardActiveObject();
    c.requestRenderAll();
    record();
  }
  function setScale(value: number) {
    const z = Math.min(2, Math.max(0.05, value));
    const c = canvas.current;
    if (!c) return;
    c.setDimensions({ width: project.width * z, height: project.height * z });
    c.setZoom(z);
    setZoom(z);
    c.requestRenderAll();
  }
  const clipboard = useRef<FabricObject | null>(null);
  async function copy() {
    const o = canvas.current?.getActiveObject();
    if (o) clipboard.current = await o.clone();
  }
  async function paste() {
    if (readOnly || !canvas.current || !clipboard.current) return;
    const o = await clipboard.current.clone();
    renewIds(o);
    o.set({ left: o.left + 20, top: o.top + 20 });
    if (o instanceof ActiveSelection) {
      o.canvas = canvas.current;
      o.forEachObject((v) => canvas.current?.add(v));
      canvas.current.setActiveObject(o);
      canvas.current.requestRenderAll();
      record();
    } else add(o);
  }
  function selectAll() {
    const c = canvas.current;
    if (!c) return;
    c.discardActiveObject();
    c.setActiveObject(
      new ActiveSelection(
        c.getObjects().filter((o) => o.selectable && o.visible),
        { canvas: c },
      ),
    );
    c.requestRenderAll();
  }
  const keyActions = useRef<any>({});
  keyActions.current = {
    undo,
    remove,
    duplicate,
    save,
    group,
    ungroup,
    copy,
    paste,
    selectAll,
  };
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable ||
        (canvas.current?.getActiveObject() as any)?.isEditing
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      if (
        mod &&
        ["z", "s", "d", "g", "c", "v", "a"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        if (e.key === "c") void keyActions.current.copy();
        if (e.key === "v") void keyActions.current.paste();
        if (e.key === "a") keyActions.current.selectAll();
        if (e.key === "z") void keyActions.current.undo(e.shiftKey ? 1 : -1);
        if (e.key === "s") void keyActions.current.save();
        if (e.key === "d") void keyActions.current.duplicate();
        if (e.key === "g")
          e.shiftKey
            ? keyActions.current.ungroup()
            : keyActions.current.group();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        keyActions.current.remove();
      } else if (e.key === "Escape") {
        setPresentation(false);
        canvas.current?.discardActiveObject();
        canvas.current?.requestRenderAll();
      } else if (
        !readOnly &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        const c = canvas.current,
          o = c?.getActiveObject();
        if (o) {
          e.preventDefault();
          const n = e.shiftKey ? 10 : 1;
          o.set({
            left:
              o.left +
              (e.key === "ArrowRight" ? n : e.key === "ArrowLeft" ? -n : 0),
            top:
              o.top +
              (e.key === "ArrowDown" ? n : e.key === "ArrowUp" ? -n : 0),
          });
          o.setCoords();
          c?.requestRenderAll();
          changeRef.current();
        }
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [readOnly]);
  function applyBrand(brand:BrandSettings,options:{selection:boolean;typography:boolean;background:boolean}) {
    const c=canvas.current;if(!c||readOnly)return;
    const targets=options.selection?[...c.getActiveObjects()]:[...c.getObjects()];
    c.discardActiveObject();let index=0;
    function style(object:FabricObject){
      const o=object as any;
      if(o.formaData||(o.lockMovementX&&o.lockMovementY))return;
      if(object instanceof FabricGroup){object.getObjects().forEach(style);object.set('dirty',true);if(options.typography)object.triggerLayout();object.setCoords();return;}
      const patch=brandObjectStyle(o,brand,index++,options.typography);
      if(patch){object.set(patch);object.setCoords();}
    }
    targets.forEach(style);
    if(options.background)c.backgroundColor=brand.colors[2]||brand.colors[0];
    c.requestRenderAll();record();toast('Бренд применён');
  }
  async function insertBrandLogo(logo:BrandLogo){
    const c=canvas.current;if(!c||!editable.current)return;
    const targetPage=pagesRef.current[pageIndex.current]?.id;
    const image=await FabricImage.fromURL(logo.src);
    if(disposed.current||canvas.current!==c||!editable.current||pagesRef.current[pageIndex.current]?.id!==targetPage)return;
    image.scaleToWidth(Math.min(project.width*.35,logo.width));
    image.set({left:project.width*.1,top:project.height*.1});add(image);
  }
  async function addImage(url: string) {
    if (readOnly) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Нет доступа к изображению");
      const blob = await response.blob();
      const data: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const img = await FabricImage.fromURL(data);
      img.scaleToWidth(project.width * 0.6);
      img.set({ left: project.width * 0.2, top: project.height * 0.2 });
      add(img);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function upload(file: File) {
    if (readOnly) return;
    const body = new FormData();
    body.append("file", file);
    try {
      const d = await api("/assets", { method: "POST", body });
      setAssets((a) => [d.asset, ...a]);
      await addImage(d.asset.url);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function addPage(copy = false) {
    if (readOnly || loading.current || pagesRef.current.length >= 100) return;
    capture();
    const p:DesignPage = copy ? {...clone(pagesRef.current[pageIndex.current]),id:uid()} : {id:uid(),canvas:{ version:"6.7.1", objects:[], background:"#ffffff" }};
    pagesRef.current.splice(pageIndex.current + 1, 0, p);
    setPages([...pagesRef.current]);
    await switchPage(pageIndex.current + 1);
    record();
  }
  async function removePage() {
    if (readOnly || pagesRef.current.length <= 1) return;
    if (!confirm("Удалить текущую страницу?")) return;
    capture();
    pagesRef.current.splice(pageIndex.current, 1);
    pageIndex.current = Math.min(
      pageIndex.current,
      pagesRef.current.length - 1,
    );
    setPages([...pagesRef.current]);
    setPage(pageIndex.current);
    await loadPage(pageIndex.current);
    record();
  }
  function movePage(dir: number) {
    if (readOnly) return;
    const i = pageIndex.current,
      j = i + dir;
    if (j < 0 || j >= pagesRef.current.length) return;
    capture();
    [pagesRef.current[i], pagesRef.current[j]] = [
      pagesRef.current[j],
      pagesRef.current[i],
    ];
    pageIndex.current = j;
    setPage(j);
    setPages([...pagesRef.current]);
    record();
  }
  async function applyTemplate(t: (typeof templates)[number]) {
    if (readOnly) return;
    if (
      !confirm(
        "Заменить содержимое текущей страницы шаблоном? Действие можно отменить.",
      )
    )
      return;
    const doc = templateDocument(t);
    const temp = new Canvas(undefined, { width: t.w, height: t.h });
    try {
      await temp.loadFromJSON(doc.pages[0].canvas);
      const sx = project.width / t.w,
        sy = project.height / t.h;
      temp.getObjects().forEach((o) =>
        o.set({
          left: o.left * sx,
          top: o.top * sy,
          scaleX: o.scaleX * sx,
          scaleY: o.scaleY * sy,
        }),
      );
      pagesRef.current[pageIndex.current].canvas = temp.toJSON();
      await loadPage(pageIndex.current);
      record();
    } finally {
      await temp.dispose();
    }
  }
  async function importFile(file: File) {
    try {
      const d = JSON.parse(await file.text());
      if (
        d.width !== project.width ||
        d.height !== project.height ||
        !Array.isArray(d.document?.pages) ||
        !d.document.pages.length ||
        d.document.pages.length > 100
      )
        throw new Error(
          "Размеры документа должны совпадать с проектом, число страниц — от 1 до 100.",
        );
      if (!confirm("Заменить все страницы импортированным документом?")) return;
      pagesRef.current = clone(d.document.pages);
      pageIndex.current = 0;
      setPage(0);
      setPages([...pagesRef.current]);
      await loadPage(0);
      record();
      toast("Документ импортирован");
    } catch (e) {
      toast("Ошибка импорта: " + (e as Error).message);
    }
  }
  async function openModal(name: string) {
    setPanelError("");
    setModal(name);
    try {
      if (name === "История версий") {
        await save();
        setVersions(
          (await api("/projects/" + project.id + "/versions")).versions,
        );
      }
      if (name === "Общий доступ")
        setMembers((await api("/projects/" + project.id + "/members")).members);
      if (name === "Комментарии")
        setComments(
          (await api("/projects/" + project.id + "/comments")).comments,
        );
    } catch (e) {
      setPanelError((e as Error).message);
    }
  }
  const c = canvas.current;
  const selectedIsText =
    selected?.type === "textbox" || selected?.type === "i-text";
  const objects = c?.getObjects() || [];
  return (
    <div className="editor">
      <header className="editor-header">
        <button
          className="editor-back"
          onClick={async () => {
            await save();
            if (
              dirty.current && !live.current?.durable &&
              !confirm("Есть несохранённые изменения. Всё равно выйти?")
            )
              return;
            onExit();
          }}
        >
          <ArrowLeft size={18} />
          <span className="editor-wordmark">forma.</span>
        </button>
        <div className="editor-divider" />
        <input
          className="project-title"
          aria-label="Название проекта"
          value={title}
          maxLength={200}
          readOnly={readOnly}
          onChange={(e) => {
            setTitle(e.target.value);
            titleRef.current = e.target.value;
            record();
          }}
          onBlur={() => {
            if (!titleRef.current.trim()) {
              setTitle("Новый дизайн");
              titleRef.current = "Новый дизайн";
              record();
            }
          }}
        />
        <div className="history-controls">
          <button
            className="icon-button"
            title="Отменить Ctrl+Z"
            aria-label="Отменить"
            disabled={readOnly || !live.current?.canUndo}
            onClick={() => undo(-1)}
          >
            <Undo2 size={19} />
          </button>
          <button
            className="icon-button"
            title="Повторить Ctrl+Shift+Z"
            aria-label="Повторить"
            disabled={readOnly || !live.current?.canRedo}
            onClick={() => undo(1)}
          >
            <Redo2 size={19} />
          </button>
        </div>
        <button
          className={
            "save-status " + (status.includes("Ошибка") ? "danger" : "")
          }
          onClick={() => save()}
          title="Сохранить Ctrl+S"
        >
          {status === "Сохранено" ? <Check size={14} /> : <Save size={14} />}
          <span>{liveRole==='viewer'?"Только просмотр":status}</span>
        </button>
        <div className="editor-header-spacer" />
        <div className="live-presence" aria-label="Участники онлайн">
          {peers.slice(0, 4).map((peer, i) => (
            <span
              key={peer.id}
              title={peer.name + (peer.id === self ? " (вы)" : "")}
              style={{
                background: ["#eadffa", "#d8efe7", "#fce5d5", "#dde8fc"][i % 4],
              }}
            >
              {peer.name[0].toUpperCase()}
            </span>
          ))}
          <small>{peers.length ? peers.length + " онлайн" : "Нет связи"}</small>
        </div>
        <button
          className="icon-button"
          title="История версий"
          aria-label="История версий"
          onClick={() => openModal("История версий")}
        >
          <History size={19} />
        </button>
        <button
          className="icon-button"
          title="Комментарии"
          aria-label="Комментарии"
          onClick={() => openModal("Комментарии")}
        >
          <MessageSquare size={19} />
        </button>
        <button
          className="secondary compact"
          onClick={() => {capture();setPresentationIndex(pageIndex.current);setPresentation(true)}}
        >
          <Play size={15} />
          <span>Просмотр</span>
        </button>
        <button
          className="secondary compact"
          onClick={() => openModal("Общий доступ")}
        >
          <Share2 size={16} />
          <span>Поделиться</span>
        </button>
        <button className="secondary compact" disabled={readOnly} aria-label="Массовое создание" title="Массовое создание" onClick={async()=>{await save();if(live.current?.pending||!live.current?.connected){toast('Дождитесь синхронизации с сервером');return;}setModal('Массовое создание')}}><FileSpreadsheet size={16}/></button>
        {project.role==='owner'&&<button className="secondary compact" disabled={!liveReady} aria-label="Опубликовать" title="Опубликовать" onClick={async()=>{await save();if(live.current?.pending||!live.current?.connected){toast('Дождитесь синхронизации с сервером');return;}setModal('Опубликовать')}}><Globe size={16}/></button>}
        <button
          className="primary compact"
          onClick={() => {capture();setExportSnapshot({pages:clone(pagesRef.current),current:pageIndex.current,title:titleRef.current});setModal("Скачать дизайн")}}
        >
          <Download size={17} />
          <span>Скачать</span>
        </button>
      </header>
      <div className="editor-body">
        <nav className="editor-nav">
          {[
            { name: "Шаблоны", icon: LayoutTemplate },
            { name: "Элементы", icon: Shapes },
            { name: "Текст", icon: Type },
            { name: "Загрузки", icon: Image },
            { name: "Фон", icon: Palette },
            { name: "Бренд", icon: Palette },
            { name: "Слои", icon: Layers },
            { name: "Инструменты", icon: SlidersHorizontal },
            { name: "Фото", icon: Image },
            { name: "Данные", icon: FileSpreadsheet },
            { name: "Слайды", icon: Play },
            { name: "Мои шаблоны", icon: LayoutTemplate },
          ].map((n) => (
            <button
              key={n.name}
              className={tab === n.name ? "active" : ""}
              onClick={() => setTab(tab === n.name ? "" : n.name)}
            >
              <n.icon size={23} />
              <span>{n.name}</span>
            </button>
          ))}
        </nav>
        {tab && (
          <aside className="editor-panel">
            <div className="editor-panel-heading">
              <h3>{tab}</h3>
              <button
                className="icon-button"
                aria-label="Скрыть панель"
                onClick={() => setTab("")}
              >
                <X size={16} />
              </button>
            </div>
            {tab==='Бренд'&&<BrandPanel user={user} readOnly={readOnly} hasSelection={!!c?.getActiveObjects().length} onApply={applyBrand} onLogo={insertBrandLogo}/>}
            {tab==='Инструменты'&&c&&<AdvancedTools canvas={c} selected={selected} readOnly={readOnly} onChange={record} toast={toast} width={project.width} height={project.height} tick={tick}/>}
            {tab==='Фото'&&c&&<ImageTools canvas={c} selected={selected} readOnly={readOnly} onChange={record} toast={toast} tick={tick}/>}
            {tab==='Данные'&&c&&<DataTools canvas={c} selected={selected} readOnly={readOnly} width={project.width} height={project.height} onChange={record} toast={toast} tick={tick}/>}
            {tab==='Слайды'&&<><SlideSettings page={pages[page]} readOnly={readOnly} onChange={patch=>{if(readOnly)return;Object.assign(pagesRef.current[pageIndex.current],patch);setPages([...pagesRef.current]);record();}}/><button className="secondary full" onClick={()=>{capture();setPresentationIndex(0);setPresentation(true)}}>Показать с первого слайда</button></>}
            {tab==='Мои шаблоны'&&<PersonalTemplates projectId={project.id} readOnly={readOnly} beforeSave={async()=>{await save();return !!live.current?.connected&&!live.current.pending}} onCreated={async p=>{await save();if(live.current?.pending&&!live.current.durable){toast('Новый дизайн создан. Сохраните текущие изменения перед переходом.');return;}onOpenProject(p)}} toast={toast}/>}

            {tab === "Шаблоны" && (
              <>
                <p className="muted small">
                  Начните с готовой идеи. Все детали можно изменить.
                </p>
                <div className="editor-templates">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      title={t.title}
                      disabled={readOnly}
                      onClick={() => applyTemplate(t)}
                    >
                      <Artwork t={t} />
                    </button>
                  ))}
                </div>
                <p className="muted small">
                  Все шаблоны — оригинальные разработки Forma.
                </p>
                <label className="secondary import-button">
                  <Upload size={16} />
                  Импорт JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    hidden
                    disabled={readOnly}
                    onChange={(e) => {
                      if (e.target.files?.[0])
                        void importFile(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </>
            )}
            {tab === "Текст" && (
              <>
                <button
                  className="primary full"
                  disabled={readOnly}
                  onClick={() => text()}
                >
                  <Plus size={17} />
                  Добавить текст
                </button>
                <div className="text-options">
                  <button disabled={readOnly} onClick={() => text(80)}>
                    <b>Добавить заголовок</b>
                  </button>
                  <button disabled={readOnly} onClick={() => text(48)}>
                    Добавить подзаголовок
                  </button>
                  <button disabled={readOnly} onClick={() => text(30)}>
                    Добавить основной текст
                  </button>
                </div>
                <div className="tip">
                  Дважды нажмите на текст на холсте, чтобы его отредактировать.
                </div>
              </>
            )}
            {tab === "Элементы" && (
              <>
                <p className="muted small">Базовые фигуры</p>
                <div className="shape-grid">
                  {["rect", "round", "circle", "triangle", "line"].map((s) => (
                    <button
                      key={s}
                      disabled={readOnly}
                      aria-label={"Добавить " + s}
                      onClick={() => shape(s)}
                    >
                      <span className={"shape-icon " + s} />
                    </button>
                  ))}
                </div>
                <div className="tip">
                  Выделяйте несколько объектов с Shift. Ctrl+G — сгруппировать.
                </div>
                <button
                  className="secondary full"
                  disabled={readOnly}
                  onClick={group}
                >
                  <Group size={17} />
                  Сгруппировать
                </button>
                <button
                  className="secondary full"
                  disabled={readOnly}
                  onClick={ungroup}
                >
                  <Ungroup size={17} />
                  Разгруппировать
                </button>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={snap}
                    onChange={(e) => setSnap(e.target.checked)}
                  />
                  Привязка к сетке 10 px
                </label>
              </>
            )}
            {tab === "Загрузки" && (
              <>
                <label className="primary upload-button full">
                  <Upload size={17} />
                  Загрузить изображение
                  <input
                    type="file"
                    hidden
                    accept="image/png,image/jpeg,image/webp"
                    disabled={readOnly}
                    onChange={(e) => {
                      if (e.target.files?.[0]) upload(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                <p className="muted small">
                  PNG, JPG, WebP · до 10 МБ
                  <br />
                  Или перетащите файл на холст
                </p>
                <div className="editor-assets">
                  {assets.map((a) => (
                    <button
                      key={a.id}
                      title={a.name}
                      disabled={readOnly}
                      onClick={() => addImage(a.url)}
                    >
                      <img src={a.url} alt={a.name} />
                    </button>
                  ))}
                </div>
              </>
            )}
            {tab === "Фон" && (
              <>
                <label>
                  Цвет страницы
                  <input
                    type="color"
                    className="background-picker"
                    aria-label="Цвет страницы"
                    value={
                      typeof c?.backgroundColor === "string"
                        ? c.backgroundColor
                        : "#ffffff"
                    }
                    disabled={readOnly}
                    onChange={(e) => {
                      if (c) {
                        c.backgroundColor = e.target.value;
                        c.requestRenderAll();
                        record();
                      }
                    }}
                  />
                </label>
                <div className="swatch-grid">
                  {[
                    "#ffffff",
                    "#f7f5ed",
                    "#e9eddf",
                    "#e8dcfd",
                    "#ffe7ae",
                    "#232a3c",
                    "#ede0d3",
                    "#d6e9f2",
                    "#f6c3ce",
                    ...(user.brand.colors || []),
                  ].map((color, i) => (
                    <button
                      key={i}
                      aria-label={"Фон " + color}
                      disabled={readOnly}
                      style={{ background: color }}
                      onClick={() => {
                        if (c) {
                          c.backgroundColor = color;
                          c.requestRenderAll();
                          record();
                        }
                      }}
                    />
                  ))}
                </div>
                <h4>Ваш бренд</h4>
                <p className="muted small">
                  Фирменные цвета и шрифт из раздела «Бренд».
                </p>
                <button
                  className="secondary full"
                  disabled={readOnly}
                  onClick={() => {
                    if (!c) return;
                    c.getObjects().forEach((o, i) => {
                      o.set({
                        fill:
                          user.brand.colors?.[
                            i % (user.brand.colors.length || 1)
                          ] || "#7048ed",
                      });
                      if (o.type === "textbox")
                        o.set({ fontFamily: user.brand.font || "Arial" });
                    });
                    c.requestRenderAll();
                    record();
                  }}
                >
                  Применить стиль бренда
                </button>
              </>
            )}
            {tab === "Слои" && (
              <>
                <p className="muted small">
                  Сверху — передний план. Нажмите на слой, чтобы выбрать.
                </p>
                <div className="layer-list">
                  {[...objects].reverse().map((o, i) => (
                    <div
                      className={
                        selected === o ? "layer-row active" : "layer-row"
                      }
                      key={objects.length - i}
                    >
                      <button
                        className="layer-name"
                        onClick={() => {
                          c?.setActiveObject(o);
                          c?.requestRenderAll();
                          setSelected(o);
                        }}
                      >
                        <span>
                          {o.type === "textbox"
                            ? "T"
                            : o.type === "image"
                              ? "▧"
                              : "◇"}
                        </span>
                        {(o as any).text?.slice(0, 20) ||
                          {
                            rect: "Прямоугольник",
                            circle: "Круг",
                            triangle: "Треугольник",
                            image: "Изображение",
                            group: "Группа",
                            line: "Линия",
                          }[o.type] ||
                          o.type}
                      </button>
                      <button
                        className="icon-button"
                        disabled={readOnly}
                        title="Скрыть / показать"
                        onClick={() => {
                          o.set({ visible: !o.visible });
                          c?.requestRenderAll();
                          record();
                        }}
                      >
                        {o.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button
                        className="icon-button"
                        disabled={readOnly}
                        title="Блокировка"
                        onClick={() => {
                          o.set({
                            lockMovementX: !o.lockMovementX,
                            lockMovementY: !o.lockMovementY,
                            lockScalingX: !o.lockScalingX,
                            lockScalingY: !o.lockScalingY,
                            lockRotation: !o.lockRotation,
                          });
                          record();
                        }}
                      >
                        {o.lockMovementX ? (
                          <Lock size={13} />
                        ) : (
                          <Unlock size={13} />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                {!objects.length && (
                  <p className="muted">На странице пока нет объектов</p>
                )}
                <div className="layer-actions">
                  <button
                    className="secondary"
                    disabled={readOnly || !selected}
                    onClick={() => layer(1)}
                  >
                    <MoveUp size={16} />
                    Вперёд
                  </button>
                  <button
                    className="secondary"
                    disabled={readOnly || !selected}
                    onClick={() => layer(-1)}
                  >
                    <MoveDown size={16} />
                    Назад
                  </button>
                </div>
              </>
            )}
          </aside>
        )}
        <section
          className="workspace-area"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) void upload(e.dataTransfer.files[0]);
          }}
        >
          <div className="context-toolbar">
            {selected ? (
              <>
                <span className="context-label">
                  {selectedIsText
                    ? "Текст"
                    : selected.type === "image"
                      ? "Изображение"
                      : "Объект"}
                </span>
                {selectedIsText && (
                  <>
                    <select
                      aria-label="Шрифт"
                      disabled={readOnly}
                      value={(selected as any).fontFamily || "Arial"}
                      onChange={(e) => update({ fontFamily: e.target.value })}
                    >
                      {[
                        "Arial",
                        "Georgia",
                        "Verdana",
                        "Courier New",
                        "Times New Roman",
                      ].map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      aria-label="Размер шрифта"
                      className="font-size"
                      value={Math.round((selected as any).fontSize || 32)}
                      min={6}
                      max={600}
                      disabled={readOnly}
                      onChange={(e) =>
                        update({
                          fontSize: Math.max(6, Math.min(600, +e.target.value)),
                        })
                      }
                    />
                    <button
                      className={
                        "tool-button " +
                        ((selected as any).fontWeight === "bold" ? "on" : "")
                      }
                      disabled={readOnly}
                      onClick={() =>
                        update({
                          fontWeight:
                            (selected as any).fontWeight === "bold"
                              ? "normal"
                              : "bold",
                        })
                      }
                    >
                      <b>B</b>
                    </button>
                    <button
                      className="tool-button"
                      disabled={readOnly}
                      onClick={() =>
                        update({
                          fontStyle:
                            (selected as any).fontStyle === "italic"
                              ? "normal"
                              : "italic",
                        })
                      }
                    >
                      <i>I</i>
                    </button>
                    <button
                      className="tool-button"
                      disabled={readOnly}
                      onClick={() =>
                        update({ underline: !(selected as any).underline })
                      }
                    >
                      <u>U</u>
                    </button>
                    {[AlignLeft, AlignCenter, AlignRight].map((Icon, i) => (
                      <button
                        className="tool-button"
                        key={i}
                        aria-label={
                          ["По левому краю", "По центру", "По правому краю"][i]
                        }
                        disabled={readOnly}
                        onClick={() =>
                          update({ textAlign: ["left", "center", "right"][i] })
                        }
                      >
                        <Icon size={16} />
                      </button>
                    ))}
                  </>
                )}
                {selected.type !== "image" && (
                  <label className="color-tool" title="Цвет">
                    <input
                      aria-label="Цвет объекта"
                      type="color"
                      disabled={readOnly}
                      value={
                        typeof selected.fill === "string" &&
                        selected.fill.startsWith("#")
                          ? selected.fill
                          : "#7048ed"
                      }
                      onChange={(e) =>
                        selected.type === "line"
                          ? update({ stroke: e.target.value })
                          : update({ fill: e.target.value })
                      }
                    />
                  </label>
                )}
                <div className="toolbar-divider" />
                <button
                  className="tool-button"
                  disabled={readOnly}
                  onClick={duplicate}
                  title="Дублировать Ctrl+D"
                  aria-label="Дублировать объект"
                >
                  <Copy size={17} />
                </button>
                <button
                  className="tool-button danger"
                  disabled={readOnly}
                  onClick={remove}
                  aria-label="Удалить объект"
                >
                  <Trash2 size={17} />
                </button>
              </>
            ) : (
              <>
                <MousePointer2 size={16} />
                <span className="muted small">
                  Выберите элемент, чтобы изменить его
                </span>
                <span className="toolbar-size">
                  {project.width} × {project.height} px
                </span>
              </>
            )}
          </div>
          <div className="canvas-scroll">
            <div className="canvas-content">
              <div className="page-caption">
                <span>Страница {page + 1}</span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Копировать страницу"
                    disabled={readOnly}
                    onClick={() => addPage(true)}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Удалить страницу"
                    disabled={readOnly || pages.length === 1}
                    onClick={removePage}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="canvas-frame">
                <canvas ref={canvasEl} />
                <div className="remote-cursors" aria-hidden="true">
                  {peers
                    .filter(
                      (peer) =>
                        peer.id !== self &&
                        peer.cursor?.page === pagesRef.current[page]?.id,
                    )
                    .map((peer, i) => (
                      <span
                        className="remote-cursor"
                        key={peer.id}
                        style={{
                          left: (peer.cursor?.x || 0) * zoom,
                          top: (peer.cursor?.y || 0) * zoom,
                          color: ["#a562cf", "#39a689", "#d77b4c", "#538acf"][
                            i % 4
                          ],
                        }}
                      >
                        ➤<b>{peer.name}</b>
                      </span>
                    ))}
                </div>
              </div>
              <button
                className="add-page"
                disabled={readOnly}
                onClick={() => addPage()}
              >
                <Plus size={16} />
                Добавить страницу
              </button>
            </div>
          </div>
          <footer className="editor-footer">
            <div className="page-controls">
              <button
                className="icon-button"
                aria-label="Предыдущая страница"
                onClick={() => switchPage(page - 1)}
                disabled={page === 0}
              >
                <ChevronUp size={17} />
              </button>
              <span>
                Страница {page + 1} из {pages.length}
              </span>
              <button
                className="icon-button"
                aria-label="Следующая страница"
                onClick={() => switchPage(page + 1)}
                disabled={page === pages.length - 1}
              >
                <ChevronDown size={17} />
              </button>
              <button
                className="icon-button"
                title="Переместить страницу назад"
                disabled={readOnly || page === 0}
                onClick={() => movePage(-1)}
              >
                <MoveUp size={15} />
              </button>
              <button
                className="icon-button"
                title="Переместить страницу вперёд"
                disabled={readOnly || page === pages.length - 1}
                onClick={() => movePage(1)}
              >
                <MoveDown size={15} />
              </button>
            </div>
            <div className="zoom-controls">
              <button
                className="icon-button"
                aria-label="Уменьшить"
                onClick={() => setScale(zoom - 0.1)}
              >
                <Minus size={16} />
              </button>
              <input
                aria-label="Масштаб"
                type="range"
                min={5}
                max={200}
                value={zoom * 100}
                onChange={(e) => setScale(+e.target.value / 100)}
              />
              <button
                className="icon-button"
                aria-label="Увеличить"
                onClick={() => setScale(zoom + 0.1)}
              >
                <Plus size={16} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
            </div>
          </footer>
        </section>
        {selected && (
          <aside className="properties-panel">
            <h4>Положение</h4>
            <div className="property-grid">
              {[
                ["X", "left"],
                ["Y", "top"],
                ["Ширина", "width"],
                ["Высота", "height"],
              ].map(([label, key]) => (
                <label key={key}>
                  {label}
                  <input
                    aria-label={"Положение " + label}
                    type="number"
                    disabled={readOnly}
                    value={Math.round(
                      key === "width"
                        ? selected.getScaledWidth()
                        : key === "height"
                          ? selected.getScaledHeight()
                          : (selected as any)[key] || 0,
                    )}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (key === "width")
                        update({
                          scaleX: Math.max(1, n) / (selected.width || 1),
                        });
                      else if (key === "height")
                        update({
                          scaleY: Math.max(1, n) / (selected.height || 1),
                        });
                      else update({ [key]: n });
                    }}
                  />
                </label>
              ))}
            </div>
            <label>
              Поворот
              <input
                aria-label="Поворот"
                type="number"
                disabled={readOnly}
                value={Math.round(selected.angle || 0)}
                onChange={(e) => update({ angle: +e.target.value })}
              />
            </label>
            <label>
              Непрозрачность {Math.round((selected.opacity ?? 1) * 100)}%
              <input
                type="range"
                aria-label="Непрозрачность"
                disabled={readOnly}
                min={0}
                max={100}
                value={(selected.opacity ?? 1) * 100}
                onChange={(e) => update({ opacity: +e.target.value / 100 })}
              />
            </label>
            <h4>Действия</h4>
            <button
              className="secondary full"
              disabled={readOnly}
              onClick={() => update({ flipX: !selected.flipX })}
            >
              Отразить по горизонтали
            </button>
            <button
              className="secondary full"
              disabled={readOnly}
              onClick={() => update({ flipY: !selected.flipY })}
            >
              Отразить по вертикали
            </button>
            <button
              className="secondary full"
              disabled={readOnly}
              onClick={() => layer(1)}
            >
              <MoveUp size={15} />
              На слой вперёд
            </button>
            <button
              className="secondary full"
              disabled={readOnly}
              onClick={() => layer(-1)}
            >
              <MoveDown size={15} />
              На слой назад
            </button>
            <button
              className="secondary full"
              disabled={readOnly}
              onClick={() => (selected.type === "group" ? ungroup() : group())}
            >
              {selected.type === "group" ? "Разгруппировать" : "Сгруппировать"}
            </button>
            <p className="tip">
              Shift + клик — выбрать несколько.
              <br />
              Стрелки — сдвиг на 1 px.
              <br />
              Shift + стрелки — на 10 px.
            </p>
          </aside>
        )}
      </div>
      {modal==='Скачать дизайн'&&exportSnapshot&&<ExportDialog design={{title:exportSnapshot.title,width:project.width,height:project.height,document:{pages:exportSnapshot.pages}}} current={exportSnapshot.current} onClose={()=>setModal('')} toast={toast}/>}
      {modal==='Массовое создание' &&<BulkCreate projectId={project.id} onClose={()=>setModal('')} onCreated={generated=>toast(`Создано дизайнов: ${generated.length}`)} toast={toast}/>}
      {modal==='Опубликовать'&&<PublishDesign projectId={project.id} onClose={()=>setModal('')} toast={toast}/>}
      {modal && !['Массовое создание','Опубликовать','Скачать дизайн'].includes(modal) && (
        <Modal title={modal} onClose={() => setModal("")}>
          {panelError && <div className="error-box">{panelError}</div>}
          {modal === "Общий доступ" && (
            <>
              <p className="muted">
                Добавьте зарегистрированного пользователя по email. Вход в
                аккаунт обязателен.
              </p>
              <div className="share-link">
                <input
                  aria-label="Ссылка на проект"
                  value={location.href}
                  readOnly
                />
                <button
                  className="secondary"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(location.href)
                      .then(() => toast("Ссылка скопирована"))
                      .catch(() => toast("Скопируйте ссылку из поля вручную"))
                  }
                >
                  <Copy size={16} />
                </button>
              </div>
              {project.role === "owner" ? (
                <form
                  className="share-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setPanelError("");
                    const form = e.currentTarget;
                    const b = Object.fromEntries(new FormData(form));
                    try {
                      await api(
                        "/projects/" + project.id + "/members",
                        json(b),
                      );
                      setMembers(
                        (await api("/projects/" + project.id + "/members"))
                          .members,
                      );
                      form.reset();
                      toast("Доступ предоставлен");
                    } catch (e) {
                      setPanelError((e as Error).message);
                    }
                  }}
                >
                  <input
                    type="email"
                    name="email"
                    placeholder="Email участника"
                    required
                  />
                  <select name="role">
                    <option value="editor">Редактор</option>
                    <option value="viewer">Читатель</option>
                  </select>
                  <button className="primary">Добавить</button>
                </form>
              ) : (
                <p className="tip">Управлять доступом может только владелец.</p>
              )}
              <div className="member-list">
                {members.map((m) => (
                  <div className="member" key={m.id}>
                    <span className="avatar">{m.name[0]}</span>
                    <div>
                      <b>{m.name}</b>
                      <small>
                        {m.email} ·{" "}
                        {m.role === "editor" ? "Редактор" : "Читатель"}
                      </small>
                    </div>
                    {project.role === "owner" && (
                      <button
                        className="icon-button danger"
                        aria-label={"Отозвать доступ " + m.email}
                        onClick={async () => {
                          try {
                            await api(
                              "/projects/" + project.id + "/members/" + m.id,
                              { method: "DELETE" },
                            );
                            setMembers(members.filter((v) => v.id !== m.id));
                          } catch (e) {
                            setPanelError((e as Error).message);
                          }
                        }}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="tip">
                Изменения появляются у участников в реальном времени. Undo
                отменяет только ваши действия. Один текстовый блок
                синхронизируется целиком; посимвольное совместное редактирование
                пока не поддерживается.
              </p>
            </>
          )}
          {modal === "История версий" && (
            <>
              <p className="muted">
                Хранятся последние 30 сохранённых состояний.
              </p>
              <div className="version-list">
                {versions.map((v) => (
                  <div className="version" key={v.id}>
                    <div>
                      <b>Версия {v.revision}</b>
                      <small>
                        {new Date(v.created).toLocaleString("ru-RU")}
                      </small>
                    </div>
                    <button
                      className="secondary"
                      disabled={readOnly}
                      onClick={async () => {
                        if (
                          !confirm(
                            "Восстановить эту версию? Текущую можно будет вернуть через историю.",
                          )
                        )
                          return;
                        try {
                          const d = await api(
                            "/projects/" + project.id + "/versions/" + v.id,
                          );
                          pagesRef.current = clone(d.document.pages);
                          pageIndex.current = 0;
                          setPage(0);
                          setPages([...pagesRef.current]);
                          titleRef.current = d.title;
                          setTitle(d.title);
                          await loadPage(0);
                          record();
                          await save();
                          setModal("");
                          toast("Версия восстановлена");
                        } catch (e) {
                          setPanelError((e as Error).message);
                        }
                      }}
                    >
                      Восстановить
                    </button>
                  </div>
                ))}
              </div>
              {!versions.length && (
                <p className="tip">
                  Версии появятся после первого сохранения изменений.
                </p>
              )}
            </>
          )}
          {modal === "Комментарии" && (
            <>
              <div className="comments">
                {comments.map((m) => (
                  <article key={m.id}>
                    <div>
                      <b>{m.name}</b>
                      <small>
                        {new Date(m.created).toLocaleString("ru-RU")}
                      </small>
                    </div>
                    <p>{m.body}</p>
                  </article>
                ))}
                {!comments.length && (
                  <p className="muted">Обсуждение проекта начинается здесь.</p>
                )}
              </div>
              {!readOnly && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setPanelError("");
                    const form = e.currentTarget;
                    const body = new FormData(form).get("body");
                    try {
                      await api(
                        "/projects/" + project.id + "/comments",
                        json({ body }),
                      );
                      setComments(
                        (await api("/projects/" + project.id + "/comments"))
                          .comments,
                      );
                      form.reset();
                    } catch (e) {
                      setPanelError((e as Error).message);
                    }
                  }}
                >
                  <textarea
                    name="body"
                    aria-label="Комментарий"
                    maxLength={2000}
                    placeholder="Оставьте комментарий…"
                    required
                  />
                  <button className="primary full">Отправить</button>
                </form>
              )}
            </>
          )}
        </Modal>
      )}
      {presentation&&<PresentationViewer pages={clone(pagesRef.current)} width={project.width} height={project.height} title={title} initialIndex={presentationIndex} onClose={()=>setPresentation(false)}/>}

    </div>
  );
}
