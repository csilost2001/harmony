/** 改訂履歴の下書き: 「保存前の版」(.harmony-backups) の記録から、ある日以降に更新された設計を拾って、変更の要約を作る */
import fs from "node:fs/promises";
import path from "node:path";
import { OPS_ENTITY_LABELS, type OpsEntityKind } from "@harmony/shared";
import { BACKUP_DIR, versionIdToIso } from "../fileBackup.js";
import { readEntityJson } from "./entityHash.js";

const DIR_KIND: Record<string, OpsEntityKind> = { screens: "screen", tables: "table", "process-flows": "processFlow", actions: "processFlow", "business-flows": "businessFlow", reports: "report", sequences: "sequence", views: "view", "view-definitions": "viewDefinition" };

export interface RevisionSuggestion { since: string; items: Array<{ kind: OpsEntityKind; id: string; name: string; saves: number; lastAt: string }>; text: string; truncated: boolean }

async function walkBackups(dir: string, rel: string[], out: Array<{ rel: string[]; versions: string[] }>, depth = 0): Promise<void> {
  if (depth > 6) return;
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.endsWith(".json")) {
      const versions = (await fs.readdir(path.join(dir, e.name)).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
      out.push({ rel: [...rel, e.name], versions });
    } else await walkBackups(path.join(dir, e.name), [...rel, e.name], out, depth + 1);
  }
}

export async function suggestRevision(root: string, sinceIso: string): Promise<RevisionSuggestion> {
  const files: Array<{ rel: string[]; versions: string[] }> = [];
  await walkBackups(path.join(root, BACKUP_DIR), [], files);
  const byEntity = new Map<string, { kind: OpsEntityKind; id: string; saves: number; lastAt: string }>();
  for (const f of files) {
    const dirName = f.rel[f.rel.length - 2];
    const kind = DIR_KIND[dirName];
    if (!kind) continue;
    const id = f.rel[f.rel.length - 1].slice(0, -5);
    const times = f.versions.map(versionIdToIso).filter((t) => t >= sinceIso);
    if (!times.length) continue;
    const key = `${kind}:${id}`;
    const cur = byEntity.get(key);
    const last = times.sort().at(-1)!;
    byEntity.set(key, { kind, id, saves: (cur?.saves ?? 0) + times.length, lastAt: cur && cur.lastAt > last ? cur.lastAt : last });
  }
  const sorted = [...byEntity.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const LIMIT = 100;
  const items = [];
  for (const e of sorted.slice(0, LIMIT)) {
    const j = (await readEntityJson(root, e.kind, e.id).catch(() => null)) as { name?: unknown; meta?: { name?: unknown } } | null;
    const name = (j && (typeof j.name === "string" ? j.name : typeof j.meta?.name === "string" ? j.meta.name : "")) || e.id;
    items.push({ ...e, name });
  }
  const lines = items.map((i) => `${OPS_ENTITY_LABELS[i.kind]}「${i.name}」を更新 (${i.saves} 回)`);
  return { since: sinceIso, items, text: lines.join("\n"), truncated: sorted.length > LIMIT };
}
