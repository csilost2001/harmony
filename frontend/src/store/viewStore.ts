import type { View, ViewEntry, ViewId, PhysicalName, DisplayName, Timestamp } from "../types/v3";
import { generateUUID } from "../utils/uuid";
import { validateView } from "../utils/viewValidation";
import type { ValidationError } from "../utils/actionValidation";
import { loadProject, saveProject } from "./flowStore";
import { renumber, nextNo } from "../utils/listOrder";

// ─── ストレージバックエンド ──────────────────────────────────────────────

export interface ViewStorageBackend {
  loadView(viewId: string): Promise<unknown>;
  listAllViews?(): Promise<unknown[]>;
  saveView(viewId: string, data: unknown): Promise<void>;
  deleteView(viewId: string): Promise<void>;
}

let _backend: ViewStorageBackend | null = null;

export function setViewStorageBackend(b: ViewStorageBackend | null): void {
  _backend = b;
}

// ─── localStorage キー (v3 名前空間、#549) ───────────────────────────────

const VIEW_PREFIX = "v3-view-";

const VIEW_SCHEMA_REF = "../../schemas/v3/view.v3.schema.json";

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

// ─── 公開 API ────────────────────────────────────────────────────────────

/** ビュー一覧を取得 (project.json の views エントリ、v3 ViewEntry[]) */
export async function listViews(): Promise<ViewEntry[]> {
  const project = await loadProject();
  return project.views ?? [];
}

/** ビュー定義を読み込み (per-entity ファイル) */
export async function loadView(viewId: string): Promise<View | null> {
  if (_backend) return (await _backend.loadView(viewId)) as View | null;
  const s = localStorage.getItem(`${VIEW_PREFIX}${viewId}`);
  if (!s) return null;
  try { return JSON.parse(s) as View; } catch { return null; }
}

export async function loadViewValidationMap(): Promise<Map<ViewId, ValidationError[]>> {
  const entries = await listViews();
  const entryIds = new Set(entries.map((entry) => entry.id));

  let views: View[];
  if (_backend?.listAllViews) {
    const all = (await _backend.listAllViews()) as View[];
    views = all.filter((view) => entryIds.has(view.id));
  } else {
    views = (await Promise.all(entries.map((entry) => loadView(entry.id))))
      .filter((v): v is View => v !== null);
  }

  const validationMap = new Map<ViewId, ValidationError[]>();

  for (const view of views) {
    validationMap.set(view.id, validateView(view, views));
  }

  return validationMap;
}

/** ビュー定義を保存 (per-entity ファイル + project.json メタ同期) */
export async function saveView(view: View): Promise<void> {
  // $schema は spread 後に明示的に上書きして、旧 v1/v2 由来の $schema を必ず v3 ref に書き換える。
  const toSave: View = { ...view, $schema: VIEW_SCHEMA_REF, updatedAt: nowTs() };

  if (_backend) {
    await _backend.saveView(toSave.id, toSave);
  } else {
    localStorage.setItem(`${VIEW_PREFIX}${toSave.id}`, JSON.stringify(toSave));
  }

  await syncViewMeta(toSave);
}

/** ビューを新規作成 */
export async function createView(
  physicalName: PhysicalName,
  name: DisplayName,
  description?: string,
): Promise<View> {
  const ts = nowTs();
  const view: View = {
    $schema: VIEW_SCHEMA_REF,
    id: generateUUID() as ViewId,
    name,
    description,
    physicalName,
    selectStatement: "",
    outputColumns: [],
    dependencies: [],
    createdAt: ts,
    updatedAt: ts,
  };
  await saveView(view);
  return view;
}

/** ビューを削除 (per-entity ファイル + project.json メタ削除) */
export async function deleteView(viewId: string): Promise<void> {
  if (_backend) {
    await _backend.deleteView(viewId);
  } else {
    localStorage.removeItem(`${VIEW_PREFIX}${viewId}`);
  }

}

interface CommitViewsDeps {
  loadProject: typeof loadProject;
  saveProject: typeof saveProject;
  deleteView: typeof deleteView;
}

export async function commitViews(
  { itemsInOrder, deletedIds }: { itemsInOrder: ViewEntry[]; deletedIds: string[] },
  deps: CommitViewsDeps = { loadProject, saveProject, deleteView },
): Promise<void> {
  const project = await deps.loadProject();
  const deletedSet = new Set(deletedIds);
  const orderMap = new Map(itemsInOrder.map((v, i) => [v.id, i]));
  project.views = (project.views ?? [])
    .filter((v) => !deletedSet.has(v.id))
    .sort((a, b) => (orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    .map((v, i) => ({ ...v, no: i + 1 }));
  await deps.saveProject(project);
  for (const id of deletedIds) {
    await deps.deleteView(id);
  }
}

// ─── 内部 ────────────────────────────────────────────────────────────────

async function syncViewMeta(view: View): Promise<void> {
  const project = await loadProject();
  if (!project.views) project.views = [];

  const idx = project.views.findIndex((v) => v.id === view.id);
  const meta: ViewEntry = {
    id: view.id,
    no: idx >= 0 ? project.views[idx].no : nextNo(project.views),
    name: view.name,
    physicalName: view.physicalName,
    updatedAt: view.updatedAt,
    maturity: view.maturity,
  };

  if (idx >= 0) {
    project.views[idx] = meta;
  } else {
    project.views.push(meta);
  }
  project.views = renumber(project.views);
  await saveProject(project);
}
