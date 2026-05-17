/**
 * workspaceRouting — workspace URL `/w/:wsId/*` 規約のルーティングロジック (#1145 Phase-7)
 *
 * 本モジュールは AppShell 内の routing guard ロジックと wsPath 生成ロジックを
 * pure 関数として抽出したもの。副作用を持たないため単体テストが容易。
 *
 * - `wsPath(wsId, suffix)`: useWorkspacePath フックの本体ロジック (副作用なし)
 *   - 既存 hook `hooks/useWorkspacePath.ts` は React 依存のため、純粋ロジック側を本ファイルへ
 *     抽出 (逆コロケーション解消、test 用に重複定義していた本ロジックを統合)。
 *   - `useWorkspacePath` 自体は React hook として `hooks/useWorkspacePath.ts` に残し、
 *     内部で本関数を呼び出す形に整理することで重複を解消。
 *
 * - `evaluateRoutingGuard(state, wsId)`: AppShell の routing guard 判定を副作用なし純粋関数化。
 *   - active なし → /workspace/select redirect
 *   - wsId が active と異なり recent にある → workspace.open 呼び出し
 *   - wsId が recent にない → /workspace/select redirect
 *   - loading / lockdown / error は no-op
 *   - 副作用 (navigate / mcpBridge.request) は呼び出し側 (AppShell の useEffect) が担う。
 */

// ─── wsPath ──────────────────────────────────────────────────────────────────

/**
 * /w/:wsId/<suffix> 形式の URL を生成する純粋関数。
 *
 * - wsId が undefined / 空文字なら suffix をそのまま返す (workspace 横断ページ用)
 * - suffix が "/" で始まらない場合は "/" を補完
 *
 * 既存の React hook `useWorkspacePath` (frontend/src/hooks/useWorkspacePath.ts) は
 * 本関数を内部で呼び出す薄い wrapper (useParams + useCallback 安定化のみ担う)。
 */
export function wsPath(wsId: string | undefined, suffix: string): string {
  if (!wsId) return suffix;
  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `/w/${wsId}${normalizedSuffix}`;
}

// ─── routing guard ───────────────────────────────────────────────────────────

/** AppShell の routing guard が参照する workspace state subset
 *
 * `active.id` は store の型定義上 optional (WorkspaceActive.id?: string) のため、
 * `string | undefined` を許容する。本 guard では `id === undefined` の active は
 * 「不完全な active」として `wsId !== state.active.id` の判定で false 扱い
 * (= 自然に wsId 側が "他 ws" として処理される)。
 */
export interface RoutingGuardWorkspaceState {
  active: { id?: string; path: string; name: string | null } | null;
  workspaces: ReadonlyArray<{ id: string; path: string; name: string }>;
  loading: boolean;
  lockdown: boolean;
  error: string | null;
}

/** guard 判定結果の action 型 (副作用は呼び出し側で適用) */
export type RoutingGuardAction =
  | { type: "navigate"; path: string }
  | { type: "openWorkspace"; id: string }
  | { type: "none" };

/**
 * AppShell の routing guard 判定 (副作用なし純粋関数版)。
 *
 * - loading / lockdown / error="e2e bypass" → no-op
 *   (他の error 値は呼び出し側で別途扱う、本関数は AppShell の判定と一致させる)
 * - active===null:
 *   - wsId が undefined または recent に無い → "/workspace/select" へ navigate
 *   - wsId が recent にある → workspace.open(wsId) で復元
 * - active!==null && wsId が active.id と異なる:
 *   - wsId が recent にある → workspace.open(wsId) で同期
 *   - wsId が recent に無い → "/workspace/select" へ navigate
 *
 * 注意: workspace.open の二重発行 / redirectGuard チェック / loadWorkspaces 後追い等は
 * 呼び出し側 (AppShell の useEffect) が担う。本関数は判定のみ。
 */
export function evaluateRoutingGuard(
  state: RoutingGuardWorkspaceState,
  wsId: string | undefined,
): RoutingGuardAction {
  if (state.loading) return { type: "none" };
  if (state.lockdown) return { type: "none" };
  // e2e bypass 以外の error 状態は AppShell 側で別 effect (URL → タブ同期) が待機する。
  // routing guard としては error !== null なら判定保留 (no-op)。
  if (state.error !== null) return { type: "none" };

  if (state.active === null) {
    if (wsId) {
      const recentEntry = state.workspaces.find((w) => w.id === wsId);
      if (recentEntry) {
        return { type: "openWorkspace", id: wsId };
      }
    }
    return { type: "navigate", path: "/workspace/select" };
  }

  if (wsId && wsId !== state.active.id) {
    const recentEntry = state.workspaces.find((w) => w.id === wsId);
    if (recentEntry) {
      return { type: "openWorkspace", id: wsId };
    }
    return { type: "navigate", path: "/workspace/select" };
  }

  return { type: "none" };
}
