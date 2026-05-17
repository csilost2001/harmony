/**
 * RPC handler types (#1144 Phase-2)
 *
 * wsBridge.ts の `_handleBrowserRequest` 内 64 RPC method dispatcher を
 * 機能領域別の handler モジュール (wsHandlers/*.ts) に分離するための共通契約。
 *
 * 各 handler モジュールは `Record<methodName, RpcHandler>` 形式の map を export し、
 * wsBridge 側で merge して `Map<string, RpcHandler>` で lookup する。
 *
 * Phase-1 の index.ts handler (機能領域別 + null 返却で次 handler 試行) とは異なり、
 * wsBridge 側の RPC は method 名で完全一意なため、null fall-through ではなく
 * Map lookup で direct dispatch する (Phase-1 より単純で高速)。
 */
import type { WsBridge } from "../wsBridge.js";

/**
 * 各 RPC handler が利用する context。
 *
 * - `params` / `clientId` は WS request から渡される
 * - `root` / `wsId` は per-session の lazy getter (workspace 未選択時の throw を遅延)
 * - `respond` / `respondError` は client へ JSON-RPC response を返す
 * - `bridge` は editSession* / broadcast / codex 公開 API を呼び出すためのアクセス点
 */
export type RpcContext = {
  params: unknown;
  clientId: string;
  /** per-session active workspace root を解決 (未選択時は throw)。lazy 評価のため getter */
  root: () => string;
  /** per-session active workspace path (broadcast scoping 用)。未選択時は null */
  wsId: () => string | null;
  /** client へ正常応答を返す */
  respond: (result: unknown) => void;
  /** client へエラー応答を返す */
  respondError: (error: string) => void;
  /** wsBridge 公開 API (broadcast / editSession* / codex) アクセス点 */
  bridge: WsBridge;
};

/** RPC handler 関数。Promise を返してもよい (await される)。 */
export type RpcHandler = (ctx: RpcContext) => Promise<void> | void;

/** handler モジュールが export する method → handler の map。 */
export type RpcHandlerMap = Record<string, RpcHandler>;
