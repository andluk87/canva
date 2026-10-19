import * as Y from "yjs";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID, createHash } from "node:crypto";
import {
  normalize,
  readSnapshot,
  writeSnapshot,
} from "../shared/collaboration.mjs";
const encode = (value) => Buffer.from(value).toString("base64");
const decode = (value) => new Uint8Array(Buffer.from(value, "base64"));
export function createRealtime(db, validDocument) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS collaboration(project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,state BLOB NOT NULL,revision INTEGER NOT NULL,epoch TEXT NOT NULL)",
  );
  const rooms = new Map();
  const sockets = new Set();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 20 * 1024 * 1024,
    perMessageDeflate: false,
  });
  function identity(req) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("forma_session="))
      ?.slice(14);
    if (!token) return null;
    return db
      .prepare(
        "SELECT u.id,u.name,s.expires FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
      )
      .get(createHash("sha256").update(token).digest("hex"), Date.now());
  }
  function permission(project, user) {
    return project.owner_id === user
      ? "owner"
      : db
          .prepare("SELECT role FROM members WHERE project_id=? AND user_id=?")
          .get(project.id, user)?.role;
  }
  const send = (ws, data) => {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 25 * 1024 * 1024)
        return ws.close(1013, "Slow connection");
      ws.send(JSON.stringify(data));
    }
  };
  function peers(room) {
    const list = [...room.clients].map((ws) => ({
      id: ws.connectionId,
      userId: ws.user.id,
      name: ws.user.name,
      role: ws.role,
      cursor: ws.cursor || null,
    }));
    for (const ws of room.clients) send(ws, { type: "presence", peers: list });
  }
  function persist(room, p, { thumbnail } = {}) {
    const state = readSnapshot(room.doc);
    if (
      typeof state.title !== "string" ||
      !state.title.trim() ||
      state.title.length > 200 ||
      !validDocument({ pages: state.pages })
    )
      throw new Error("Invalid shared document");
    const document = JSON.stringify({ pages: state.pages });
    const changed = document !== p.document || state.title !== p.title;
    const revision = p.revision + (changed ? 1 : 0);
    const time = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      // Keep meaningful historical checkpoints, rather than one version per keystroke.
      if (
        changed &&
        (!room.checkpoint || Date.now() - room.checkpoint >= 30000)
      ) {
        db.prepare("INSERT INTO versions VALUES(?,?,?,?,?,?)").run(
          randomUUID(),
          p.id,
          p.document,
          p.title,
          time,
          p.revision,
        );
        db.prepare(
          "DELETE FROM versions WHERE project_id=? AND id NOT IN (SELECT id FROM versions WHERE project_id=? ORDER BY revision DESC LIMIT 30)",
        ).run(p.id, p.id);
        room.checkpoint = Date.now();
      }
      db.prepare(
        "UPDATE projects SET document=?,title=?,thumbnail=?,revision=?,updated=? WHERE id=?",
      ).run(
        document,
        state.title,
        thumbnail ?? p.thumbnail,
        revision,
        changed ? time : p.updated,
        p.id,
      );
      db.prepare(
        "INSERT INTO collaboration VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET state=excluded.state,revision=excluded.revision,epoch=excluded.epoch",
      ).run(
        p.id,
        Buffer.from(Y.encodeStateAsUpdate(room.doc)),
        revision,
        room.epoch,
      );
      db.exec("COMMIT");
      room.revision = revision;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function roomFor(project) {
    let room = rooms.get(project.id);
    if (room) return room;
    const saved = db
      .prepare("SELECT * FROM collaboration WHERE project_id=?")
      .get(project.id);
    const doc = new Y.Doc();
    let epoch = saved?.epoch || randomUUID();
    if (saved && saved.revision === project.revision)
      Y.applyUpdate(doc, new Uint8Array(saved.state));
    else {
      writeSnapshot(
        doc,
        normalize({
          title: project.title,
          pages: JSON.parse(project.document).pages,
        }),
      );
      epoch = randomUUID();
    }
    db.prepare(
      "INSERT INTO collaboration VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET state=excluded.state,revision=excluded.revision,epoch=excluded.epoch",
    ).run(
      project.id,
      Buffer.from(Y.encodeStateAsUpdate(doc)),
      project.revision,
      epoch,
    );
    room = {
      id: project.id,
      doc,
      epoch,
      revision: project.revision,
      clients: new Set(),
      checkpoint: 0,
    };
    rooms.set(project.id, room);
    return room;
  }
  function refreshAccess(projectId) {
    if (!projectId) {
      for (const id of rooms.keys()) refreshAccess(id);
      return;
    }
    const room = rooms.get(projectId);
    if (!room) return;
    const p = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
    for (const ws of room.clients) {
      const user = identity(ws.request);
      const role = p && !p.deleted && user && permission(p, user.id);
      if (!role) {
        ws.close(4003, "Access revoked");
        continue;
      }
      if (ws.role !== role) {
        ws.role = role;
        send(ws, { type: "role", role });
      }
    }
    peers(room);
  }
  function restChanged(projectId, body) {
    const room = rooms.get(projectId);
    const p = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
    if (!room) {
      if (p && !body.document && !body.title)
        db.prepare(
          "UPDATE collaboration SET revision=? WHERE project_id=?",
        ).run(p.revision, projectId);
      return;
    }
    if (!p || p.deleted) {
      refreshAccess(projectId);
      return;
    }
    if (body.document || body.title) {
      const before = readSnapshot(room.doc);
      writeSnapshot(
        room.doc,
        normalize({ title: p.title, pages: JSON.parse(p.document).pages }),
        before,
        "rest",
      );
    }
    room.revision = p.revision;
    db.prepare(
      "INSERT INTO collaboration VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET state=excluded.state,revision=excluded.revision,epoch=excluded.epoch",
    ).run(
      p.id,
      Buffer.from(Y.encodeStateAsUpdate(room.doc)),
      p.revision,
      room.epoch,
    );
    for (const ws of room.clients)
      send(ws, {
        type: "update",
        update: encode(Y.encodeStateAsUpdate(room.doc)),
        revision: p.revision,
      });
  }
  wss.on("connection", (ws, req, project, user) => {
    const room = roomFor(project);
    ws.user = user;
    ws.request = req;
    ws.role = permission(project, user.id);
    ws.connectionId = randomUUID();
    ws.isAlive = true;
    ws.lastCursor = 0;
    ws.messages = 0;
    ws.window = Date.now();
    room.clients.add(ws);
    sockets.add(ws);
    send(ws, {
      type: "hello",
      id: ws.connectionId,
      epoch: room.epoch,
      role: ws.role,
      revision: room.revision,
      update: encode(Y.encodeStateAsUpdate(room.doc)),
      vector: encode(Y.encodeStateVector(room.doc)),
    });
    peers(room);
    ws.on("pong", () => (ws.isAlive = true));
    ws.on("message", (raw) => {
      const p = db.prepare("SELECT * FROM projects WHERE id=?").get(project.id);
      const u = identity(req);
      const role = p && !p.deleted && u && permission(p, u.id);
      if (!role) return ws.close(4003, "Access revoked");
      try {
        if (Date.now() - ws.window > 1000) {
          ws.messages = 0;
          ws.window = Date.now();
        }
        if (++ws.messages > 100) return ws.close(1008, "Rate limit");
        const m = JSON.parse(raw.toString());
        if (m.type === "cursor") {
          if (Date.now() - ws.lastCursor < 45) return;
          ws.lastCursor = Date.now();
          ws.cursor =
            m.cursor &&
            Number.isFinite(m.cursor.x) &&
            Number.isFinite(m.cursor.y) &&
            Math.abs(m.cursor.x) <= 6000 &&
            Math.abs(m.cursor.y) <= 6000 &&
            typeof m.cursor.page === "string"
              ? { x: m.cursor.x, y: m.cursor.y, page: m.cursor.page }
              : null;
          peers(room);
          return;
        }
        if (
          m.type !== "update" ||
          typeof m.update !== "string" ||
          !Number.isSafeInteger(m.seq)
        )
          return ws.close(1008, "Invalid message");
        if (role === "viewer") {
          send(ws, {
            type: "error",
            error: "У вас доступ только для просмотра",
          });
          return;
        }
        if (m.epoch !== room.epoch) return ws.close(4009, "Document reset");
        if (
          m.thumbnail !== undefined &&
          (typeof m.thumbnail !== "string" ||
            m.thumbnail.length > 400000 ||
            !m.thumbnail.startsWith("data:image/png;base64,"))
        )
          return ws.close(1008, "Invalid thumbnail");
        // Validate an isolated candidate before touching the accepted shared state.
        const candidate = new Y.Doc();
        try {
          Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.doc));
          Y.applyUpdate(candidate, decode(m.update));
          const next = readSnapshot(candidate);
          if (Y.encodeStateAsUpdate(candidate).length > 20 * 1024 * 1024)
            throw new Error("Shared state too large");
          if (
            !validDocument({ pages: next.pages }) ||
            typeof next.title !== "string" ||
            !next.title.trim() ||
            next.title.length > 200
          )
            throw new Error("Invalid document");
          const previous = room.doc;
          room.doc = candidate;
          try {
            persist(room, p, m);
          } catch (e) {
            room.doc = previous;
            throw e;
          }
          previous.destroy();
        } catch (e) {
          candidate.destroy();
          throw e;
        }
        for (const peer of room.clients)
          if (peer !== ws)
            send(peer, {
              type: "update",
              update: m.update,
              revision: room.revision,
            });
        send(ws, { type: "ack", seq: m.seq, revision: room.revision });
      } catch {
        send(ws, {
          type: "error",
          error:
            "Изменение не принято сервером. Сохраните локальную копию и перезагрузите проект.",
        });
        ws.close(1008, "Invalid document");
      }
    });
    ws.on("close", () => {
      room.clients.delete(ws);
      sockets.delete(ws);
      if (room.clients.size) peers(room);
      else {
        room.doc.destroy();
        rooms.delete(room.id);
      }
    });
    ws.on("error", () => {});
  });
  let heartbeat;
  const beat = () => {
    for (const ws of sockets) {
      const p = db
        .prepare("SELECT * FROM projects WHERE id=?")
        .get(ws.request.projectId);
      const u = identity(ws.request);
      if (!p || p.deleted || !u || !permission(p, u.id))
        ws.close(4003, "Access revoked");
      else if (!ws.isAlive) ws.terminate();
      else {
        ws.isAlive = false;
        ws.ping();
      }
    }
  };
  function attach(server) {
    heartbeat = setInterval(beat, 15000);
    heartbeat.unref();
    server.once("close", close);
    server.on("upgrade", (req, socket, head) => {
      let url;
      try {
        url = new URL(req.url, "http://localhost");
      } catch {
        return socket.destroy();
      }
      const match = /^\/api\/projects\/([a-zA-Z0-9-]+)\/live$/.exec(
        url.pathname,
      );
      if (!match) return socket.destroy();
      const reject = (status) => {
        socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
      };
      let sameOrigin = false;
      try {
        sameOrigin =
          !!req.headers.origin &&
          new URL(req.headers.origin).host === req.headers.host;
      } catch {}
      if (!sameOrigin) return reject("403 Forbidden");
      const user = identity(req);
      if (!user) return reject("401 Unauthorized");
      const p = db.prepare("SELECT * FROM projects WHERE id=?").get(match[1]);
      if (!p || p.deleted || !permission(p, user.id))
        return reject("404 Not Found");
      if (
        sockets.size >= 500 ||
        [...sockets].filter((ws) => ws.user.id === user.id).length >= 20
      )
        return reject("429 Too Many Requests");
      req.projectId = p.id;
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req, p, user),
      );
    });
  }
  function close() {
    clearInterval(heartbeat);
    for (const ws of sockets) ws.terminate();
    wss.close();
    for (const room of rooms.values()) room.doc.destroy();
    rooms.clear();
  }
  return { attach, refreshAccess, restChanged, close };
}
