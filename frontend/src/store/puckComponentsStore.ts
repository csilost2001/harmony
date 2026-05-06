/**
 * puckComponentsStore.ts
 * Puck カスタムコンポーネント定義の永続化ストア
 *
 * - wsBridge 接続時: サーバー側ファイルに保存（mcpBridge 経由）
 *   ファイルパス: workspaces/<wsId>/puck-components.json
 * - 未接続時: localStorage にフォールバック
 *
 * customBlockStore と同パターン (#806 子 5)
 */

import type { BUILTIN_PRIMITIVE_NAMES } from "../puck/buildConfig";

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

/** mcpBridge が接続時にセット、切断時に null をセット */
export function setPuckComponentsBackend(b: PuckComponentsStorageBackend | null): void {
  _backend = b;
}

// ─── localStorage キー ────────────────────────────────────────────────────────

const STORAGE_KEY = "designer-puck-components";

// ─── localStorage ユーティリティ ─────────────────────────────────────────────

function loadFromLocalStorage(): CustomPuckComponentDef[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CustomPuckComponentDef[];
  } catch {
    return [];
  }
}

function saveToLocalStorage(components: CustomPuckComponentDef[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(components));
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

/** すべてのカスタム Puck コンポーネント定義を読み込む */
export async function loadCustomPuckComponents(): Promise<CustomPuckComponentDef[]> {
  if (_backend) {
    const data = (await _backend.loadPuckComponents()) as CustomPuckComponentDef[];
    if (data.length > 0) return data;
    // ファイルが空 → localStorage から移行
    const local = loadFromLocalStorage();
    if (local.length > 0) {
      await _backend.savePuckComponents(local);
      console.log("[puckComponentsStore] Migrated puck components from localStorage to file");
      return local;
    }
    return [];
  }
  return loadFromLocalStorage();
}

/** 全量書き込み */
export async function saveCustomPuckComponents(components: CustomPuckComponentDef[]): Promise<void> {
  if (_backend) {
    await _backend.savePuckComponents(components);
    return;
  }
  saveToLocalStorage(components);
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
