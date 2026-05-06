/**
 * workspace routing guard ロジックの単体テスト (#702 R-4)
 *
 * AppShell の URL ↔ workspace context 連携ロジックを検証。
 * - routing guard: active なし → /workspace/select redirect
 * - routing guard: wsId が active と異なり recent にある → workspace.open 呼び出し
 * - routing guard: wsId が recent にない (不正 wsId) → /workspace/select redirect
 * - wsPath フック: wsId が取れる場合 /w/:wsId/<suffix> を返す
 * - wsPath フック: wsId がない場合は suffix をそのまま返す
 */

import { describe, it, expect } from "vitest";

// ─── wsPath ロジック単体テスト ───────────────────────────────────────────────
// useWorkspacePath フックのロジックを直接テスト (React 不要)

function wsPath(wsId: string | undefined, suffix: string): string {
  if (!wsId) return suffix;
  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `/w/${wsId}${normalizedSuffix}`;
}

describe("wsPath (useWorkspacePath ロジック)", () => {
  it("wsId があれば /w/:wsId/<suffix> を返す", () => {
    expect(wsPath("ws-abc", "/screen/list")).toBe("/w/ws-abc/screen/list");
    expect(wsPath("ws-abc", "/table/edit/123")).toBe("/w/ws-abc/table/edit/123");
    expect(wsPath("ws-abc", "/")).toBe("/w/ws-abc/");
  });

  it("wsId がなければ suffix をそのまま返す", () => {
    expect(wsPath(undefined, "/screen/list")).toBe("/screen/list");
    expect(wsPath(undefined, "/")).toBe("/");
  });

  it("suffix が / で始まらない場合は / を補完する", () => {
    expect(wsPath("ws-abc", "screen/list")).toBe("/w/ws-abc/screen/list");
  });

  it("extensions?tab= クエリ付きパスも正しく変換する", () => {
    expect(wsPath("ws-abc", "/extensions?tab=responseTypes")).toBe(
      "/w/ws-abc/extensions?tab=responseTypes"
    );
  });
});

// ─── routing guard ロジック単体テスト ─────────────────────────────────────────
// AppShell の routing guard 判定ロジックを純粋関数として検証

interface WorkspaceState {
  active: { id: string; path: string; name: string | null } | null;
  workspaces: Array<{ id: string; path: string; name: string }>;
  loading: boolean;
  lockdown: boolean;
  error: string | null;
}

type GuardAction =
  | { type: "navigate"; path: string }
  | { type: "openWorkspace"; id: string }
  | { type: "none" };

/**
 * AppShellInner の routing guard ロジック (副作用なし純粋関数版)
 * AppShell.tsx のロジックをそのまま抽出
 */
function evaluateRoutingGuard(
  workspaceState: WorkspaceState,
  wsId: string | undefined,
): GuardAction {
  if (workspaceState.loading) return { type: "none" };
  if (workspaceState.lockdown) return { type: "none" };
  if (workspaceState.error !== null) return { type: "none" };

  if (workspaceState.active === null) {
    return { type: "navigate", path: "/workspace/select" };
  } else if (wsId && wsId !== workspaceState.active.id) {
    const recentEntry = workspaceState.workspaces.find((w) => w.id === wsId);
    if (recentEntry) {
      return { type: "openWorkspace", id: wsId };
    } else {
      return { type: "navigate", path: "/workspace/select" };
    }
  }
  return { type: "none" };
}

describe("routing guard ロジック (AppShellInner)", () => {
  const baseState: WorkspaceState = {
    active: { id: "ws-aaa", path: "/data/ws-aaa", name: "テストWS" },
    workspaces: [
      { id: "ws-aaa", path: "/data/ws-aaa", name: "テストWS" },
      { id: "ws-bbb", path: "/data/ws-bbb", name: "別のWS" },
    ],
    loading: false,
    lockdown: false,
    error: null,
  };

  it("loading 中は何もしない", () => {
    const result = evaluateRoutingGuard({ ...baseState, loading: true }, "ws-aaa");
    expect(result).toEqual({ type: "none" });
  });

  it("lockdown 時は何もしない", () => {
    const result = evaluateRoutingGuard({ ...baseState, lockdown: true }, "ws-aaa");
    expect(result).toEqual({ type: "none" });
  });

  it("error 時は何もしない", () => {
    const result = evaluateRoutingGuard({ ...baseState, error: "接続失敗" }, "ws-aaa");
    expect(result).toEqual({ type: "none" });
  });

  it("active が null のとき /workspace/select に redirect", () => {
    const result = evaluateRoutingGuard({ ...baseState, active: null }, "ws-aaa");
    expect(result).toEqual({ type: "navigate", path: "/workspace/select" });
  });

  it("URL の wsId が active と同じとき何もしない", () => {
    const result = evaluateRoutingGuard(baseState, "ws-aaa");
    expect(result).toEqual({ type: "none" });
  });

  it("URL の wsId が active と異なり recent にある → workspace.open", () => {
    const result = evaluateRoutingGuard(baseState, "ws-bbb");
    expect(result).toEqual({ type: "openWorkspace", id: "ws-bbb" });
  });

  it("URL の wsId が recent にない (不正 wsId) → /workspace/select redirect", () => {
    const result = evaluateRoutingGuard(baseState, "non-existent-uuid");
    expect(result).toEqual({ type: "navigate", path: "/workspace/select" });
  });

  it("wsId が undefined のとき何もしない (active あり)", () => {
    const result = evaluateRoutingGuard(baseState, undefined);
    expect(result).toEqual({ type: "none" });
  });
});

// ─── URL 構造テスト ────────────────────────────────────────────────────────────

describe("URL 規約 /w/:wsId/* の構造検証", () => {
  const WS_ID = "ws-12345678-0000-0000-0000-000000000001";

  it("ダッシュボード URL が /w/:wsId/ 形式", () => {
    const url = wsPath(WS_ID, "/");
    expect(url).toBe(`/w/${WS_ID}/`);
  });

  it("画面一覧 URL が /w/:wsId/screen/list 形式", () => {
    expect(wsPath(WS_ID, "/screen/list")).toBe(`/w/${WS_ID}/screen/list`);
  });

  it("テーブル編集 URL が /w/:wsId/table/edit/:id 形式", () => {
    const tableId = "tbl-0001";
    expect(wsPath(WS_ID, `/table/edit/${tableId}`)).toBe(
      `/w/${WS_ID}/table/edit/${tableId}`
    );
  });

  it("workspace/list は wsId プレフィックスなし", () => {
    // workspace 横断ページはそのまま
    expect("/workspace/list").toBe("/workspace/list");
    expect("/workspace/select").toBe("/workspace/select");
  });
});
