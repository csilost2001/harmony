/**
 * workspaceInit.ts (#672, #852 R-3)
 *
 * - inspectWorkspacePath: 任意 path の状態 (ready / needsInit / notFound / invalid) を判定
 *   - harmony.json 存在 + AJV 検証 pass → ready
 *   - フォルダ不存在 → notFound
 *   - harmony.json 無し → needsInit
 *   - harmony.json 存在 + JSON parse 失敗 or schema 違反 → invalid
 * - initializeWorkspace: 空 (or 不存在) フォルダに harmony.json + dataDir 配下サブディレクトリ群を生成
 *   - opts.dataDir でデータディレクトリ名を指定可 (デフォルト: "harmony")
 * - autoActivateOnStartup: backend 起動時の自動 active 設定
 *   1. lockdown 中なら何もしない (env で active 固定済み)
 *   2. recent.lastActiveId が指す workspace があれば setActivePath
 *   3. 何もなければ active 未設定のまま (UI 側で /workspace/select に誘導)
 *
 * #754: legacy data/ auto-activate を削除。data/ は data/extensions/ 専用。
 * ユーザープロジェクトは workspaces/ または任意フォルダ。
 * #852 R-3: harmony.json + dataDir 構成に対応。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import {
  isLockdown,
  setGlobalDefaultPath,
} from "./workspaceState.js";
import {
  readRecent,
  findById,
  type WorkspaceEntry,
} from "./recentStore.js";
// projectStorage の関数群は active workspace 必須なので本モジュールでは使わず、
// ローカル fs API で harmony.json/サブディレクトリを直接生成する。

export type WorkspaceInspectResult =
  | { status: "ready"; path: string; name: string | null }
  | { status: "needsInit"; path: string }
  | { status: "notFound"; path: string }
  | { status: "invalid"; path: string; reason: string };

const HARMONY_SCHEMA_REF = "../schemas/v3/harmony.v3.schema.json";
const SCHEMAS_DIR = path.resolve(import.meta.dirname, "../../schemas");

let _validateHarmonyCache: ((data: unknown) => boolean) & { errors?: unknown } | null = null;

async function getHarmonyValidator(): Promise<((data: unknown) => boolean) & { errors?: unknown }> {
  if (_validateHarmonyCache) return _validateHarmonyCache;
  // strict: false で format 系 ($ref 解決に format 制約が含まれる) の警告を抑制
  // schemas/v3/*.schema.json は JSON Schema draft 2020-12 を使用 (Ajv2020 が必要)
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  // load schemas: harmony.v3 + common.v3 (referenced via $ref)
  const harmonySchema = JSON.parse(
    await fs.readFile(path.join(SCHEMAS_DIR, "v3", "harmony.v3.schema.json"), "utf-8"),
  );
  const commonSchema = JSON.parse(
    await fs.readFile(path.join(SCHEMAS_DIR, "v3", "common.v3.schema.json"), "utf-8"),
  );
  ajv.addSchema(commonSchema);
  const validate = ajv.compile(harmonySchema);
  _validateHarmonyCache = validate as ((data: unknown) => boolean) & { errors?: unknown };
  return _validateHarmonyCache;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * harmony.json を読み込む内部ヘルパー (#852 R-3)。
 * JSON parse 成功時は { data: <parsed> } を返す。
 * ファイルが存在しない場合は null を返す。
 * JSON parse 失敗時は { error: <message> } を返す。
 */
async function readHarmonyAt(
  folderPath: string,
): Promise<{ data: unknown } | { error: string } | null> {
  const filePath = path.join(folderPath, "harmony.json");
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return null; // 存在しない
  }
  try {
    return { data: JSON.parse(raw) };
  } catch (e) {
    return { error: `JSON parse 失敗: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function extractName(project: unknown, fallback: string): string {
  if (typeof project === "object" && project !== null) {
    const meta = (project as Record<string, unknown>).meta;
    if (meta && typeof meta === "object") {
      const name = (meta as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim().length > 0) return name;
    }
  }
  return fallback;
}

export async function inspectWorkspacePath(folderPath: string): Promise<WorkspaceInspectResult> {
  const abs = path.resolve(folderPath);
  if (!(await pathExists(abs))) {
    return { status: "notFound", path: abs };
  }
  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) {
    return { status: "notFound", path: abs };
  }
  const harmonyResult = await readHarmonyAt(abs);
  if (harmonyResult === null) {
    // harmony.json が存在しない → needsInit
    return { status: "needsInit", path: abs };
  }
  if ("error" in harmonyResult) {
    // JSON parse 失敗
    return { status: "invalid", path: abs, reason: harmonyResult.error };
  }
  // AJV 検証
  const validate = await getHarmonyValidator();
  if (!validate(harmonyResult.data)) {
    const reason = `harmony.v3.schema.json 検証エラー: ${JSON.stringify(validate.errors)}`;
    return { status: "invalid", path: abs, reason };
  }
  return { status: "ready", path: abs, name: extractName(harmonyResult.data, path.basename(abs)) };
}

function isoTimestampZ(): string {
  // EntityMeta.createdAt/updatedAt requires Z 終端 (no offset)
  return new Date().toISOString();
}

export type InitializeResult = {
  path: string;
  name: string;
  projectId: string;
  dataDir: string;
};

export type InitializeOptions = {
  /** データディレクトリ名 (デフォルト: "harmony") */
  dataDir?: string;
};

/**
 * 指定 path に harmony.json + <dataDir>/サブディレクトリ群を生成する (#852 R-3)。
 * フォルダ自体が存在しなければ mkdir -p で作る。
 * 既に harmony.json が存在する場合は何もせずそのまま返す (idempotent)。
 *
 * @param folderPath - workspace folder root の絶対パス (または相対パス)
 * @param opts.dataDir - データディレクトリ名 (デフォルト: "harmony")
 */
export async function initializeWorkspace(
  folderPath: string,
  opts?: InitializeOptions,
): Promise<InitializeResult> {
  const abs = path.resolve(folderPath);
  const dataDirVal = opts?.dataDir ?? "harmony";

  await fs.mkdir(abs, { recursive: true });

  // harmony.json が既に存在すれば idempotent で返す
  // ただし AJV 検証に通らない harmony.json は schema 違反 dataDir
  // (../outside / 絶対パス等) で workspace 外にディレクトリ作成する事故を起こすため reject (Codex post-merge review P2-2)
  const harmonyResult = await readHarmonyAt(abs);
  if (harmonyResult !== null && "data" in harmonyResult) {
    const existing = harmonyResult.data;
    const validate = await getHarmonyValidator();
    if (!validate(existing)) {
      throw new Error(
        `既存 harmony.json が schema 違反のため init を中止しました: ${path.join(abs, "harmony.json")}: ${JSON.stringify(validate.errors)}`,
      );
    }
    const existingDataDir = (existing as Record<string, unknown>).dataDir as string;
    // dataDir 配下のサブディレクトリも念のため確認・作成 (idempotent)
    await ensureSubdirs(abs, existingDataDir);
    return {
      path: abs,
      name: extractName(existing, path.basename(abs)),
      projectId:
        typeof (existing as Record<string, unknown>).meta === "object"
          ? String(
              ((existing as Record<string, unknown>).meta as Record<string, unknown>).id ?? "",
            )
          : "",
      dataDir: existingDataDir,
    };
  }

  // 新規作成
  const ts = isoTimestampZ();
  const projectId = randomUUID();
  const name = path.basename(abs) || "新規ワークスペース";
  const project = {
    $schema: HARMONY_SCHEMA_REF,
    schemaVersion: "v3" as const,
    dataDir: dataDirVal,
    meta: {
      id: projectId,
      name,
      createdAt: ts,
      updatedAt: ts,
      mode: "upstream" as const,
      maturity: "draft" as const,
    },
    extensionsApplied: [],
    entities: {
      screens: [],
      screenGroups: [],
      screenTransitions: [],
      tables: [],
      sequences: [],
      views: [],
    },
  };

  // schema 検証してから書き込み (テスト pass を理由に schema を勝手に変更しない、
  // 失敗した場合は ISSUE 起票して停止する原則に従う)
  const validate = await getHarmonyValidator();
  if (!validate(project)) {
    throw new Error(
      `初期 harmony.json が schemas/v3/harmony.v3.schema.json に違反: ${JSON.stringify(validate.errors)}`,
    );
  }
  const harmonyFilePath = path.join(abs, "harmony.json");
  await fs.writeFile(harmonyFilePath, JSON.stringify(project, null, 2), "utf-8");

  // dataDir 配下にサブディレクトリ群を作成
  await ensureSubdirs(abs, dataDirVal);

  return { path: abs, name, projectId, dataDir: dataDirVal };
}

/**
 * workspace folder root 配下の dataDir ディレクトリとサブディレクトリ群を作成する内部ヘルパー。
 * projectStorage.ensureDataDir の代替 (workspaceInit は active workspace に依存しないため独立実装)。
 */
async function ensureSubdirs(root: string, dataDirVal: string): Promise<void> {
  const dataRoot = path.join(root, dataDirVal);
  const subdirs = [
    "screens",
    "tables",
    "actions",
    "process-flows",
    "conventions",
    "sequences",
    "views",
    "view-definitions",
    "extensions",
  ];
  await fs.mkdir(dataRoot, { recursive: true });
  await Promise.all(subdirs.map((d) => fs.mkdir(path.join(dataRoot, d), { recursive: true })));
}

export type AutoActivateResult =
  | { status: "lockdown"; path: string }
  | { status: "restored"; entry: WorkspaceEntry }
  | { status: "none" };

/**
 * 起動時の自動 active 設定。lockdown 中はスキップ。
 * recent.lastActiveId が指す workspace があれば復元、なければ active 未設定で UI 側に委ねる。
 *
 * 戻り値は呼び出し側 (index.ts) が console log 出力する用途。
 * broadcast はしない (この時点で WS クライアントは未接続)。
 *
 * lastActiveId 復元時は inspectWorkspacePath で ready 確認する (harmony.json が
 * 削除・移動済みの stale エントリで起動しないようにする)。
 *
 * #754: data/ legacy auto-activate は削除済。data/ は data/extensions/ 専用。
 */
export async function autoActivateOnStartup(): Promise<AutoActivateResult> {
  if (isLockdown()) {
    return { status: "lockdown", path: process.env.DESIGNER_DATA_DIR ?? "" };
  }
  const recent = await readRecent();
  if (recent.lastActiveId) {
    const entry = await findById(recent.lastActiveId);
    if (entry) {
      const inspect = await inspectWorkspacePath(entry.path);
      if (inspect.status === "ready") {
        setGlobalDefaultPath(entry.path);
        return { status: "restored", entry };
      }
      // フォルダが消えた / harmony.json が無い: stale エントリなのでスキップ。
      // recent からの除去はしない (UI 側でユーザーが「リストから外す」できる前提)。
    }
  }
  return { status: "none" };
}

/** test-only */
export const _internals = {
  HARMONY_SCHEMA_REF,
};
