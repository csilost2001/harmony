/**
 * draftStore.ts (#685)
 *
 * data/.drafts/<resourceType>/<id>.json を edit-session の working copy として管理する。
 * atomic write: tmp ファイルへ書き込み → fs.rename でアトミックに置換。
 * commitDraft: draft を本体ファイルへ atomic に昇格し draft を削除する。
 */
import fs from "fs/promises";
import path from "path";
import { randomBytes } from "node:crypto";
import { resolveRoot } from "./projectStorage.js";
import {
  writeScreen,
  writePuckData,
  writeTable,
  writeProcessFlow,
  writeView,
  writeViewDefinition,
  writeScreenItems,
  writeSequence,
  writeProject,
} from "./projectStorage.js";

export type DraftResourceType =
  | "screen"
  | "puck-data"  // #806: Puck 画面データ (screens/<id>/puck-data.json)
  | "table"
  | "process-flow"
  | "view"
  | "view-definition"
  | "screen-item"
  | "sequence"
  | "extension"
  | "convention"
  | "flow";  // #690 PR-7: 画面遷移図用

const DRAFTS_SUBDIR = ".drafts";

function draftsRoot(activeRoot: string): string {
  return path.join(activeRoot, DRAFTS_SUBDIR);
}

function draftDir(activeRoot: string, type: DraftResourceType): string {
  return path.join(draftsRoot(activeRoot), type);
}

function draftPath(activeRoot: string, type: DraftResourceType, id: string): string {
  return path.join(draftDir(activeRoot, type), `${id}.json`);
}

async function ensureDraftDir(activeRoot: string, type: DraftResourceType): Promise<void> {
  await fs.mkdir(draftDir(activeRoot, type), { recursive: true });
}

async function atomicWrite(targetPath: string, data: unknown): Promise<void> {
  const rand = randomBytes(4).toString("hex");
  const tmp = `${targetPath}.tmp-${process.pid}-${Date.now()}-${rand}`;
  const json = JSON.stringify(data, null, 2);
  try {
    await fs.writeFile(tmp, json, "utf-8");
    await fs.rename(tmp, targetPath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function readJSON<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function canonicalBodyPath(activeRoot: string, type: DraftResourceType, id: string): string | null {
  switch (type) {
    case "screen":
      return path.join(activeRoot, "screens", `${id}.design.json`);
    case "puck-data":
      // #806: Puck Data は screens/<id>/puck-data.json に専用パスで保存
      return path.join(activeRoot, "screens", id, "puck-data.json");
    case "table":
      return path.join(activeRoot, "tables", `${id}.json`);
    case "process-flow":
      return path.join(activeRoot, "actions", `${id}.json`);
    case "view":
      return path.join(activeRoot, "views", `${id}.json`);
    case "view-definition":
      return path.join(activeRoot, "view-definitions", `${id}.json`);
    case "screen-item":
      // screen-item は singleton draft で body path が payload.screenId に依存するため null を返す
      return null;
    case "sequence":
      return path.join(activeRoot, "sequences", `${id}.json`);
    case "extension":
      return path.join(activeRoot, "extensions", `${id}.json`);
    case "convention":
      return path.join(activeRoot, "conventions", "catalog.json");
    case "flow":
      return path.join(activeRoot, "project.json");
    default:
      return null;
  }
}

/**
 * 編集開始: 本体ファイルが存在すればコピー、存在しなければ空 draft を作成する。
 * 既に draft が存在する場合は作成せず created: false を返す。
 */
export async function createDraft(
  clientId: string,
  type: DraftResourceType,
  id: string,
): Promise<{ created: boolean }> {
  const root = resolveRoot(clientId);
  const dp = draftPath(root, type, id);

  try {
    await fs.access(dp);
    return { created: false };
  } catch {
    // draft 未存在 → 作成する
  }

  await ensureDraftDir(root, type);

  const bodyPath = canonicalBodyPath(root, type, id);
  let initialContent: unknown = {};
  if (bodyPath) {
    const existing = await readJSON<unknown>(bodyPath);
    if (existing !== null) {
      initialContent = existing;
    }
  }

  await atomicWrite(dp, initialContent);
  return { created: true };
}

/** draft ファイルを読み込む。存在しない場合は null を返す。 */
export async function readDraft(
  clientId: string,
  type: DraftResourceType,
  id: string,
): Promise<unknown | null> {
  const root = resolveRoot(clientId);
  return readJSON<unknown>(draftPath(root, type, id));
}

/** draft ファイルを更新する (atomic write)。draft が存在しない場合も書き込む。 */
export async function updateDraft(
  clientId: string,
  type: DraftResourceType,
  id: string,
  payload: unknown,
): Promise<void> {
  const root = resolveRoot(clientId);
  await ensureDraftDir(root, type);
  await atomicWrite(draftPath(root, type, id), payload);
}

/**
 * draft を本体ファイルへ atomic に昇格し、draft を削除する。
 * draft が存在しない場合は committed: false を返す。
 */
export async function commitDraft(
  clientId: string,
  type: DraftResourceType,
  id: string,
): Promise<{ committed: boolean }> {
  const root = resolveRoot(clientId);
  const dp = draftPath(root, type, id);
  const payload = await readJSON<unknown>(dp);
  if (payload === null) {
    return { committed: false };
  }

  switch (type) {
    case "screen":
      await writeScreen(id, payload, root);
      break;
    case "puck-data":
      // #806: Puck Data を screens/<id>/puck-data.json に atomic write で昇格
      await writePuckData(id, payload, root);
      break;
    case "table":
      await writeTable(id, payload, root);
      break;
    case "process-flow":
      await writeProcessFlow(id, payload, root);
      break;
    case "view":
      await writeView(id, payload, root);
      break;
    case "view-definition":
      await writeViewDefinition(id, payload, root);
      break;
    case "screen-item": {
      const siPayload = payload as { screenId?: string } | null;
      if (!siPayload || typeof siPayload.screenId !== "string" || !siPayload.screenId) {
        throw new Error("screen-item draft payload に screenId がありません");
      }
      await writeScreenItems(siPayload.screenId, siPayload, root);
      break;
    }
    case "sequence":
      await writeSequence(id, payload, root);
      break;
    case "extension":
    case "convention": {
      const bodyPath = canonicalBodyPath(root, type, id);
      if (!bodyPath) {
        throw new Error(`${type} の本体パス解決に失敗しました`);
      }
      await fs.mkdir(path.dirname(bodyPath), { recursive: true });
      await atomicWrite(bodyPath, payload);
      break;
    }
    case "flow":
      await writeProject(payload, root);
      break;
    default: {
      const _exhaustive: never = type;
      throw new Error(`未対応の resourceType: ${_exhaustive}`);
    }
  }

  try {
    await fs.unlink(dp);
  } catch {
    // draft 削除失敗は無視 (commit 自体は成功)
  }

  return { committed: true };
}

/** draft ファイルを削除する (本体には変更しない)。 */
export async function discardDraft(
  clientId: string,
  type: DraftResourceType,
  id: string,
): Promise<{ discarded: boolean }> {
  const root = resolveRoot(clientId);
  const dp = draftPath(root, type, id);
  try {
    await fs.unlink(dp);
    return { discarded: true };
  } catch {
    return { discarded: false };
  }
}

/** draft ファイルが存在するかを返す。 */
export async function hasDraft(clientId: string, type: DraftResourceType, id: string): Promise<boolean> {
  const root = resolveRoot(clientId);
  try {
    await fs.access(draftPath(root, type, id));
    return true;
  } catch {
    return false;
  }
}

/** 全 draft を列挙する。 */
export async function listDrafts(clientId: string): Promise<Array<{ type: DraftResourceType; id: string; mtimeMs: number }>> {
  const root = resolveRoot(clientId);
  const dr = draftsRoot(root);
  const result: Array<{ type: DraftResourceType; id: string; mtimeMs: number }> = [];

  let typeDirs: string[];
  try {
    typeDirs = await fs.readdir(dr);
  } catch {
    return result;
  }

  for (const typeDir of typeDirs) {
    const type = typeDir as DraftResourceType;
    const fullTypeDir = path.join(dr, typeDir);
    let files: string[];
    try {
      files = await fs.readdir(fullTypeDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const id = file.slice(0, -5);
      try {
        const stat = await fs.stat(path.join(fullTypeDir, file));
        result.push({ type, id, mtimeMs: stat.mtimeMs });
      } catch {
        // ファイルが消えた場合はスキップ
      }
    }
  }

  return result;
}
