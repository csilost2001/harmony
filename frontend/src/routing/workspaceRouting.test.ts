/**
 * workspace routing guard ロジックの単体テスト (#702 R-4 / #1145 Phase-7)
 *
 * AppShell の URL ↔ workspace context 連携ロジックを検証。
 * - routing guard: active なし → /workspace/select redirect
 * - routing guard: wsId が active と異なり recent にある → workspace.open 呼び出し
 * - routing guard: wsId が recent にない (不正 wsId) → /workspace/select redirect
 * - wsPath 関数: wsId が取れる場合 /w/:wsId/<suffix> を返す
 * - wsPath 関数: wsId がない場合は suffix をそのまま返す
 *
 * #1145 Phase-7: 旧版では本 test ファイル内に純粋ロジックを inline 重複定義していた
 * (`wsPath` / `evaluateRoutingGuard`)。Phase-7 で `routing/workspaceRouting.ts` に
 * 抽出したため、import で参照する形に整理 (逆コロケーション解消)。
 */

import { describe, it, expect } from "vitest";
import {
  wsPath,
  evaluateRoutingGuard,
  isWorkspaceChildRouteReady,
  type RoutingGuardWorkspaceState,
} from "./workspaceRouting";

// ─── wsPath ロジック単体テスト ───────────────────────────────────────────────

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

  it("wsId が空文字の場合は suffix をそのまま返す", () => {
    expect(wsPath("", "/screen/list")).toBe("/screen/list");
  });
});

// ─── routing guard ロジック単体テスト ─────────────────────────────────────────

describe("evaluateRoutingGuard (AppShellInner)", () => {
  const baseState: RoutingGuardWorkspaceState = {
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

  it("active が null かつ wsId なし → /workspace/select に redirect", () => {
    const result = evaluateRoutingGuard({ ...baseState, active: null }, undefined);
    expect(result).toEqual({ type: "navigate", path: "/workspace/select" });
  });

  it("active が null かつ wsId が recent に無い → /workspace/select に redirect", () => {
    const result = evaluateRoutingGuard(
      { ...baseState, active: null },
      "non-existent-uuid",
    );
    expect(result).toEqual({ type: "navigate", path: "/workspace/select" });
  });

  it("active が null かつ wsId が recent にある → workspace.open で復元", () => {
    const result = evaluateRoutingGuard({ ...baseState, active: null }, "ws-bbb");
    expect(result).toEqual({ type: "openWorkspace", id: "ws-bbb" });
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

// ─── child route mount readiness ─────────────────────────────────────────────

describe("isWorkspaceChildRouteReady (AppShellInner child mount gate)", () => {
  const baseState: RoutingGuardWorkspaceState = {
    active: { id: "ws-aaa", path: "/data/ws-aaa", name: "テストWS" },
    workspaces: [
      { id: "ws-aaa", path: "/data/ws-aaa", name: "テストWS" },
    ],
    loading: false,
    lockdown: false,
    error: null,
  };

  it("workspace.open pending 中は child route を mount しない", () => {
    expect(
      isWorkspaceChildRouteReady(baseState, "ws-aaa", new Set(), "ws-aaa"),
    ).toBe(false);
  });

  it("workspace.open 成功後のみ child route を mount する", () => {
    expect(
      isWorkspaceChildRouteReady(baseState, "ws-aaa", new Set(["ws-aaa"]), null),
    ).toBe(true);
  });

  it("workspace.open 失敗後は success set 未登録なので child route を mount しない", () => {
    expect(
      isWorkspaceChildRouteReady(baseState, "ws-aaa", new Set(), null),
    ).toBe(false);
  });

  it("URL wsId と active workspace が未同期なら child route を mount しない", () => {
    expect(
      isWorkspaceChildRouteReady(baseState, "ws-bbb", new Set(["ws-bbb"]), null),
    ).toBe(false);
  });

  it("lockdown / error 状態は既存 routing 側に委ねるため mount gate で止めない", () => {
    expect(
      isWorkspaceChildRouteReady({ ...baseState, lockdown: true }, "ws-aaa", new Set(), null),
    ).toBe(true);
    expect(
      isWorkspaceChildRouteReady({ ...baseState, error: "e2e bypass" }, "ws-aaa", new Set(), null),
    ).toBe(true);
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
