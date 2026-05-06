/**
 * workspaceInit.ts (#672)
 *
 * - inspectWorkspacePath: 任意 path の状態 (ready / needsInit / notFound) を判定
 * - initializeWorkspace: 空 (or 不存在) フォルダに data/ サブディレクトリ群と project.json を生成
 * - autoActivateOnStartup: backend 起動時の自動 active 設定
 *   1. lockdown 中なら何もしない (env で active 固定済み)
 *   2. recent.lastActiveId が指す workspace があれば setActivePath
 *   3. 何もなければ active 未設定のまま (UI 側で /workspace/select に誘導)
 *
 * #754: legacy data/ auto-activate を削除。data/ は data/extensions/ 専用。
 * ユーザープロジェクトは workspaces/ または任意フォルダ。
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
// ローカル fs API で project.json/サブディレクトリを直接生成する。

export type WorkspaceInspectResult =
  | { status: "ready"; path: string; name: string | null }
  | { status: "needsInit"; path: string }
  | { status: "notFound"; path: string };

const PROJECT_SCHEMA_REF = "../schemas/v3/project.v3.schema.json";
const SCHEMAS_DIR = path.resolve(import.meta.dirname, "../../schemas");

let _validateProjectCache: ((data: unknown) => boolean) & { errors?: unknown } | null = null;

async function getProjectValidator(): Promise<((data: unknown) => boolean) & { errors?: unknown }> {
  if (_validateProjectCache) return _validateProjectCache;
  // strict: false で format 系 ($ref 解決に format 制約が含まれる) の警告を抑制
  // schemas/v3/*.schema.json は JSON Schema draft 2020-12 を使用 (Ajv2020 が必要)
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  // load schemas: project.v3 + common.v3 (referenced via $ref)
  const projectSchema = JSON.parse(
    await fs.readFile(path.join(SCHEMAS_DIR, "v3", "project.v3.schema.json"), "utf-8"),
  );
  const commonSchema = JSON.parse(
    await fs.readFile(path.join(SCHEMAS_DIR, "v3", "common.v3.schema.json"), "utf-8"),
  );
  ajv.addSchema(commonSchema);
  const validate = ajv.compile(projectSchema);
  _validateProjectCache = validate as ((data: unknown) => boolean) & { errors?: unknown };
  return _validateProjectCache;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readProjectAt(folderPath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(path.join(folderPath, "project.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
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
  const project = await readProjectAt(abs);
  if (!project) {
    return { status: "needsInit", path: abs };
  }
  return { status: "ready", path: abs, name: extractName(project, path.basename(abs)) };
}

function isoTimestampZ(): string {
  // EntityMeta.createdAt/updatedAt requires Z 終端 (no offset)
  return new Date().toISOString();
}

export type InitializeResult = {
  path: string;
  name: string;
  projectId: string;
};

/**
 * 指定 path に project.json + data/サブディレクトリ群を生成する。
 * フォルダ自体が存在しなければ mkdir -p で作る。
 * 既に project.json が存在する場合は何もせずそのまま返す (idempotent)。
 */
export async function initializeWorkspace(folderPath: string): Promise<InitializeResult> {
  const abs = path.resolve(folderPath);
  await fs.mkdir(abs, { recursive: true });
  // ensureDataDir で active を読むため、setActivePath を一時セットしたいところだが
  // initializeWorkspace は active 切替前 (workspace.open の準備フェーズ) で呼ばれる前提なので
  // ここでは fs 操作を直接行う。
  const subdirs = ["screens", "tables", "actions", "conventions", "sequences", "views", "view-definitions", "extensions"];
  await Promise.all(subdirs.map((d) => fs.mkdir(path.join(abs, d), { recursive: true })));

  const projectFilePath = path.join(abs, "project.json");
  const existing = await readProjectAt(abs);
  if (existing) {
    return {
      path: abs,
      name: extractName(existing, path.basename(abs)),
      projectId: typeof (existing as Record<string, unknown>).meta === "object"
        ? String(((existing as Record<string, unknown>).meta as Record<string, unknown>).id ?? "")
        : "",
    };
  }

  const ts = isoTimestampZ();
  const projectId = randomUUID();
  const name = path.basename(abs) || "新規ワークスペース";
  const project = {
    $schema: PROJECT_SCHEMA_REF,
    schemaVersion: "v3" as const,
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
  const validate = await getProjectValidator();
  if (!validate(project)) {
    throw new Error(
      `初期 project.json が schemas/v3/project.v3.schema.json に違反: ${JSON.stringify(validate.errors)}`,
    );
  }
  await fs.writeFile(projectFilePath, JSON.stringify(project, null, 2), "utf-8");
  return { path: abs, name, projectId };
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
 * lastActiveId 復元時は inspectWorkspacePath で ready 確認する (project.json が
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
      // フォルダが消えた / project.json が無い: stale エントリなのでスキップ。
      // recent からの除去はしない (UI 側でユーザーが「リストから外す」できる前提)。
    }
  }
  return { status: "none" };
}

/** test-only */
export const _internals = {
  PROJECT_SCHEMA_REF,
};
