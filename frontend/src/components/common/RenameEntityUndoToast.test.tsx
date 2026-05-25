/**
 * RenameEntityUndoToast component test (Phase F S-1 regression, ISSUE #1298)。
 *
 * - undo RPC が呼ばれ、成功時に `onUndo` callback が走ること
 * - Phase F S-1: default `postUndoDelayMs = 0` で hard delay 無しでも動作 (backend が
 *   originating client にも broadcast reload を届ける handshake に変更されたため)
 * - error path: RPC fail で `onUndo` を呼ばず error state を保持
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, fireEvent, waitFor } from "@testing-library/react";
import * as UndoToastModule from "./useRenameEntityUndoToast";
import { RenameEntityUndoToast } from "./RenameEntityUndoToast";

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    request: vi.fn(),
  },
}));

import { mcpBridge } from "../../mcp/mcpBridge";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("RenameEntityUndoToast — Phase F S-1 (Codex 独立レビュー)", () => {
  it("undo ボタン押下で undoEntityRename RPC が呼ばれ、成功時に onUndo callback が走る", async () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ restoredFiles: 5 });

    render(
      <RenameEntityUndoToast
        operationId="op-1"
        oldId="old"
        newId="new"
        entityLabel="テーブル"
        onUndo={onUndo}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByTestId("rename-entity-undo-btn"));

    await waitFor(() => {
      expect(mcpBridge.request).toHaveBeenCalledWith("undoEntityRename", { operationId: "op-1" });
      expect(onUndo).toHaveBeenCalledTimes(1);
    });
  });

  it("workspace path は browser から undo RPC に送信しない", async () => {
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ restoredFiles: 1 });

    render(
      <RenameEntityUndoToast
        operationId="op-owned-by-server"
        oldId="old"
        newId="new"
        entityLabel="テーブル"
        onUndo={() => {}}
        onDismiss={() => {}}
        {...({ workspaceRoot: "/tmp/untrusted-client-root" } as Record<string, unknown>)}
      />,
    );

    fireEvent.click(screen.getByTestId("rename-entity-undo-btn"));
    await waitFor(() => {
      expect(mcpBridge.request).toHaveBeenCalledWith("undoEntityRename", {
        operationId: "op-owned-by-server",
      });
    });
  });

  it("default postUndoDelayMs=0 で hard delay なしに onUndo が即座に呼ばれる (S-1)", async () => {
    const onUndo = vi.fn();
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ restoredFiles: 3 });

    render(
      <RenameEntityUndoToast
        operationId="op-2"
        oldId="a"
        newId="b"
        entityLabel="X"
        onUndo={onUndo}
        onDismiss={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("rename-entity-undo-btn"));

    // delay 0 のため microtask flush で onUndo 到達する想定 (旧 300ms default なら fail)
    const start = Date.now();
    await waitFor(() => {
      expect(onUndo).toHaveBeenCalled();
    }, { timeout: 1000 });
    const elapsed = Date.now() - start;
    // 200ms 未満で完了 (旧 300ms hard delay なら必ず 300ms 超のため明確に区別可)
    expect(elapsed).toBeLessThan(200);
  });

  it("postUndoDelayMs を明示指定すれば backward compat で delay 適用される", async () => {
    const onUndo = vi.fn();
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ restoredFiles: 1 });

    render(
      <RenameEntityUndoToast
        operationId="op-3"
        oldId="a"
        newId="b"
        entityLabel="X"
        onUndo={onUndo}
        onDismiss={() => {}}
        postUndoDelayMs={100}
      />,
    );

    const start = Date.now();
    fireEvent.click(screen.getByTestId("rename-entity-undo-btn"));
    await waitFor(() => {
      expect(onUndo).toHaveBeenCalled();
    });
    const elapsed = Date.now() - start;
    // 100ms 以上経過 (test infra jitter で多少超過 OK)
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it("undo RPC が fail した場合は onUndo を呼ばず error state を表示", async () => {
    const onUndo = vi.fn();
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("backend error"));

    render(
      <RenameEntityUndoToast
        operationId="op-fail"
        oldId="x"
        newId="y"
        entityLabel="View"
        onUndo={onUndo}
        onDismiss={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("rename-entity-undo-btn"));

    await waitFor(() => {
      expect(screen.getByText(/undo 失敗/)).toBeInTheDocument();
    });
    expect(onUndo).not.toHaveBeenCalled();
  });
});

describe("useRenameEntityUndoToast — Phase L SF-R7-1 operation restoration", () => {
  it("sessionStorage metadata を server の TTL 内 operation と照合して mount 時に復元する", async () => {
    // wsId が含まれる新 key 形式 (Phase M SF-1 — workspace scope)
    sessionStorage.setItem("harmony-rename-undo:ws-1:table:renamed", JSON.stringify({
      operationId: "op-restored",
      oldId: "old",
      newId: "renamed",
      ttlMs: 300000,
    }));
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      operationId: "op-restored",
      entityType: "table",
      oldId: "old",
      newId: "renamed",
      remainingTtlMs: 245000,
    }]);
    const useRenameEntityUndoToast = (
      UndoToastModule as unknown as {
        useRenameEntityUndoToast?: (
          entityType: string,
          currentId: string,
          wsId?: string,
        ) => readonly [
          { operationId: string; ttlMs?: number } | null,
          (value: unknown) => void,
        ];
      }
    ).useRenameEntityUndoToast;

    expect(useRenameEntityUndoToast).toBeTypeOf("function");
    const { result } = renderHook(() => useRenameEntityUndoToast!("table", "renamed", "ws-1"));

    await waitFor(() => expect(result.current[0]?.operationId).toBe("op-restored"));
    expect(result.current[0]?.ttlMs).toBe(245000);
    expect(mcpBridge.request).toHaveBeenCalledWith("listRecentUndoOperations", {});
  });
});

describe("useRenameEntityUndoToast — Phase M SF-1 workspace scoping (Codex round 8)", () => {
  it("wsId 別の同名 entity の sessionStorage key は混ざらず、別 workspace の hook mount が他 workspace の metadata を削除しない", async () => {
    // ws-A で table:items を rename した状態の metadata を sessionStorage に格納 (wsId scoped key)
    sessionStorage.setItem("harmony-rename-undo:ws-A:table:items", JSON.stringify({
      operationId: "op-A",
      oldId: "products",
      newId: "items",
      ttlMs: 300000,
    }));

    // ws-B で同名 entity "items" の editor を開く (B には rename operation がない → server は空配列)
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const useRenameEntityUndoToast = (
      UndoToastModule as unknown as {
        useRenameEntityUndoToast?: (
          entityType: string,
          currentId: string,
          wsId?: string,
        ) => readonly [
          { operationId: string; ttlMs?: number } | null,
          (value: unknown) => void,
        ];
      }
    ).useRenameEntityUndoToast;

    expect(useRenameEntityUndoToast).toBeTypeOf("function");
    const { result } = renderHook(() => useRenameEntityUndoToast!("table", "items", "ws-B"));

    // ws-B の hook は ws-A の metadata を read / remove してはならない
    // (key が wsId scoped であれば ws-B は "harmony-rename-undo:ws-B:table:items" を見るため、ws-A 側は無関係)
    await waitFor(() => {
      // hook が無事 settle する (timeout error がない)
      expect(result.current[0]).toBeNull();
    });

    // ws-A 側 metadata は preserved
    expect(sessionStorage.getItem("harmony-rename-undo:ws-A:table:items")).not.toBeNull();
  });
});
