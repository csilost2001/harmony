/**
 * remoteStorage.ts
 *
 * GrapesJS カスタムストレージマネージャー — edit-session-draft モデル (#689)。
 *
 * load():
 *   - draft が存在する場合 → draft を読み込む (編集継続)
 *   - draft がない場合 → 本体ファイルを読み込む
 *
 * store():
 *   - autosave: false のため通常は呼ばれない
 *   - 念のため no-op として残す (将来削除候補)
 */
import type { Editor as GEditor } from "grapesjs";
import { mcpBridge } from "../mcp/mcpBridge";
import { recordError } from "../utils/errorLog";

/**
 * GrapesJS が期待する最小プロジェクト構造。pages が欠落していると
 * Canvas.init の postLoad で getFrames() が undefined.length で落ちる (#131)。
 * この形状を load() の全フォールバック経路で保証する。
 */
const EMPTY_PROJECT: Record<string, unknown> = Object.freeze({
  assets: [],
  styles: [],
  pages: [{ frames: [{ component: { type: "wrapper" } }] }],
});

/**
 * 破損・不正形のプロジェクトデータを最低限起動可能な形に補正する。
 * 補正が発生した場合は errorLog に痕跡を残し、ユーザーが事後にエラーダイアログから
 * 履歴として確認できるようにする。
 *
 * #815 PR-C で `editor.loadProjectData()` 経由の明示 load 化に伴い export 化。
 * GrapesJSBackend が pre-load した payload に対しても本関数を適用する。
 */
export function ensureValidProject(
  raw: Record<string, unknown> | null | undefined,
  screenId: string,
  source: string,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    recordError({
      source: "manual",
      message: `画面データが空/不正のため、空のプロジェクトで起動します (screenId=${screenId}, source=${source})`,
      context: { screenId, source },
    });
    return { ...EMPTY_PROJECT };
  }
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) {
    recordError({
      source: "manual",
      message: `画面データの pages が欠落しています。デフォルト構造で補正しました (screenId=${screenId}, source=${source})`,
      context: { screenId, source, keys: Object.keys(raw) },
    });
    return { ...raw, pages: EMPTY_PROJECT.pages };
  }
  return raw;
}

/** GrapesJS に "remote" ストレージタイプを登録 (edit-session-draft モデル) */
export function registerRemoteStorage(editor: GEditor, screenId: string): void {
  editor.StorageManager.add("remote", {
    async load(): Promise<Record<string, unknown>> {
      // draft が存在すれば draft を優先して読み込む (編集セッション継続)
      try {
        const draftCheck = await mcpBridge.hasDraft("screen", screenId) as { exists: boolean } | null;
        if (draftCheck?.exists) {
          const draftData = await mcpBridge.readDraft("screen", screenId) as Record<string, unknown> | null;
          if (draftData && Object.keys(draftData).length > 0) {
            return ensureValidProject(draftData, screenId, "draft-server");
          }
        }
      } catch {
        // MCP 未接続などで draft チェックに失敗した場合は本体読み込みに fallthrough
      }

      // draft なし or draft 読み込み失敗 → 本体ファイルを読み込む
      try {
        const data = await mcpBridge.request("loadScreen", { screenId }) as Record<string, unknown> | null;
        if (data && Object.keys(data).length > 0) {
          return ensureValidProject(data, screenId, "mcp-loadScreen");
        }
        return ensureValidProject(null, screenId, "no-data");
      } catch {
        return ensureValidProject(null, screenId, "mcp-error-no-data");
      }
    },

    // autosave: false のため通常は呼ばれない。念のため no-op。
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async store(_data: Record<string, unknown>): Promise<void> {
      // no-op: 保存は editActions.save() → commitDraft 経由で行う
    },
  });
}

// ---------------------------------------------------------------------------
// Legacy compatibility exports
// ---------------------------------------------------------------------------
// 以前の localStorage ベースの API は廃止するが、呼び出し元のコード整理のために
// stub を残す。Designer.tsx は新 API (editActions / mcpBridge) を直接使う。

/** @deprecated 新モデルでは mcpBridge.hasDraft を使用する */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function hasScreenDraft(_screenId: string): boolean {
  return false;
}

/** @deprecated 新モデルでは不要 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function clearScreenDraft(_screenId: string): void {
  // no-op
}

/** @deprecated 新モデルでは editActions.save() → commitDraft を使用する */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function saveScreenToFile(_screenId: string): Promise<void> {
  throw new Error("saveScreenToFile は廃止されました。editActions.save() を使用してください。");
}
