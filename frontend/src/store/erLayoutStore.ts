/**
 * erLayoutStore.ts (v3, #556)
 * ER 図レイアウトの永続化ストア。
 *
 * - data/er-layout.json (単一ファイル、v3 schema 準拠)
 * - $schema 属性で v3 schema 参照を保存
 * - view-mode preview cache: v3-er-layout-preview (positions のみ)
 */
import type { ErLayout, Timestamp } from "../types/v3";

export interface ErLayoutStorageBackend {
  loadErLayout(): Promise<unknown>;
  saveErLayout(data: unknown): Promise<void>;
}

let _backend: ErLayoutStorageBackend | null = null;

export function setErLayoutStorageBackend(b: ErLayoutStorageBackend | null): void {
  _backend = b;
}

function requireBackend(): ErLayoutStorageBackend {
  if (!_backend) {
    throw new Error("ER レイアウトの保存には backend 接続が必要です。backend (port 5179) を起動してください。");
  }
  return _backend;
}

// ─── view-mode preview cache (per-browser) ───────────────────────────────

const ER_LAYOUT_PREVIEW_KEY = "v3-er-layout-preview";

const ER_LAYOUT_SCHEMA_REF = "../schemas/v3/er-layout.v3.schema.json";

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

function createEmptyLayout(): ErLayout {
  return {
    $schema: ER_LAYOUT_SCHEMA_REF,
    positions: {},
    logicalRelations: [],
    updatedAt: nowTs(),
  };
}

// ─── 公開 API ────────────────────────────────────────────────────────────

export async function loadErLayout(): Promise<ErLayout> {
  const data = await requireBackend().loadErLayout();
  const canonical = data ? data as ErLayout : createEmptyLayout();
  const preview = loadErLayoutPreview();
  if (!preview) return canonical;
  return {
    ...canonical,
    positions: { ...canonical.positions, ...preview.positions },
  };
}

export function loadErLayoutPreview(): Pick<ErLayout, "positions"> | null {
  const raw = localStorage.getItem(ER_LAYOUT_PREVIEW_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ErLayout>;
    return { positions: parsed.positions ?? {} };
  } catch {
    return null;
  }
}

export function saveErLayoutPreview(layout: Pick<ErLayout, "positions">): void {
  try {
    localStorage.setItem(ER_LAYOUT_PREVIEW_KEY, JSON.stringify({ positions: layout.positions ?? {} }));
  } catch { /* ignore */ }
}

export function clearErLayoutPreview(): void {
  try {
    localStorage.removeItem(ER_LAYOUT_PREVIEW_KEY);
  } catch { /* ignore */ }
}

export async function loadErLayoutCanonical(): Promise<ErLayout> {
  const data = await requireBackend().loadErLayout();
  if (data) return data as ErLayout;
  return createEmptyLayout();
}

export async function saveErLayoutCanonical(layout: ErLayout): Promise<void> {
  // $schema は spread 後に明示的に上書きして、旧 v1/v2 由来の $schema を必ず v3 ref に書き換える。
  const toSave: ErLayout = { ...layout, $schema: ER_LAYOUT_SCHEMA_REF, updatedAt: nowTs() };
  await requireBackend().saveErLayout(toSave);
  clearErLayoutPreview();
}

export async function saveErLayout(layout: ErLayout): Promise<void> {
  await saveErLayoutCanonical(layout);
}
