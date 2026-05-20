/**
 * puckComponentsStore.ts
 * Puck カスタムコンポーネント定義の永続化ストア
 *
 * wsBridge 経由でサーバー側ファイル (`workspaces/<wsId>/puck-components.json`) に保存する。
 * backend がファイル空を返した場合に限り、旧 localStorage データを 1 度きり救済して
 * backend に書き戻す migration を維持する (#923 シリーズで本体 fallback は廃止済み)。
 *
 * customBlockStore と同パターン (#806 子 5)
 */

import type { BUILTIN_PRIMITIVE_NAMES } from "../puck/buildConfig";
import { uiInfo } from "../utils/uiLog";

// ─── 型定義 ───────────────────────────────────────────────────────────────────

export interface PropSchemaField {
  type: "string" | "number" | "boolean" | "enum";
  default?: unknown;
  enum?: Array<{ label: string; value: string }>; // type=enum のとき
  label?: string;
}

export interface CustomPuckComponentDef {
  id: string;
  label: string;
  primitive: (typeof BUILTIN_PRIMITIVE_NAMES)[number] | string; // BUILTIN_PRIMITIVE_NAMES のいずれか
  propsSchema: Record<string, PropSchemaField>;
}

// ─── ストレージバックエンド ───────────────────────────────────────────────────

export interface PuckComponentsStorageBackend {
  loadPuckComponents(): Promise<unknown[]>;
  savePuckComponents(components: unknown[]): Promise<void>;
}

let _backend: PuckComponentsStorageBackend | null = null;

/** mcpBridge が接続時にセット */
export function setPuckComponentsBackend(b: PuckComponentsStorageBackend | null): void {
  _backend = b;
}

function requireBackend(): PuckComponentsStorageBackend {
  if (!_backend) {
    throw new Error("puckComponentsStore: backend が初期化されていません (wsBridge 未接続)");
  }
  return _backend;
}

// ─── localStorage 1 度きり migration キー (#923 シリーズで本体 fallback は廃止) ─

const LEGACY_LS_KEY = "designer-puck-components";

function readLegacyLocalStorage(): CustomPuckComponentDef[] {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomPuckComponentDef[];
  } catch {
    return [];
  }
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

/** すべてのカスタム Puck コンポーネント定義を読み込む */
export async function loadCustomPuckComponents(): Promise<CustomPuckComponentDef[]> {
  const backend = requireBackend();
  const data = (await backend.loadPuckComponents()) as CustomPuckComponentDef[];
  if (data.length > 0) return data;
  // ファイルが空 → 旧 localStorage から 1 度きり migration
  const legacy = readLegacyLocalStorage();
  if (legacy.length > 0) {
    await backend.savePuckComponents(legacy);
    uiInfo("load", "puckComponentsStore: Migrated puck components from localStorage to file");
    return legacy;
  }
  return [];
}

/** 全量書き込み */
export async function saveCustomPuckComponents(components: CustomPuckComponentDef[]): Promise<void> {
  await requireBackend().savePuckComponents(components);
}

/** 追加 (id 重複時はエラー) */
export async function addCustomPuckComponent(def: CustomPuckComponentDef): Promise<void> {
  const components = await loadCustomPuckComponents();
  if (components.some((c) => c.id === def.id)) {
    throw new Error(`puck component id "${def.id}" already exists`);
  }
  components.push(def);
  await saveCustomPuckComponents(components);
}

/** 削除 */
export async function removeCustomPuckComponent(id: string): Promise<void> {
  const components = await loadCustomPuckComponents();
  const filtered = components.filter((c) => c.id !== id);
  await saveCustomPuckComponents(filtered);
}

/** 部分更新 */
export async function updateCustomPuckComponent(
  id: string,
  patch: Partial<CustomPuckComponentDef>,
): Promise<void> {
  const components = await loadCustomPuckComponents();
  const idx = components.findIndex((c) => c.id === id);
  if (idx < 0) throw new Error(`puck component "${id}" not found`);
  components[idx] = { ...components[idx], ...patch, id }; // id は変更不可
  await saveCustomPuckComponents(components);
}
