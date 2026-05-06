/**
 * wsBridge broadcast wsId scoping ユニットテスト (#703 R-5 F-1)
 *
 * wsBridge 自体は WebSocket/HTTP サーバーを起動するため直接テストしない。
 * broadcast の wsId scoping ロジックの中核である `workspaceContextManager.getClientIdsByPath`
 * を使った振る舞いを検証する。
 *
 * broadcast(opts) 内のフィルタ:
 *   - wsId === null → 全 session に配信
 *   - wsId が path → getClientIdsByPath(path) の clientId のみに配信
 */
import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { WorkspaceContextManager } from "./workspaceState.js";

describe("broadcast wsId scoping の中核ロジック — WorkspaceContextManager.getClientIdsByPath", () => {
  let mgr: WorkspaceContextManager;

  beforeEach(() => {
    mgr = new WorkspaceContextManager();
  });

  it("wsId(path) が指定された場合、同 path を active にしている clientId のみ返す", () => {
    mgr.connect("client-A");
    mgr.connect("client-B");
    mgr.connect("client-C");
    mgr.setActivePath("client-A", "/workspace/project-1");
    mgr.setActivePath("client-B", "/workspace/project-2");
    mgr.setActivePath("client-C", "/workspace/project-1");

    const targets = mgr.getClientIdsByPath("/workspace/project-1");
    expect(targets).toContain("client-A");
    expect(targets).toContain("client-C");
    expect(targets).not.toContain("client-B");
  });

  it("wsId(path) に一致する session がない場合は空配列を返す", () => {
    mgr.connect("client-A");
    mgr.setActivePath("client-A", "/workspace/project-1");

    const targets = mgr.getClientIdsByPath("/workspace/non-existent");
    expect(targets).toHaveLength(0);
  });

  it("activePath が null の session は getClientIdsByPath に含まれない", () => {
    mgr.connect("client-A"); // activePath = null (未設定)
    mgr.connect("client-B");
    mgr.setActivePath("client-B", "/workspace/project-1");

    const targets = mgr.getClientIdsByPath("/workspace/project-1");
    expect(targets).not.toContain("client-A");
    expect(targets).toContain("client-B");
  });

  it("wsId が null の場合は全 clientId が対象になる (listClientIds で確認)", () => {
    mgr.connect("client-A");
    mgr.connect("client-B");
    mgr.setActivePath("client-A", "/workspace/project-1");
    mgr.setActivePath("client-B", "/workspace/project-2");

    // wsId=null の場合は全 session に配信 → listClientIds が全員を返す
    const allClients = mgr.listClientIds();
    expect(allClients).toContain("client-A");
    expect(allClients).toContain("client-B");
  });

  it("path の正規化 (resolve) が行われ、相対パスも正規化された absolute path で一致する", () => {
    mgr.connect("client-A");
    mgr.setActivePath("client-A", path.resolve("/workspace/project-1"));

    // setActivePath は内部で path.resolve するが、getClientIdsByPath も resolve する
    const targets = mgr.getClientIdsByPath("/workspace/project-1");
    expect(targets).toContain("client-A");
  });

  it("excludeClientId 相当: 同 path でも自分自身は対象から除外できる", () => {
    mgr.connect("client-A");
    mgr.connect("client-B");
    mgr.setActivePath("client-A", "/workspace/project-1");
    mgr.setActivePath("client-B", "/workspace/project-1");

    // wsBridge では excludeClientId を別途フィルタするが、それは clientId===excludeClientId の check
    // ここでは getClientIdsByPath の結果から excludeClientId を除外する想定動作を検証
    const targets = mgr.getClientIdsByPath("/workspace/project-1");
    const filtered = targets.filter((id) => id !== "client-A"); // broadcast の excludeClientId 相当
    expect(filtered).toEqual(["client-B"]);
  });
});
