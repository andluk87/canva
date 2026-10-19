import type { Doc } from "yjs";
export type Snapshot = { title: string; pages: { id: string; canvas: any }[] };
export function normalize(snapshot: Snapshot): Snapshot;
export function writeSnapshot(
  doc: Doc,
  next: Snapshot,
  previous?: Snapshot,
  origin?: unknown,
): void;
export function readSnapshot(doc: Doc): Snapshot;
