/**
 * customBlockStore.ts
 * カスタムブロックの永続化ストア
 *
 * - wsBridge 接続時: サーバー側ファイルに保存（mcpBridge 経由）
 * - 未接続時: localStorage にフォールバック
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

/** mcpBridge が接続時にセット、切断時に null をセット */
export function setCustomBlocksBackend(b: CustomBlocksStorageBackend | null): void {
  _backend = b;
}

// ─── localStorage キー ────────────────────────────────────────────────────

const STORAGE_KEY = "designer-custom-blocks";

// ─── localStorage ユーティリティ ─────────────────────────────────────────

function loadFromLocalStorage(): CustomBlock[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CustomBlock[];
  } catch {
    return [];
  }
}

function saveToLocalStorage(blocks: CustomBlock[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blocks));
}

// ─── 公開 API（非同期）────────────────────────────────────────────────────

/** すべてのカスタムブロックを読み込む */
export async function loadCustomBlocks(): Promise<CustomBlock[]> {
  if (_backend) {
    const data = (await _backend.loadCustomBlocks()) as CustomBlock[];
    if (data.length > 0) return data;
    // ファイルが空 → localStorage から移行
    const local = loadFromLocalStorage();
    if (local.length > 0) {
      await _backend.saveCustomBlocks(local);
      console.log("[customBlockStore] Migrated custom blocks from localStorage to file");
      return local;
    }
    return [];
  }
  return loadFromLocalStorage();
}

/** すべてのカスタムブロックを保存（全量書き込み） */
export async function saveCustomBlocks(blocks: CustomBlock[]): Promise<void> {
  if (_backend) {
    await _backend.saveCustomBlocks(blocks);
    return;
  }
  saveToLocalStorage(blocks);
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
