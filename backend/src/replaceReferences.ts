/**
 * 参照の付け替え (UI 改善提案 第 3 弾 #60)。ある設計 (A) を参照している設計のうち、選んだものの参照を、別の設計 (B) へ付け替える。
 * 改名 (renameEntity.ts) と違い、A は残る (A のファイルも、A の位置情報も変えない)。
 * 参照の見つけ方・書き換え方は、改名と同じ (scanAllRefs)。単位は、参照元の設計 (ファイル) ごと: 選んだ設計の中の A への参照は、すべて B になる。
 * 予行 (何がどう変わるか) → 実行 (書き換える前の版を残し、途中で失敗したら元に戻す) → 取り消し (5 分以内、あいだに編集されていなければ)。
 * 業務フロー・帳票の参照は、付け替えの対象外 (予行の注意に出す)。
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { backupBeforeOverwrite } from "./fileBackup.js";
import { openJournal, planFromAbsolute } from "./operationJournal.js";
import { acquireWorkspaceLock } from "./renameLock.js";
import { readFileContentOrNull } from "./renameCommon.js";
import { detectConcurrentEditRefs, scanAllRefs, toRel, writeFileContent } from "./renameEntity.js";
import { listExistingEntityIds, renameBusinessFlowRefsInProject, renameReportRefsInProject, resolveDataRoot } from "./projectStorage.js";
import type { RenameEntityType, RenameOpts } from "./renameTypes.js";

/** 付け替えの対象にする参照元の種類 (位置情報・プロジェクト設定・独自部品の定義は対象外) */
const REPLACEABLE_KINDS = new Set(["processFlow", "screen", "view", "viewDefinition", "pageLayout", "table", "sequence", "genericDefinition"]);

export interface ReplaceFile {
  /** dataRoot からの相対パス */
  filePath: string;
  entityKind: string;
  entityId: string;
  /** その設計の中の、付け替わる参照の数 */
  count: number;
}

export interface ReplacePreview {
  entityType: RenameEntityType;
  fromId: string;
  toId: string;
  fromExists: boolean;
  toExists: boolean;
  files: ReplaceFile[];
  totalRefs: number;
  /** 付け替え先にできる設計の ID (同じ種類。付け替え元は除く) */
  candidates: string[];
  /** 付け替えられない参照があること (業務フロー・帳票) などの注意 */
  warnings: string[];
  /** 参照元を、ほかの人が編集中 (付け替えると、あとの保存で巻き戻る) */
  concurrentEditRefs: Array<{ entityKind: string; entityId: string; sessionId: string }>;
}

export interface ReplaceResult {
  operationId: string;
  replaced: ReplaceFile[];
  undoTtlMs: number;
}

const UNDO_TTL_MS = 5 * 60 * 1000;
interface UndoEntry { operationId: string; root: string; ts: number; files: Array<{ abs: string; before: string; after: string }> }
const undoStore = new Map<string, UndoEntry>();
const sweep = () => { const now = Date.now(); for (const [k, v] of undoStore) if (now - v.ts > UNDO_TTL_MS) undoStore.delete(k); };
export function _clearReplaceUndoForTest(): void { undoStore.clear(); }

async function plan(entityType: RenameEntityType, fromId: string, toId: string, root: string, only: readonly string[] | undefined, opts?: RenameOpts, fresh = false) {
  const dataRoot = await resolveDataRoot(root);
  const existing = await listExistingEntityIds(entityType, root);
  const scan = await scanAllRefs(entityType, fromId, toId, root, { enforceFresh: fresh });
  const onlySet = only ? new Set(only) : null;
  const counts = new Map<string, ReplaceFile>();
  for (const loc of scan.locations) {
    if (!REPLACEABLE_KINDS.has(loc.entityKind)) continue;
    if (loc.entityKind === entityType && loc.entityId === fromId) continue; // 自分自身の中の参照 (自己参照) は、触らない
    if (onlySet && !onlySet.has(loc.filePath)) continue;
    const cur = counts.get(loc.filePath);
    if (cur) cur.count++; else counts.set(loc.filePath, { filePath: loc.filePath, entityKind: loc.entityKind, entityId: loc.entityId, count: 1 });
  }
  const files = [...counts.values()].sort((a, b) => a.filePath.localeCompare(b.filePath));
  // 付け替えの対象にする設計だけの scan (編集中の検出用)
  const filtered = { ...scan, locations: scan.locations.filter((l) => counts.has(l.filePath)) };
  const concurrentEditRefs = await detectConcurrentEditRefs(filtered, entityType, fromId, opts, root);
  const warnings: string[] = [];
  if (entityType === "screen" || entityType === "processFlow") {
    const ids = (await renameBusinessFlowRefsInProject(entityType, fromId, "", root, true)).changed;
    if (ids.length > 0) warnings.push(`業務フロー ${ids.join(", ")} の参照は、付け替えの対象外です (業務フローの画面で直してください)`);
  }
  if (entityType === "screen" || entityType === "processFlow" || entityType === "table") {
    const ids = (await renameReportRefsInProject(entityType, fromId, "", root, true)).changed;
    if (ids.length > 0) warnings.push(`帳票 ${ids.join(", ")} の参照は、付け替えの対象外です (帳票の画面で直してください)`);
  }
  return { dataRoot, scan, files, existing, concurrentEditRefs, warnings };
}

/** 予行: 付け替わる参照元と数 (何も書かない)。only を渡すと、その参照元 (filePath) だけ */
export async function previewReplaceReferences(entityType: RenameEntityType, fromId: string, toId: string, root: string, only?: readonly string[], opts?: RenameOpts): Promise<ReplacePreview> {
  const p = await plan(entityType, fromId, toId, root, only, opts);
  return {
    entityType, fromId, toId,
    fromExists: p.existing.includes(fromId), toExists: p.existing.includes(toId),
    files: p.files, totalRefs: p.files.reduce((a, f) => a + f.count, 0),
    candidates: p.existing.filter((id) => id !== fromId),
    warnings: p.warnings, concurrentEditRefs: p.concurrentEditRefs,
  };
}

/** 実行: 選んだ参照元 (filePath) の、fromId への参照を、toId へ付け替える */
export async function replaceReferences(entityType: RenameEntityType, fromId: string, toId: string, root: string, only: readonly string[], opts?: RenameOpts): Promise<ReplaceResult> {
  if (fromId === toId) throw new Error("付け替え元と付け替え先が同じです");
  if (only.length === 0) throw new Error("付け替える参照元を選んでください");
  const release = await acquireWorkspaceLock(root);
  try {
    const p = await plan(entityType, fromId, toId, root, only, opts, true);
    if (!p.existing.includes(fromId)) throw new Error(`${entityType} "${fromId}" が見つかりません`);
    if (!p.existing.includes(toId)) throw new Error(`付け替え先の ${entityType} "${toId}" が見つかりません`);
    if (p.concurrentEditRefs.length > 0) {
      const refs = p.concurrentEditRefs.map((r) => `${r.entityKind}/${r.entityId}`).join(", ");
      throw new Error(`参照元を編集中の人がいるため、付け替えられません: [${refs}]。先に編集を確定・破棄してください。`);
    }
    if (p.files.length === 0) throw new Error("付け替える参照が見つかりません");
    const targets: Array<{ abs: string; before: string; after: string; file: ReplaceFile }> = [];
    for (const f of p.files) {
      const abs = path.join(p.dataRoot, f.filePath);
      const entry = p.scan.perFileUpdate.get(abs);
      if (!entry) throw new Error(`${f.filePath} の更新内容を作れませんでした`);
      targets.push({ abs, before: entry.original, after: entry.updated, file: f });
    }
    const journal = await openJournal(root, planFromAbsolute(root, `replace refs ${entityType} ${fromId} -> ${toId}`, targets.map((t) => ({ absPath: t.abs, content: t.before })), []));
    const done: typeof targets = [];
    try {
      for (const t of targets) {
        await backupBeforeOverwrite(t.abs, t.after);
        await writeFileContent(t.abs, t.after);
        done.push(t);
      }
    } catch (err) {
      let complete = true;
      for (const t of done) { try { await writeFileContent(t.abs, t.before); } catch { complete = false; } }
      if (complete) await journal().catch(() => undefined);
      throw err;
    }
    await journal().catch(() => undefined);
    // 取り消し用: 書いた直後の実際の内容 (保存時の整理で、渡した内容と変わることがある) を、比べる基準にする
    const entries: UndoEntry["files"] = [];
    for (const t of targets) entries.push({ abs: t.abs, before: t.before, after: (await readFileContentOrNull(t.abs)) ?? t.after });
    sweep();
    const operationId = crypto.randomUUID();
    undoStore.set(operationId, { operationId, root, ts: Date.now(), files: entries });
    return { operationId, replaced: targets.map((t) => t.file), undoTtlMs: UNDO_TTL_MS };
  } finally {
    release();
  }
}

/** 取り消し: 付け替えの前の内容へ戻す。その後に、その設計が編集されていたら、戻さない */
export async function undoReplaceReferences(operationId: string, root: string): Promise<{ restored: string[] }> {
  sweep();
  const op = undoStore.get(operationId);
  if (!op || op.root !== root) throw new Error("取り消せる付け替えが見つかりません (5 分を過ぎたか、すでに取り消しました)");
  const release = await acquireWorkspaceLock(root);
  try {
    const dataRoot = await resolveDataRoot(root);
    for (const f of op.files) {
      const now = await readFileContentOrNull(f.abs);
      if (now !== f.after) throw new Error(`${toRel(f.abs, dataRoot)} が、付け替えのあとに変更されているため、取り消せません`);
    }
    for (const f of op.files) { await backupBeforeOverwrite(f.abs, f.before); await fs.writeFile(f.abs, f.before, "utf-8"); }
    undoStore.delete(operationId);
    return { restored: op.files.map((f) => toRel(f.abs, dataRoot)) };
  } finally {
    release();
  }
}
