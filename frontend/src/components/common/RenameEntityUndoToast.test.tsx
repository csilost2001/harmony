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
import * as UndoToastModule from "./RenameEntityUndoToast";
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
    sessionStorage.setItem("harmony-rename-undo:table:renamed", JSON.stringify({
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
        useRenameEntityUndoToast?: (entityType: string, currentId: string) => readonly [
          { operationId: string; ttlMs?: number } | null,
          (value: unknown) => void,
        ];
      }
    ).useRenameEntityUndoToast;

    expect(useRenameEntityUndoToast).toBeTypeOf("function");
    const { result } = renderHook(() => useRenameEntityUndoToast!("table", "renamed"));

    await waitFor(() => expect(result.current[0]?.operationId).toBe("op-restored"));
    expect(result.current[0]?.ttlMs).toBe(245000);
    expect(mcpBridge.request).toHaveBeenCalledWith("listRecentUndoOperations", {});
  });
});
