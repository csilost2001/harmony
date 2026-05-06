/**
 * legacyLocalStorageRescue.ts
 *
 * localStorage の旧キー (`gjs-screen-{id}`) に残っている GrapesJS データを
 * サーバ側 draft に移行するための救済ヘルパー。
 *
 * 経緯: #689 以前は autosave で localStorage のみに保存していたため、
 * 本体ファイルと差分のある旧データが残っている可能性がある。
 * 初回マウント時に 1 回だけ検査し、差分があれば確認後 draft に変換する。
 */

import { mcpBridge } from "../mcp/mcpBridge";
import { screenStorageKey } from "../store/flowStore";

/** 旧ドラフトマーカーキー */
function legacyDraftMarkerKey(screenId: string): string {
  return `gjs-screen-${screenId}-draft`;
}

export interface LegacyCheckResult {
  hasLegacy: boolean;
  data?: unknown;
}

/**
 * localStorage に旧データがあり、本体ファイルと内容が異なるか検査する。
 * - `gjs-screen-{id}` キーが存在しない → { hasLegacy: false }
 * - 存在するが本体と同じ内容 → { hasLegacy: false } (差分なし・自動削除)
 * - 存在して本体と異なる → { hasLegacy: true, data: parsedData }
 */
export async function checkLegacyLocalStorage(screenId: string): Promise<LegacyCheckResult> {
  const localKey = screenStorageKey(screenId);
  const raw = localStorage.getItem(localKey);
  if (!raw) return { hasLegacy: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 破損データは黙って削除
    clearLegacyLocalStorage(screenId);
    return { hasLegacy: false };
  }

  // 本体ファイルと比較
  try {
    const canonical = await mcpBridge.request("loadScreen", { screenId }) as Record<string, unknown> | null;
    if (!canonical || Object.keys(canonical).length === 0) {
      // 本体がない = 新規画面なので旧 localStorage データを採用候補とする
      return { hasLegacy: true, data: parsed };
    }
    const canonicalStr = JSON.stringify(canonical);
    const localStr = JSON.stringify(parsed);
    if (canonicalStr === localStr) {
      // 差分なし = 既にサーバに同期済み
      clearLegacyLocalStorage(screenId);
      return { hasLegacy: false };
    }
    return { hasLegacy: true, data: parsed };
  } catch {
    // MCP 未接続などでは差分チェック不能 → 旧データを提示
    return { hasLegacy: true, data: parsed };
  }
}

/**
 * 旧データを draft に変換する (採用) か、単純削除する (破棄)。
 * - "adopt": createDraft + updateDraft で draft 化 → localStorage 削除
 * - "discard": localStorage のみ削除
 */
export async function executeRescue(
  screenId: string,
  action: "adopt" | "discard",
  data?: unknown,
): Promise<void> {
  if (action === "adopt" && data !== undefined) {
    await mcpBridge.createDraft("screen", screenId);
    await mcpBridge.updateDraft("screen", screenId, data);
  }
  clearLegacyLocalStorage(screenId);
}

/** localStorage の旧キー群を削除 */
export function clearLegacyLocalStorage(screenId: string): void {
  try { localStorage.removeItem(screenStorageKey(screenId)); } catch { /* ignore */ }
  try { localStorage.removeItem(legacyDraftMarkerKey(screenId)); } catch { /* ignore */ }
}
