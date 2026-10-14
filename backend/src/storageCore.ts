/**
 * storageCore.ts — projectStorage.ts の土台 (ワークスペースの harmony.json から dataDir を解決する・データフォルダの配置・
 * JSON の読み書き (一時ファイル → rename・上書き前の版・原因別のエラー)・同じファイルへの更新の直列化)。
 * 種類ごとの読み書き (projectStorage.ts / docStore.ts) が、ここを使う。projectStorage.ts が、公開するものを再 export する。
 */
import { backupBeforeOverwrite } from "./fileBackup.js";
import { explainWriteError } from "./writeErrors.js";
import fs from "fs/promises";
import path from "path";
import crypto from "node:crypto";
import { workspaceContextManager } from "./workspaceState.js";

/** スキーマ (schemas/) のフォルダ */
export const SCHEMAS_DIR = path.resolve(import.meta.dirname, "../../schemas");

// ── path 解決ヘルパー (#671 + #700 R-2) ─────────────────────────────────────
// workspace 切替に追従するため、絶対パス constant を廃止し getter 関数化。
//
// レース対策 (#676 review 7 周目): 各 getter は optional root を受け、未指定なら
// requireActivePath(clientId) からフォールバック取得する。複数 path を生成する公開関数は
// 関数開始時に root を 1 度だけスナップショットし、すべての helper にそれを渡す
// ことで、操作中に workspace 切替が起きても書き込み先が分散しないようにする。
//
// #700 R-2: LEGACY 削除。clientId 必須。root は内部 helper 専用 (snapshot 規約)。
// #851 R-2: dataDir 解決を追加。harmony.json を on-demand 読み取り。

/**
 * clientId から per-session active root を解決するヘルパー (#700 R-2)。
 * clientId が渡された場合は WorkspaceContextManager 経由で解決。
 * root が渡された場合は snapshot path を直接使用 (内部 helper 向け)。
 */
export function resolveRoot(clientId: string): string {
  return workspaceContextManager.requireActivePath(clientId);
}

// ── Workspace marker file (harmony.json) ────────────────────────────────────

/**
 * harmony.json ファイルのパスを返す (#851 R-2 D-7)。
 * workspace folder root 直下に固定 (dataDir 配下ではない — chicken-and-egg 回避)。
 */
export const harmonyFile = (root: string): string => path.join(root, "harmony.json");

/** harmony.json の状態 (大きさ + 更新時刻) → dataDir の値。状態が変わらないあいだ、読み直さない (下の resolveDataRoot) */
const dataDirCache = new Map<string, { sig: string; dataDir: string }>();

/**
 * harmony.json を読み取り、dataDir フィールドを解決して <root>/<dataDir> を返す。
 * harmony.json が存在しない/dataDir が不正な場合は Error を throw する (#851 R-2)。
 *
 * ほぼすべての読み書きが、最初にこれを呼ぶ。以前は毎回 harmony.json 全体を読んで JSON.parse していたので、一覧 (登録簿) が大きい
 * プロジェクト (約 2,900 件で約 1 MB) では、設計 1 件を読むたびに 1 MB を解析し、全件を読む処理が件数の 2 乗で遅くなっていた
 * (設計書の入力 8.5 秒)。ファイルの状態 (大きさ + 更新時刻) が変わらないあいだは、前の結果を使い回す (書き換えは一時ファイル → rename で、
 * 更新時刻が変わる)。
 */
export async function resolveDataRoot(root: string): Promise<string> {
  const filePath = harmonyFile(root);
  let sig: string | null = null;
  try { const st = await fs.stat(filePath); sig = `${st.size}:${st.mtimeMs}`; } catch { /* 下で、読めないエラーにする */ }
  const hit = sig !== null ? dataDirCache.get(filePath) : undefined;
  if (hit && hit.sig === sig) return path.join(root, hit.dataDir);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    throw new Error(`harmony.json が見つかりません: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`harmony.json の JSON パースに失敗しました: ${filePath}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).dataDir !== "string" ||
    ((parsed as Record<string, unknown>).dataDir as string).length === 0
  ) {
    throw new Error(`harmony.json の dataDir フィールドが不正または空です: ${filePath}`);
  }
  const dataDirValue = (parsed as Record<string, unknown>).dataDir as string;
  if (sig !== null) dataDirCache.set(filePath, { sig, dataDir: dataDirValue });
  return path.join(root, dataDirValue);
}

// ── Data subdirectory helpers (dataRoot ベース) ──────────────────────────────
// 引数は dataRoot = path.join(root, dataDir) を期待する。

export const screensDir       = (dataRoot: string) => path.join(dataRoot, "screens");
export const tablesDir        = (dataRoot: string) => path.join(dataRoot, "tables");
export const actionsDir       = (dataRoot: string) => path.join(dataRoot, "actions");
export const processFlowsDir  = (dataRoot: string) => path.join(dataRoot, "process-flows");
export const catalogsDir      = (dataRoot: string) => path.join(dataRoot, "catalogs");
export const conventionsDir   = (dataRoot: string) => path.join(dataRoot, "conventions");
export const screenItemsDir   = (dataRoot: string) => path.join(dataRoot, "screen-items");
export const sequencesDir     = (dataRoot: string) => path.join(dataRoot, "sequences");
export const viewsDir         = (dataRoot: string) => path.join(dataRoot, "views");
export const viewDefsDir      = (dataRoot: string) => path.join(dataRoot, "view-definitions");
export const pageLayoutsDir   = (dataRoot: string) => path.join(dataRoot, "page-layouts");
export const businessFlowsDir = (dataRoot: string) => path.join(dataRoot, "business-flows");
export const reportsDir       = (dataRoot: string) => path.join(dataRoot, "reports");
export const genericDefinitionsDir = (dataRoot: string, kind: string) => path.join(dataRoot, "generic-definitions", kind);
export const extensionsDir      = (dataRoot: string) => path.join(dataRoot, "extensions");
export const layoutComponentsFile = (dataRoot: string) => path.join(dataRoot, "layout-components.json");
export const erLayoutFile       = (dataRoot: string) => path.join(dataRoot, "er-layout.json");
export const screenFlowPositionsFile = (dataRoot: string) => path.join(dataRoot, "screen-flow-positions.json");
export const externalCatalogsFile = (dataRoot: string) => path.join(catalogsDir(dataRoot), "external.json");
export const conventionsFile    = (dataRoot: string) => path.join(conventionsDir(dataRoot), "catalog.json");

/**
 * active workspace 配下のデータディレクトリ群を作成（既存なら無視）。
 *
 * #851 R-2: 引数を (root, dataDirVal) の 2 つに変更。
 * - root: workspace folder root
 * - dataDirVal: harmony.json の dataDir 値 (呼び出し側が責任を持って渡す)
 *
 * これにより harmony.json の読み出しに依存せず循環依存を回避する。
 * 呼び出し側 (R-3 で workspace.open / initializeWorkspace から呼ぶ予定) が
 * 責任を持って dataDir を渡す。
 */
export async function ensureDataDir(root: string, dataDirVal: string): Promise<void> {
  const dataRoot = path.join(root, dataDirVal);
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.mkdir(screensDir(dataRoot), { recursive: true });
  await fs.mkdir(tablesDir(dataRoot), { recursive: true });
  await fs.mkdir(actionsDir(dataRoot), { recursive: true });
  await fs.mkdir(conventionsDir(dataRoot), { recursive: true });
  // screen-items/ は Phase 4-β migration 後に廃止済み — 再作成しない
  await fs.mkdir(sequencesDir(dataRoot), { recursive: true });
  await fs.mkdir(viewsDir(dataRoot), { recursive: true });
  await fs.mkdir(viewDefsDir(dataRoot), { recursive: true });
  await fs.mkdir(pageLayoutsDir(dataRoot), { recursive: true });
  await fs.mkdir(extensionsDir(dataRoot), { recursive: true });
}

/**
 * ensureDataDir の旧シグネチャ互換ヘルパー (内部のみ使用)。
 * harmony.json から dataDir を解決してから ensureDataDir を呼ぶ。
 */
export async function ensureDataDirFromRoot(root: string): Promise<string> {
  const dataRoot = await resolveDataRoot(root);
  const dataDirVal = path.relative(root, dataRoot);
  await ensureDataDir(root, dataDirVal);
  return dataRoot;
}

export async function readJSON<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** 書き込みの直前の検査 (承認の方針など)。throw すると、書かない */
type PreWriteGuard = (filePath: string, data: unknown) => Promise<void>;
const preWriteGuards: PreWriteGuard[] = [];
export function addPreWriteGuard(g: PreWriteGuard): void { preWriteGuards.push(g); }

export async function writeJSON(filePath: string, data: unknown): Promise<void> {
  for (const g of preWriteGuards) await g(filePath, data);
  const json = JSON.stringify(data, null, 2);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // 同じディレクトリの一時ファイルに書いてから rename で置き換える。直接 writeFile すると
  // 切り詰め〜書き込みの間に並行して読んだ側が空 / 途中の JSON を読み、「存在しない」扱いになる。
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, json, "utf-8");
    // 上書きの直前の内容を世代で残す (失敗しても保存は止めない)
    await backupBeforeOverwrite(filePath, json);
    await fs.rename(tmp, filePath);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw explainWriteError(e, filePath);
  }
}

/** 同じファイルへの更新が並行しても、読んで・差し替えて・書く を 1 本ずつ行う (独自部品・業務フロー・帳票で共用) */
const fileLocks = new Map<string, Promise<unknown>>();
export function withFileLock<T>(file: string, run: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(file) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(run);
  fileLocks.set(file, next);
  return next.finally(() => { if (fileLocks.get(file) === next) fileLocks.delete(file); });
}
