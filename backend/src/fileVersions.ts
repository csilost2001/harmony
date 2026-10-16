/**
 * 設計ファイルの「上書きされる前の版」 (fileBackup が残したもの) を、設計の種類と id で引く。
 * 画面からは、編集セッション (下書き) として復元する。AI (MCP) からは、編集中でなければ直接書き戻す。
 * 仕様: docs/spec/file-backup.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  actionsDir, readEntityReadOnly, readProject, resolveDataRoot, writeProject, writeBusinessFlow, writePageLayout, writeProcessFlow, writeReport, writeSequence, writeTable, writeView, writeViewDefinition,
} from "./projectStorage.js";
import { listBackupVersions, readBackupVersion, versionIdToIso, type BackupVersion } from "./fileBackup.js";
import { assertSafeName } from "./security/idValidator.js";

/** 版を引ける設計の種類 (編集セッションの resourceType) と、そのファイルの置き場所 (データフォルダからの相対) */
const DIRS: Record<string, string> = {
  "table": "tables",
  "process-flow": "process-flows",
  "view": "views",
  "view-definition": "view-definitions",
  "sequence": "sequences",
  "business-flow": "business-flows",
  "report": "reports",
  "page-layout": "page-layouts",
};
export const VERSIONED_RESOURCE_TYPES = Object.keys(DIRS);

/** 設計の種類 + id から、ワークスペースからの相対パス (例: `harmony/tables/orders.json`) */
export async function versionedRelPath(root: string, resourceType: string, resourceId: string): Promise<string> {
  const dir = DIRS[resourceType];
  if (!dir) throw new Error(`この種類 (${resourceType}) は、保存前の版に対応していません (対応: ${VERSIONED_RESOURCE_TYPES.join(" / ")})`);
  assertSafeName(resourceId, "id");
  const dataRoot = await resolveDataRoot(root);
  let file = path.join(dataRoot, dir, `${resourceId}.json`);
  if (resourceType === "process-flow") {
    // 古い配置 (actions/) にしか無い処理フローは、そちらのファイル
    const exists = await fs.access(file).then(() => true, () => false);
    const legacy = path.join(actionsDir(dataRoot), `${resourceId}.json`);
    if (!exists && await fs.access(legacy).then(() => true, () => false)) file = legacy;
  }
  return path.relative(root, file).split(path.sep).join("/");
}

export async function listEntityVersions(root: string, resourceType: string, resourceId: string): Promise<BackupVersion[]> {
  return listBackupVersions(root, await versionedRelPath(root, resourceType, resourceId));
}

/** 版の中身 (JSON として読めること、設計の id が合っていることを確かめて返す) */
export async function readEntityVersion(root: string, resourceType: string, resourceId: string, versionId: string): Promise<unknown> {
  const rel = await versionedRelPath(root, resourceType, resourceId);
  const raw = await readBackupVersion(root, rel, versionId);
  if (raw === null) throw new Error(`版 ${versionId} が見つかりません (古い版は自動で消えます)`);
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error(`版 ${versionId} は JSON として読めないため、戻せません`); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`版 ${versionId} の中身が設計の形ではありません`);
  const d = data as Record<string, unknown>;
  const id = resourceType === "process-flow" ? (d.meta as Record<string, unknown> | undefined)?.id : d.id;
  if (typeof id === "string" && id !== resourceId) throw new Error(`版 ${versionId} の id (${id}) が、戻し先 (${resourceId}) と違います`);
  return data;
}

/** 通常の保存と同じ書き込み (uuid の不変・保存時の整理・一意性の検査を通る)。呼ぶときに引く (読み込み時に storage の関数を束ねない) */
const writerFor = (resourceType: string): ((id: string, data: unknown, root: string) => Promise<unknown>) | undefined => ({
  "table": writeTable,
  "process-flow": writeProcessFlow,
  "view": writeView,
  "view-definition": writeViewDefinition,
  "sequence": writeSequence,
  "business-flow": (id: string, data: unknown, root: string) => writeBusinessFlow(id, data, root),
  "report": (id: string, data: unknown, root: string) => writeReport(id, data, root),
  "page-layout": (id: string, data: unknown, root: string) => writePageLayout(id, data, root),
} as Record<string, (id: string, data: unknown, root: string) => Promise<unknown>>)[resourceType];

/**
 * AI 用: 版を、通常の保存と同じ経路で書き戻す (現在の内容は、書き戻しの前に世代として残る)。
 * uuid は、いまの設計のものを保つ (版が、削除→作り直しの前の別の uuid でも、設計の同一性は変えない)。
 */
export async function restoreEntityVersionToFile(root: string, resourceType: string, resourceId: string, versionId: string): Promise<{ restoredFrom: string }> {
  const data = await readEntityVersion(root, resourceType, resourceId, versionId) as Record<string, unknown>;
  const write = writerFor(resourceType);
  if (!write) throw new Error(`この種類 (${resourceType}) は、保存前の版に対応していません`);
  const next = structuredClone(data);
  delete next.uuid;
  if (resourceType === "process-flow" && next.meta && typeof next.meta === "object") delete (next.meta as Record<string, unknown>).uuid;
  await write(resourceId, next, root);
  await syncRegistryEntry(root, resourceType, resourceId); // 一覧の名前・列数・更新日時を、書き戻した内容に合わせる (画面の保存・update_table と同じ)
  return { restoredFrom: versionIdToIso(versionId) };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const pick = (src: Record<string, unknown>, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));

/** 一覧 (harmony.json の entities.<種類>) に載せる要約。画面・MCP の保存 (tableStore の syncTableMeta など) と同じ項目 */
const REGISTRY: Record<string, { key: string; kind: "table" | "processFlow" | "view" | "viewDefinition" | "sequence"; summary: (d: Record<string, unknown>) => Record<string, unknown> }> = {
  "table": { key: "tables", kind: "table", summary: (d) => ({ ...pick(d, ["name", "physicalName", "category", "maturity", "updatedAt"]), columnCount: Array.isArray(d.columns) ? d.columns.length : 0 }) },
  "process-flow": { key: "processFlows", kind: "processFlow", summary: (d) => { const m = isRecord(d.meta) ? d.meta : {}; return { ...pick(m, ["name", "flowType", "maturity", "updatedAt"]), actionCount: Array.isArray(d.actions) ? d.actions.length : 0 }; } },
  "view": { key: "views", kind: "view", summary: (d) => pick(d, ["name", "physicalName", "maturity", "updatedAt"]) },
  "view-definition": { key: "viewDefinitions", kind: "viewDefinition", summary: (d) => ({ ...pick(d, ["name", "kind", "sourceTableId", "maturity", "updatedAt"]), columnCount: Array.isArray(d.columns) ? d.columns.length : 0 }) },
  "sequence": { key: "sequences", kind: "sequence", summary: (d) => pick(d, ["name", "physicalName", "conventionRef", "maturity", "updatedAt"]) },
};

/** 書き戻した設計の要約を、一覧 (harmony.json) の項目へ反映する (一覧に載っている項目だけ。並び番号は保つ)。業務フロー・帳票は、一覧に載らない */
async function syncRegistryEntry(root: string, resourceType: string, id: string): Promise<void> {
  const r = REGISTRY[resourceType];
  if (!r) return;
  const project = await readProject(root);
  if (!isRecord(project) || !isRecord(project.entities) || !Array.isArray(project.entities[r.key])) return;
  const list = project.entities[r.key] as unknown[];
  const idx = list.findIndex((e) => isRecord(e) && e.id === id);
  if (idx < 0) return;
  const saved = await readEntityReadOnly(r.kind, id, root);
  if (!isRecord(saved)) return;
  const next = [...list];
  next[idx] = { ...(list[idx] as Record<string, unknown>), ...r.summary(saved) };
  await writeProject({ ...project, entities: { ...project.entities, [r.key]: next } }, root);
}
