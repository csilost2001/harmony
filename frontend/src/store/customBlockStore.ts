/**
 * customBlockStore.ts
 * カスタムブロックの永続化ストア
 *
 * wsBridge 経由でサーバー側ファイル (`workspaces/<wsId>/custom-blocks.json`) に保存する。
 * backend がファイル空を返した場合に限り、旧 localStorage データを 1 度きり救済して
 * backend に書き戻す migration を維持する (#923 シリーズで本体 fallback は廃止済み)。
 */
import type { Editor as GEditor } from "grapesjs";

export interface CustomBlock {
  id: string;
  label: string;
  category: string;
  content: string;
  styles?: string;
  media?: string;
  shared?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── ストレージバックエンド ───────────────────────────────────────────────

export interface CustomBlocksStorageBackend {
  loadCustomBlocks(): Promise<unknown[]>;
  saveCustomBlocks(blocks: unknown[]): Promise<void>;
}

let _backend: CustomBlocksStorageBackend | null = null;

/** mcpBridge が接続時にセット */
export function setCustomBlocksBackend(b: CustomBlocksStorageBackend | null): void {
  _backend = b;
}

function requireBackend(): CustomBlocksStorageBackend {
  if (!_backend) {
    throw new Error("customBlockStore: backend が初期化されていません (wsBridge 未接続)");
  }
  return _backend;
}

// ─── localStorage 1 度きり migration キー (#923 シリーズで本体 fallback は廃止) ─

const LEGACY_LS_KEY = "designer-custom-blocks";

function readLegacyLocalStorage(): CustomBlock[] {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomBlock[];
  } catch {
    return [];
  }
}

// ─── 公開 API（非同期）────────────────────────────────────────────────────

/** すべてのカスタムブロックを読み込む */
export async function loadCustomBlocks(): Promise<CustomBlock[]> {
  const backend = requireBackend();
  const data = (await backend.loadCustomBlocks()) as CustomBlock[];
  if (data.length > 0) return data;
  // ファイルが空 → 旧 localStorage から 1 度きり migration
  const legacy = readLegacyLocalStorage();
  if (legacy.length > 0) {
    await backend.saveCustomBlocks(legacy);
    console.log("[customBlockStore] Migrated custom blocks from localStorage to file");
    return legacy;
  }
  return [];
}

/** すべてのカスタムブロックを保存（全量書き込み） */
export async function saveCustomBlocks(blocks: CustomBlock[]): Promise<void> {
  await requireBackend().saveCustomBlocks(blocks);
}

/** 追加 or 更新（id で upsert） */
export async function upsertCustomBlock(block: CustomBlock): Promise<void> {
  const blocks = await loadCustomBlocks();
  const idx = blocks.findIndex((b) => b.id === block.id);
  if (idx >= 0) {
    blocks[idx] = block;
  } else {
    blocks.push(block);
  }
  await saveCustomBlocks(blocks);
}

/** 削除（成功: true / 未存在: false） */
export async function deleteCustomBlock(id: string): Promise<boolean> {
  const blocks = await loadCustomBlocks();
  const filtered = blocks.filter((b) => b.id !== id);
  if (filtered.length === blocks.length) return false;
  await saveCustomBlocks(filtered);
  return true;
}

/** 単一取得 */
export async function getCustomBlock(id: string): Promise<CustomBlock | undefined> {
  const blocks = await loadCustomBlocks();
  return blocks.find((b) => b.id === id);
}

/**
 * 全カスタムブロックの CSS をキャンバス iframe に注入。
 * `<style id="custom-blocks-css">` を使い、呼び出しのたびに全量上書き。
 * ※ この関数は同期（GrapesJS の DOM 操作）
 */
export function injectCustomBlockCss(editor: GEditor, blocks: CustomBlock[]): void {
  try {
    const canvasDoc = editor.Canvas.getDocument();
    if (!canvasDoc) return;

    let styleEl = canvasDoc.getElementById("custom-blocks-css") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = canvasDoc.createElement("style");
      styleEl.id = "custom-blocks-css";
      canvasDoc.head.appendChild(styleEl);
    }

    const allCss = blocks
      .filter((b) => b.styles)
      .map((b) => `/* block: ${b.id} */\n${b.styles}`)
      .join("\n\n");

    styleEl.textContent = allCss;
  } catch {
    // キャンバスがまだ準備できていない場合は無視
  }
}
