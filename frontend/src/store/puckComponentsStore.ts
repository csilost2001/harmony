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

import type { Data } from "@measured/puck";
import type { BUILTIN_PRIMITIVE_NAMES } from "../puck/buildConfig";
import { uiInfo } from "../utils/uiLog";

// ─── 型定義 ───────────────────────────────────────────────────────────────────

export interface PropSchemaField {
  type: "string" | "number" | "boolean" | "enum";
  default?: unknown;
  enum?: Array<{ label: string; value: string }>; // type=enum のとき
  label?: string;
}

/**
 * primitive ベースの単発カスタムコンポーネント定義 (#806 子 5)。
 * 既存形式。1 つの primitive に propsSchema を付与した派生部品。
 */
export interface PrimitivePuckComponentDef {
  kind: "primitive";
  id: string;
  label: string;
  primitive: (typeof BUILTIN_PRIMITIVE_NAMES)[number] | string; // BUILTIN_PRIMITIVE_NAMES のいずれか
  propsSchema: Record<string, PropSchemaField>;
}

/**
 * 複合部品 (subtree 再利用、#1412 P-4)。
 * 設計者が Puck 上で組み合わせた subtree を「再利用部品」として保存したもの。
 * パレットから drop すると subtree がその場で展開挿入される (expand-on-drop)。
 *
 * - `tree` = 自己完結した Puck Data 断片 (content + zones サブセット)。
 *   root は持たない (展開時はホスト Data の content に merge されるため)。
 * - `dependencies` = subtree が内包する外部 component (#1409 P-1) の entry.id 一覧。
 *   未ロードの外部 component を含む場合の capability 6 (依存解決エラー) 判定に使う。
 */
export interface CompositePuckComponentDef {
  kind: "composite";
  id: string;
  label: string;
  tree: {
    content: Data["content"];
    zones?: Data["zones"];
  };
  dependencies?: string[];
}

/**
 * カスタム Puck コンポーネント定義の discriminated union (#1412 P-4)。
 * `kind` で primitive / composite を判別する。`kind` 無しの旧レコードは
 * load 時に `kind: "primitive"` へ normalize される (後方安全)。
 */
export type CustomPuckComponentDef =
  | PrimitivePuckComponentDef
  | CompositePuckComponentDef;

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
    return normalizeRecords(JSON.parse(raw) as unknown[]);
  } catch {
    return [];
  }
}

/**
 * 永続化されたレコード配列を `kind` 付き discriminated union に正規化する (#1412 P-4)。
 * `kind` 無しの旧レコード (P-4 以前は primitive 形式のみ) は `kind: "primitive"` を付与する。
 * 後方安全のため、不明な構造のレコードはそのまま通す (draft-state policy)。
 */
function normalizeRecords(records: unknown[]): CustomPuckComponentDef[] {
  return records.map((rec) => {
    if (rec && typeof rec === "object" && !("kind" in rec)) {
      return { kind: "primitive", ...(rec as object) } as CustomPuckComponentDef;
    }
    return rec as CustomPuckComponentDef;
  });
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

/** すべてのカスタム Puck コンポーネント定義を読み込む */
export async function loadCustomPuckComponents(): Promise<CustomPuckComponentDef[]> {
  const backend = requireBackend();
  const data = normalizeRecords(await backend.loadPuckComponents());
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

/**
 * 部分更新。
 * `kind` をまたぐ更新 (primitive → composite 等) は想定しないため、
 * 同 kind 内のフィールド patch のみを許可する。id は変更不可。
 */
export async function updateCustomPuckComponent(
  id: string,
  patch: Partial<CustomPuckComponentDef>,
): Promise<void> {
  const components = await loadCustomPuckComponents();
  const idx = components.findIndex((c) => c.id === id);
  if (idx < 0) throw new Error(`puck component "${id}" not found`);
  // id / kind は不変。それ以外を patch でマージする。
  components[idx] = {
    ...components[idx],
    ...patch,
    id,
    kind: components[idx].kind,
  } as CustomPuckComponentDef;
  await saveCustomPuckComponents(components);
}
