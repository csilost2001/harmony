/**
 * 設計ファイルの「上書きされる前の版」 (fileBackup が残したもの) を、設計の種類と id で引く。
 * 画面からは、編集セッション (下書き) として復元する。AI (MCP) からは、編集中でなければ直接書き戻す。
 * 仕様: docs/spec/file-backup.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  actionsDir, resolveDataRoot, writeBusinessFlow, writeProcessFlow, writeReport, writeSequence, writeTable, writeView, writeViewDefinition,
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
  return { restoredFrom: versionIdToIso(versionId) };
}
