/**
 * 一覧 (harmony.json の entities.<種類>) に載っていないファイルを、一覧に足した project を返す (書き込まない)。
 *
 * 原本はファイルで、一覧は並び順・画面フローの内容・一覧表示用の要約を持つ。ファイルを手で置いた・AI が作った
 * などで一覧に載っていない設計が、設計書・検査・一覧画面から黙って落ちないように、読み出すときに足す。
 * 足した分は、利用者が次に保存したとき (project の保存) に一覧へ書かれる。読み込みでは原本を書き換えない。
 */
import { listAllTables, listExistingEntityIds, listProcessFlows, readProject, readScreenEntity } from "./projectStorage.js";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export interface UnregisteredEntity { kind: "screen" | "table" | "processFlow"; id: string }

type Entry = Record<string, unknown>;

function entryList(entities: Record<string, unknown>, key: string): Entry[] {
  const v = entities[key];
  return Array.isArray(v) ? (v as Entry[]) : [];
}

export async function mergeUnregisteredEntities(project: unknown, root: string): Promise<{ project: unknown; unregistered: UnregisteredEntity[] }> {
  if (!isRecord(project)) return { project, unregistered: [] };
  const entities: Record<string, unknown> = isRecord(project.entities) ? { ...project.entities } : {};
  const unregistered: UnregisteredEntity[] = [];

  // 画面
  const screens = [...entryList(entities, "screens")];
  const screenIds = new Set(screens.map((e) => e.id));
  for (const id of (await listExistingEntityIds("screen", root).catch(() => [] as string[])).sort()) {
    if (screenIds.has(id)) continue;
    const e = await readScreenEntity(id, root).catch(() => null);
    if (!isRecord(e)) continue;
    screens.push({
      id, no: screens.length + 1, name: str(e.name) ?? id,
      ...(str(e.kind) ? { kind: e.kind } : {}), ...(str(e.purpose) ? { purpose: e.purpose } : {}), ...(str(e.path) ? { path: e.path } : {}),
      ...(str(e.groupId) ? { groupId: e.groupId } : {}), ...(str(e.maturity) ? { maturity: e.maturity } : {}), ...(str(e.updatedAt) ? { updatedAt: e.updatedAt } : {}),
    });
    unregistered.push({ kind: "screen", id });
  }

  // テーブル
  const tables = [...entryList(entities, "tables")];
  const tableIds = new Set(tables.map((e) => e.id));
  for (const t of (await listAllTables(root).catch(() => [] as unknown[]))) {
    if (!isRecord(t) || typeof t.id !== "string" || tableIds.has(t.id)) continue;
    tables.push({
      id: t.id, no: tables.length + 1, name: str(t.name) ?? t.id, ...(str(t.physicalName) ? { physicalName: t.physicalName } : {}),
      ...(str(t.category) ? { category: t.category } : {}), columnCount: Array.isArray(t.columns) ? t.columns.length : 0,
      ...(str(t.maturity) ? { maturity: t.maturity } : {}), ...(str(t.updatedAt) ? { updatedAt: t.updatedAt } : {}),
    });
    unregistered.push({ kind: "table", id: t.id });
  }

  // 処理フロー
  const flows = [...entryList(entities, "processFlows")];
  const flowIds = new Set(flows.map((e) => e.id));
  for (const f of (await listProcessFlows(root).catch(() => [] as unknown[]))) {
    const meta = isRecord(f) && isRecord(f.meta) ? f.meta : null;
    if (!meta || typeof meta.id !== "string" || flowIds.has(meta.id)) continue;
    flows.push({
      id: meta.id, no: flows.length + 1, name: str(meta.name) ?? meta.id, ...(str(meta.flowType) ? { flowType: meta.flowType } : {}),
      actionCount: Array.isArray((f as Record<string, unknown>).actions) ? ((f as Record<string, unknown>).actions as unknown[]).length : 0,
      ...(str(meta.maturity) ? { maturity: meta.maturity } : {}), ...(str(meta.updatedAt) ? { updatedAt: meta.updatedAt } : {}),
    });
    unregistered.push({ kind: "processFlow", id: meta.id });
  }

  if (unregistered.length === 0) return { project, unregistered };
  return { project: { ...project, entities: { ...entities, screens, tables, processFlows: flows } }, unregistered };
}

/** readProject + 一覧に載っていない設計を足したもの (書き込まない) */
export async function readProjectWithUnregistered(root: string): Promise<{ project: unknown; unregistered: UnregisteredEntity[] }> {
  return mergeUnregisteredEntities(await readProject(root), root);
}
