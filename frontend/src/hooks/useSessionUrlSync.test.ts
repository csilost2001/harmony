/**
 * useSessionUrlSync.test.ts (#902 Phase 5)
 * URL 解釈 / replaceState 呼び出しを検証する。
 * spec docs/spec/edit-session-protocol.md §11.2 に準拠。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionUrlSync } from "./useSessionUrlSync";

// ── history.replaceState をモック ─────────────────────────────────────────

const mockReplaceState = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // window.location を空にリセット
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, search: "", href: "http://localhost/" },
  });
  Object.defineProperty(window, "history", {
    writable: true,
    value: { replaceState: mockReplaceState },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSessionUrlSync (Phase 5 — editSession ベース)", () => {
  it("URL に ?session= がない場合は initialEditSessionId が undefined", () => {
    const { result } = renderHook(() =>
      useSessionUrlSync({ resourceType: "process-flow", resourceId: "flow-001" }),
    );
    expect(result.current.initialEditSessionId).toBeUndefined();
  });

  it("URL に ?session=<editSessionId> がある場合は initialEditSessionId を返す", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: {
        ...window.location,
        search: "?session=es-abc-123",
        href: "http://localhost/process-flow/edit/flow-001?session=es-abc-123",
      },
    });

    const { result } = renderHook(() =>
      useSessionUrlSync({
        resourceType: "process-flow",
        resourceId: "flow-001",
      }),
    );

    expect(result.current.initialEditSessionId).toBe("es-abc-123");
  });

  it("syncSessionToUrl は history.replaceState を呼ぶ", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: {
        ...window.location,
        search: "",
        href: "http://localhost/process-flow/edit/flow-001",
      },
    });

    const { result } = renderHook(() =>
      useSessionUrlSync({ resourceType: "process-flow", resourceId: "flow-001" }),
    );

    result.current.syncSessionToUrl("session-xyz");

    expect(mockReplaceState).toHaveBeenCalledOnce();
    const calledUrl = mockReplaceState.mock.calls[0][2] as string;
    expect(calledUrl).toContain("session=session-xyz");
  });

  it("syncSessionToUrl は既存 ?session= を上書きする", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: {
        ...window.location,
        search: "?session=old-session",
        href: "http://localhost/process-flow/edit/flow-001?session=old-session",
      },
    });

    const { result } = renderHook(() =>
      useSessionUrlSync({ resourceType: "process-flow", resourceId: "flow-001" }),
    );

    result.current.syncSessionToUrl("new-session");

    expect(mockReplaceState).toHaveBeenCalledOnce();
    const calledUrl = mockReplaceState.mock.calls[0][2] as string;
    expect(calledUrl).toContain("session=new-session");
    expect(calledUrl).not.toContain("session=old-session");
  });

  it("clearSessionFromUrl は ?session= を削除した URL で replaceState を呼ぶ", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: {
        ...window.location,
        search: "?session=session-abc",
        href: "http://localhost/process-flow/edit/flow-001?session=session-abc",
      },
    });

    const { result } = renderHook(() =>
      useSessionUrlSync({ resourceType: "process-flow", resourceId: "flow-001" }),
    );

    result.current.clearSessionFromUrl();

    expect(mockReplaceState).toHaveBeenCalled();
    const calledUrl = mockReplaceState.mock.calls[0][2] as string;
    expect(calledUrl).not.toContain("session=");
  });

  it("syncSessionToUrl は onViewerAttached (後方互換) を呼ぶ", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: {
        ...window.location,
        search: "",
        href: "http://localhost/table/edit/tbl-001",
      },
    });

    const onViewerAttached = vi.fn();
    const { result } = renderHook(() =>
      useSessionUrlSync({
        resourceType: "table",
        resourceId: "tbl-001",
        onViewerAttached,
      }),
    );

    result.current.syncSessionToUrl("es-viewer-123");
    expect(onViewerAttached).toHaveBeenCalledWith("es-viewer-123");
  });
});
