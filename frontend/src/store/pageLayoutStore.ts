/**
 * pageLayoutStore — PageLayout CRUD + WebSocket sync (pl-3, #1024)
 *
 * viewDefinitionStore.ts を完全踏襲。
 * backend WebSocket handlers: loadPageLayout / savePageLayout / deletePageLayout / listAllPageLayouts
 */

import type { Uuid, Timestamp, DisplayName, Maturity } from "../types/v3";
import type { PageLayoutEntry } from "../types/v3/harmony";
import { generateUUID } from "../utils/uuid";
import { loadRawProject, saveRawProject } from "./flowStore";
import { renumber, nextNo } from "../utils/listOrder";

// ─── PageLayout 型 (schema と 1:1) ───────────────────────────────────────────

export type PageLayoutEditorKind = "grapesjs" | "puck";
export type PageLayoutCssFramework = "bootstrap" | "tailwind";

export interface PageLayoutDesign {
  editorKind: PageLayoutEditorKind;
  cssFramework: PageLayoutCssFramework;
  designFileRef?: string;
  puckDataRef?: string;
  thumbnailRef?: string;
}

export interface PageLayoutRegion {
  name: string;
  description?: string;
}

export interface PageLayout {
  $schema?: string;
  id: Uuid;
  name: DisplayName;
  description?: string;
  maturity?: Maturity;
  regions: PageLayoutRegion[];
  assignments: Record<string, string>;
  processFlowId?: Uuid;
  design: PageLayoutDesign;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Storage backend interface ────────────────────────────────────────────────

export interface PageLayoutStorageBackend {
  loadPageLayout(pageLayoutId: string): Promise<unknown>;
  listAllPageLayouts?(): Promise<unknown[]>;
  savePageLayout(pageLayoutId: string, data: unknown): Promise<void>;
  deletePageLayout(pageLayoutId: string): Promise<void>;
}

let _backend: PageLayoutStorageBackend | null = null;

export function setPageLayoutStorageBackend(b: PageLayoutStorageBackend | null): void {
  _backend = b;
}

const PAGE_LAYOUT_SCHEMA_REF = "../../schemas/v3/page-layout.v3.schema.json";

function requireBackend(): PageLayoutStorageBackend {
  if (!_backend) {
    throw new Error("pageLayoutStore: backend が初期化されていません (wsBridge 未接続)");
  }
  return _backend;
}

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listPageLayouts(): Promise<PageLayoutEntry[]> {
  const { loadRawProject: loadRaw } = await import("./flowStore");
  const raw = await loadRaw();
  return raw.entities?.pageLayouts ?? [];
}

export async function loadPageLayout(pageLayoutId: string): Promise<PageLayout | null> {
  return (await requireBackend().loadPageLayout(pageLayoutId)) as PageLayout | null;
}

export async function savePageLayout(pl: PageLayout): Promise<void> {
  const toSave: PageLayout = {
    ...pl,
    $schema: PAGE_LAYOUT_SCHEMA_REF,
    updatedAt: nowTs(),
  };

  await requireBackend().savePageLayout(toSave.id, toSave);

  await syncPageLayoutMeta(toSave);
}

export async function createPageLayout(
  name: DisplayName,
  editorKind: PageLayoutEditorKind,
  cssFramework: PageLayoutCssFramework,
  description?: string,
): Promise<PageLayout> {
  const ts = nowTs();
  const pl: PageLayout = {
    $schema: PAGE_LAYOUT_SCHEMA_REF,
    id: generateUUID() as Uuid,
    name,
    description,
    maturity: "draft",
    regions: [
      { name: "header", description: "グローバルヘッダ" },
      { name: "main", description: "メインコンテンツ (page Screen がここに嵌まる)" },
      { name: "footer", description: "グローバルフッタ" },
    ],
    assignments: {},
    design: {
      editorKind,
      cssFramework,
    },
    createdAt: ts,
    updatedAt: ts,
  };
  await savePageLayout(pl);
  return pl;
}

export async function deletePageLayout(pageLayoutId: string): Promise<void> {
  await requireBackend().deletePageLayout(pageLayoutId);
}

// ─── Commit (一覧の並び替え + 削除を harmony.json に反映) ───────────────────

interface CommitPageLayoutsDeps {
  loadRawProject?: typeof loadRawProject;
  saveRawProject?: typeof saveRawProject;
  deletePageLayout?: typeof deletePageLayout;
}

export async function commitPageLayouts(
  { itemsInOrder, deletedIds }: { itemsInOrder: PageLayoutEntry[]; deletedIds: string[] },
  deps: CommitPageLayoutsDeps = { loadRawProject, saveRawProject, deletePageLayout },
): Promise<void> {
  const loadRaw = deps.loadRawProject ?? loadRawProject;
  const saveRaw = deps.saveRawProject ?? saveRawProject;
  const doDelete = deps.deletePageLayout ?? deletePageLayout;

  const raw = await loadRaw();
  if (!raw.entities) raw.entities = {};
  const deletedSet = new Set(deletedIds);
  const orderMap = new Map(itemsInOrder.map((v, i) => [v.id, i]));
  raw.entities.pageLayouts = (raw.entities.pageLayouts ?? [])
    .filter((v) => !deletedSet.has(String(v.id)))
    .sort(
      (a, b) =>
        (orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((v, i) => ({ ...v, no: i + 1 }));
  await saveRaw(raw);
  for (const id of deletedIds) {
    await doDelete(id);
  }
}

// ─── Internal: harmony.json へのメタ同期 ────────────────────────────────────

async function syncPageLayoutMeta(pl: PageLayout): Promise<void> {
  const raw = await loadRawProject();
  if (!raw.entities) raw.entities = {};
  const entries = raw.entities.pageLayouts ?? [];

  const idx = entries.findIndex((entry) => String(entry.id) === String(pl.id));
  // RFC #1021 pl-6 (Sonnet Should-fix): hasDesign は designFileRef/puckDataRef の実体有無で判定し、
  // backend handler (index.ts) と同じロジックに揃える
  const design = pl.design ?? {};
  const meta: PageLayoutEntry = {
    id: pl.id as Uuid,
    no: idx >= 0 ? entries[idx].no : nextNo(entries),
    name: pl.name,
    maturity: pl.maturity,
    updatedAt: pl.updatedAt,
    regionCount: pl.regions?.length ?? 0,
    assignmentCount: Object.keys(pl.assignments ?? {}).length,
    hasProcessFlow: !!pl.processFlowId,
    hasDesign: !!(design.designFileRef ?? design.puckDataRef),
  };

  if (idx >= 0) {
    entries[idx] = meta;
  } else {
    entries.push(meta);
  }
  raw.entities.pageLayouts = renumber(entries);
  await saveRawProject(raw);
}
