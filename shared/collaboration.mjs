import * as Y from "yjs";
const copy = (value) => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pageFields=['notes','transition'];
function pageMetadata(page){
  const legacy=page.get('metadata')?.toJSON()||{};
  return Object.fromEntries(pageFields.map(key=>[key,page.has(key)?page.get(key):legacy[key]]).filter(([,value])=>value!==null&&value!==undefined));
}
export function normalize(snapshot) {
  const result = copy(snapshot);
  for (const page of result.pages) {
    page.id ||= crypto.randomUUID();
    for (const object of page.canvas.objects) object.id ||= crypto.randomUUID();
  }
  return result;
}
function fields(map, next, previous = {}) {
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (equal(next[key], previous[key])) continue;
    if (next[key] === undefined) map.delete(key);
    else map.set(key, copy(next[key]));
  }
}
// Only apply differences relative to what this editor actually displayed.
// A remote property/object unknown to the local view must never be overwritten.
export function writeSnapshot(
  doc,
  next,
  previous = { pages: [], title: "" },
  origin = null,
) {
  doc.transact(() => {
    const root = doc.getMap("project"),
      pages = doc.getMap("pages");
    if (next.title !== previous.title) root.set("title", next.title);
    const before = new Map(previous.pages.map((p) => [p.id, p]));
    const after = new Set(next.pages.map((p) => p.id));
    for (const p of previous.pages) if (!after.has(p.id)) pages.delete(p.id);
    next.pages.forEach((page, index) => {
      const old = before.get(page.id);
      let node = pages.get(page.id);
      if (!node) {
        if (old) return;
        node = new Y.Map();
        pages.set(page.id, node);
        node.set("canvas", new Y.Map());
        node.set("objects", new Y.Map());
      }
      if (!old || previous.pages.findIndex((p) => p.id === page.id) !== index)
        node.set("position", index);
      // Existing page maps are shared already. Concurrently creating a nested
      // metadata map in legacy documents could replace another editor's notes.
      // Null explicitly clears an older nested value without resurrecting it.
      for(const key of pageFields)if(!equal(page[key],old?.[key]))node.set(key,page[key]===undefined?null:copy(page[key]));
      const { objects, ...meta } = page.canvas,
        { objects: oldObjects = [], ...oldMeta } = old?.canvas || {};
      fields(node.get("canvas"), meta, oldMeta);
      const entries = node.get("objects"),
        oldById = new Map(oldObjects.map((o) => [o.id, o])),
        keep = new Set(objects.map((o) => o.id));
      for (const o of oldObjects) if (!keep.has(o.id)) entries.delete(o.id);
      objects.forEach((object, i) => {
        const oldObject = oldById.get(object.id);
        let entry = entries.get(object.id);
        if (!entry) {
          if (oldObject) return;
          entry = new Y.Map();
          entries.set(object.id, entry);
          entry.set("data", new Y.Map());
        }
        if (!oldObject || oldObjects.findIndex((o) => o.id === object.id) !== i)
          entry.set("position", i);
        fields(entry.get("data"), object, oldObject || {});
      });
    });
  }, origin);
}
const ordered = (map) =>
  [...map.entries()].sort(
    ([aid, a], [bid, b]) =>
      (a.get("position") || 0) - (b.get("position") || 0) ||
      aid.localeCompare(bid),
  );
export function readSnapshot(doc) {
  return {
    title: doc.getMap("project").get("title") || "Новый дизайн",
    pages: ordered(doc.getMap("pages")).map(([id, p]) => ({
      id,
      ...pageMetadata(p),
      canvas: {
        ...p.get("canvas").toJSON(),
        objects: ordered(p.get("objects")).map(([, o]) =>
          o.get("data").toJSON(),
        ),
      },
    })),
  };
}
