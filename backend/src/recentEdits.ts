/**
 * 最近編集した設計 (画面・テーブル・処理フロー) を、ファイルの更新時刻の新しい順に返す (ダッシュボード用)。
 * 1 回の問い合わせで済ませる (設計ごとに更新時刻を尋ねると、大きなプロジェクトで数千回の往復になる)。書き込まない。
 */
import { entityFileMtime, listExistingEntityIds } from "./projectStorage.js";
import { readProjectWithUnregistered } from "./registryMerge.js";

export interface RecentEdit { kind: "screen" | "table" | "processFlow"; id: string; name: string; mtime: number }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export async function recentEdits(root: string, limit = 10): Promise<RecentEdit[]> {
  const project = (await readProjectWithUnregistered(root)).project;
  const entities = isRecord(project) && isRecord(project.entities) ? project.entities : {};
  const names = (key: string): Map<string, string> => {
    const m = new Map<string, string>();
    for (const e of Array.isArray(entities[key]) ? (entities[key] as unknown[]) : []) {
      if (isRecord(e) && typeof e.id === "string") m.set(e.id, typeof e.name === "string" && e.name ? e.name : (typeof e.physicalName === "string" ? e.physicalName : e.id));
    }
    return m;
  };
  const kinds: Array<{ kind: RecentEdit["kind"]; store: "screen" | "table" | "processFlow"; key: string }> = [
    { kind: "screen", store: "screen", key: "screens" },
    { kind: "table", store: "table", key: "tables" },
    { kind: "processFlow", store: "processFlow", key: "processFlows" },
  ];
  const all: RecentEdit[] = [];
  for (const { kind, store, key } of kinds) {
    const nameOf = names(key);
    const ids = await listExistingEntityIds(store, root).catch(() => [] as string[]);
    const stamped = await Promise.all(ids.map(async (id) => ({ id, mtime: await entityFileMtime(store, id, root) })));
    for (const { id, mtime } of stamped) if (mtime !== null) all.push({ kind, id, name: nameOf.get(id) ?? id, mtime });
  }
  return all.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}
