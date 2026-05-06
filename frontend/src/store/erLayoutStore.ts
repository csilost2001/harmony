/**
 * erLayoutStore.ts (v3, #556)
 * ER 図レイアウトの永続化ストア。
 *
 * - data/er-layout.json (単一ファイル、v3 schema 準拠)
 * - $schema 属性で v3 schema 参照を保存
 * - localStorage キー prefix: v3-er-layout
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

// ─── localStorage キー (v3 名前空間、#556) ───────────────────────────────

const ER_LAYOUT_KEY = "v3-er-layout";

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
  if (_backend) {
    const data = await _backend.loadErLayout();
    if (data) return data as ErLayout;
    return createEmptyLayout();
  }
  const raw = localStorage.getItem(ER_LAYOUT_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as ErLayout;
    } catch { /* ignore */ }
  }
  return createEmptyLayout();
}

export async function saveErLayout(layout: ErLayout): Promise<void> {
  // $schema は spread 後に明示的に上書きして、旧 v1/v2 由来の $schema を必ず v3 ref に書き換える。
  const toSave: ErLayout = { ...layout, $schema: ER_LAYOUT_SCHEMA_REF, updatedAt: nowTs() };
  if (_backend) {
    await _backend.saveErLayout(toSave);
    return;
  }
  localStorage.setItem(ER_LAYOUT_KEY, JSON.stringify(toSave));
}
