import * as Y from "yjs";
import {getDocument,putDocument,cacheGeneration} from "./offline/store.mjs";
import {
  readSnapshot,
  writeSnapshot,
  type Snapshot,
} from "../shared/collaboration.mjs";
export type Peer = {
  id: string;
  userId: string;
  name: string;
  role: string;
  cursor: { x: number; y: number; page: string } | null;
};
type Options = {
  projectId: string;
  userId: string;
  onSnapshot: (state: Snapshot) => void;
  onStatus: (status: string) => void;
  onPeers: (peers: Peer[], self: string) => void;
  onRole: (role: string) => void;
  onError: (error: string) => void;
  onHistory: () => void;
};
const encode = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export class Collaboration {
  doc = new Y.Doc();
  undoManager!: Y.UndoManager;
  view: Snapshot = { title: "", pages: [] };
  ready = false;
  connected = false;
  role = "viewer";
  revision = 0;
  self = "";
  pending = false;
  private socket: WebSocket | null = null;
  private options: Options;
  private stopped = false;
  private denied = false;
  private epoch = "";
  private seq = 0;
  private acknowledged = 0;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private localOrigin = {};
  private syncing = false;
  private lastUpdate: Uint8Array | null = null;
  private thumbnail: string | undefined;
  private localVersion=0;
  private persistedVersion=-1;
  private persistence:Promise<void>=Promise.resolve();
  private storageFailed=false;
  private cacheReady=false;
  private cacheGeneration:number;
  private online=()=>{if(!this.connected&&!this.stopped&&!this.denied){if(this.timer)clearTimeout(this.timer);this.connect()}};
  private waiters: {
    seq: number;
    resolve: () => void;
    reject: (e: Error) => void;
  }[] = [];
  constructor(options: Options) {
    this.options = options;
    this.cacheGeneration=cacheGeneration(options.userId);
    this.bindDocument();
    addEventListener('online',this.online);
    void this.initialize();
  }
  private bindDocument(){
    this.undoManager = new Y.UndoManager(
      [this.doc.getMap("project"), this.doc.getMap("pages")],
      { trackedOrigins: new Set([this.localOrigin]), captureTimeout: 350 },
    );
    this.undoManager.on("stack-item-added", () => this.options.onHistory());
    this.undoManager.on("stack-item-popped", () => this.options.onHistory());
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "server"||origin === "restore") return;
      this.lastUpdate = this.lastUpdate
        ? Y.mergeUpdates([this.lastUpdate, update])
        : update;
      this.pending = true;
      this.options.onStatus(
        this.connected ? "Сохраняем…" : "Офлайн — сохраняем на устройство…",
      );
      void this.persistLocal();
      if (this.ready && !this.syncing) this.sendPending();
      if (origin === this.undoManager)
        this.options.onSnapshot(readSnapshot(this.doc));
    });
  }
  private async initialize(){
    try{
      const cached=await getDocument(this.options.userId,this.options.projectId);
      if(this.stopped)return;
      this.cacheReady=true;
      if(cached?.state){
        Y.applyUpdate(this.doc,new Uint8Array(cached.state),'restore');
        const state=readSnapshot(this.doc);
        if(!state.pages.length)throw new Error('Пустой локальный документ');
        this.epoch=cached.epoch;this.role=cached.role;this.revision=cached.revision;this.pending=cached.pending;
        this.ready=true;this.persistedVersion=this.localVersion;
        this.options.onRole(this.role);this.options.onSnapshot(state);
        this.options.onStatus(this.pending?'Офлайн — сохранено на устройстве':'Локальная копия — подключаемся…');
      }
    }catch{this.options.onError('Локальная копия недоступна. Не закрывайте несохранённый проект.');}
    if(!this.stopped)this.connect();
  }
  private persistLocal():Promise<void>{
    if(this.stopped)return Promise.resolve();
    const version=++this.localVersion;
    const record={state:Y.encodeStateAsUpdate(this.doc),epoch:this.epoch,role:this.role,revision:this.revision,pending:this.pending};
    this.persistence=this.persistence.catch(()=>{}).then(async()=>{
      try{await putDocument(this.options.userId,this.options.projectId,record,this.cacheGeneration);this.cacheReady=true;this.storageFailed=false;this.persistedVersion=version;
        if(!this.stopped&&!this.connected&&version===this.localVersion)this.options.onStatus('Офлайн — сохранено на устройстве');
      }catch{this.storageFailed=true;if(!this.stopped){this.options.onStatus('Ошибка сохранения на устройство');this.options.onError('Не удалось записать локальные изменения. Освободите место или экспортируйте JSON.');}}
    });
    return this.persistence;
  }
  get durable(){return this.cacheReady&&!this.storageFailed&&this.persistedVersion===this.localVersion;}
  private connect() {
    if (this.stopped || this.denied) return;
    const url = new URL(
      "/api/projects/" + this.options.projectId + "/live",
      location.href,
    );
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.options.onStatus("Подключаем совместную работу…");
    const ws = new WebSocket(url);
    this.socket = ws;
    ws.onmessage = (e) => {
      if (this.stopped || ws !== this.socket) return;
      try {
        const m = JSON.parse(e.data);
        if (m.type === "hello") {
          if(this.epoch&&this.epoch!==m.epoch&&!this.pending){this.undoManager.destroy();this.doc.destroy();this.doc=new Y.Doc();this.view={title:'',pages:[]};this.bindDocument();}
          if (this.epoch && this.epoch !== m.epoch && this.pending) {
            this.denied = true;
            this.options.onRole("viewer");
            this.options.onError(
              "Состояние проекта обновлено вне совместной сессии. Экспортируйте локальный JSON и перезагрузите страницу.",
            );
            ws.close();
            return;
          }
          this.epoch = m.epoch;
          this.self = m.id;
          this.role = m.role;
          this.revision = m.revision;
          this.options.onRole(m.role);
          this.syncing = true;
          Y.applyUpdate(this.doc, decode(m.update), "server");
          this.syncing = false;
          this.ready = true;
          this.connected = true;
          this.retry = 0;
          if (this.pending && this.role === "viewer") {
            this.denied = true;
            this.options.onError(
              "Права редактирования отозваны. Локальные изменения не отправлены.",
            );
            ws.close();
            return;
          }
          if (this.pending) {
            this.lastUpdate = Y.encodeStateAsUpdate(this.doc, decode(m.vector));
            this.sendPending();
          } else this.options.onStatus("Сохранено");
          this.options.onSnapshot(readSnapshot(this.doc));
          void this.persistLocal();
        } else if (m.type === "update") {
          this.revision = m.revision;
          let changed = false;
          const track = () => (changed = true);
          this.doc.on("update", track);
          try {
            Y.applyUpdate(this.doc, decode(m.update), "server");
          } finally {
            this.doc.off("update", track);
          }
          if (changed) {this.options.onSnapshot(readSnapshot(this.doc));void this.persistLocal();}
        } else if (m.type === "ack") {
          this.revision = m.revision;
          this.acknowledged = Math.max(this.acknowledged, m.seq);
          this.waiters = this.waiters.filter((w) => {
            if (w.seq <= this.acknowledged) {
              w.resolve();
              return false;
            }
            return true;
          });
          if (this.acknowledged === this.seq && !this.lastUpdate) {
            this.pending = false;
            this.options.onStatus("Сохранено");
            void this.persistLocal();
          }
        } else if (m.type === "presence")
          this.options.onPeers(m.peers, this.self);
        else if (m.type === "role") {
          this.role = m.role;
          this.options.onRole(m.role);
          void this.persistLocal();
          if (m.role === "viewer" && this.pending) {
            this.denied = true;
            this.options.onError(
              "Права изменены: локальные изменения не сохранены.",
            );
            ws.close();
          }
        } else if (m.type === "error") {
          this.options.onError(m.error);
          this.denied = true;
          this.options.onStatus("Ошибка сохранения");
          this.rejectWaiters(m.error);
        }
      } catch {
        this.options.onError(
          "Не удалось прочитать обновление совместного проекта",
        );
        ws.close();
      }
    };
    ws.onclose = (e) => {
      if (this.stopped || ws !== this.socket) return;
      this.connected = false;
      this.options.onPeers([], this.self);
      if ([4003, 4009, 1008].includes(e.code) || this.denied) {
        this.denied = true;
        this.options.onRole("viewer");
        this.options.onStatus("Доступ к сессии закрыт");
        this.rejectWaiters(
          "Доступ к сессии закрыт. Экспортируйте локальный JSON перед перезагрузкой.",
        );
        if (e.code === 4003)
          this.options.onError("Доступ отозван или сессия завершена.");
        return;
      }
      this.options.onStatus(
        this.pending
          ? (this.durable?"Офлайн — сохранено на устройстве":"Офлайн — сохраняем на устройство…")
          : "Переподключаемся…",
      );
      this.timer = setTimeout(
        () => this.connect(),
        Math.min(10000, 500 * 2 ** this.retry++),
      );
    };
    ws.onerror = () => {};
  }
  markDisplayed(snapshot: Snapshot) {
    this.view = JSON.parse(JSON.stringify(snapshot));
  }
  publish(snapshot: Snapshot, thumbnail?: string) {
    if (!this.ready || this.denied || this.role === "viewer") return;
    this.thumbnail = thumbnail;
    writeSnapshot(this.doc, snapshot, this.view, this.localOrigin);
    this.markDisplayed(snapshot);
    if (thumbnail && !this.pending) {
      this.lastUpdate = Y.encodeStateAsUpdate(
        this.doc,
        Y.encodeStateVector(this.doc),
      );
      this.pending = true;
      this.sendPending();
    }
  }
  private sendPending() {
    if (
      !this.connected ||
      this.socket?.readyState !== WebSocket.OPEN ||
      !this.lastUpdate ||
      this.role === "viewer"
    )
      return;
    const update = this.lastUpdate;
    this.lastUpdate = null;
    this.socket.send(
      JSON.stringify({
        type: "update",
        epoch: this.epoch,
        seq: ++this.seq,
        update: encode(update),
        ...(this.thumbnail ? { thumbnail: this.thumbnail } : {}),
      }),
    );
  }
  async flush() {
    if (this.denied) throw new Error("Доступ к совместной сессии закрыт");
    if(!this.connected){await this.persistLocal();if(!this.durable)throw new Error('Нет связи и не удалось сохранить копию на устройство.');return;}
    this.sendPending();
    if (!this.pending) return;
    const seq = this.seq;
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        seq,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(
          new Error(
            "Не получено подтверждение сохранения. Проверьте соединение.",
          ),
        );
      }, 15000);
      this.waiters.push(waiter);
    });
  }
  undo(direction: number) {
    if (!this.ready || this.role === "viewer" || this.denied) return;
    if (direction < 0) this.undoManager.undo();
    else this.undoManager.redo();
  }
  get snapshot() {
    return readSnapshot(this.doc);
  }
  get canUndo() {
    return this.undoManager.undoStack.length > 0;
  }
  get canRedo() {
    return this.undoManager.redoStack.length > 0;
  }
  cursor(cursor: Peer["cursor"]) {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ type: "cursor", cursor }));
  }
  private rejectWaiters(message: string) {
    for (const w of this.waiters) w.reject(new Error(message));
    this.waiters = [];
  }
  destroy() {
    this.stopped = true;
    removeEventListener('online',this.online);
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.rejectWaiters("Редактор закрыт");
    this.undoManager.destroy();
    this.doc.destroy();
  }
}
