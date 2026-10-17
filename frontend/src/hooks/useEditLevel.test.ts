import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditLevel } from "./useEditLevel";

describe("useEditLevel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'implementation' as the default level", () => {
    const { result } = renderHook(() => useEditLevel("flow-1"));
    expect(result.current.editLevel).toBe("implementation");
  });

  it("updates to 'rough' when setEditLevel is called", () => {
    const { result } = renderHook(() => useEditLevel("flow-1"));
    act(() => result.current.setEditLevel("rough"));
    expect(result.current.editLevel).toBe("rough");
  });

  it("updates to 'detail' when setEditLevel is called", () => {
    const { result } = renderHook(() => useEditLevel("flow-1"));
    act(() => result.current.setEditLevel("detail"));
    expect(result.current.editLevel).toBe("detail");
  });

  it("persists the level to localStorage with the correct key", () => {
    const { result } = renderHook(() => useEditLevel("flow-42"));
    act(() => result.current.setEditLevel("rough"));
    const stored = localStorage.getItem("processFlow:editLevel:flow-42");
    expect(stored).toBe('"rough"');
  });

  it("restores the level from localStorage on remount", () => {
    localStorage.setItem("processFlow:editLevel:flow-99", '"detail"');
    const { result } = renderHook(() => useEditLevel("flow-99"));
    expect(result.current.editLevel).toBe("detail");
  });

  it("falls back to 'implementation' if localStorage has an invalid value", () => {
    localStorage.setItem("processFlow:editLevel:flow-bad", '"invalid"');
    const { result } = renderHook(() => useEditLevel("flow-bad"));
    expect(result.current.editLevel).toBe("implementation");
  });

  it("works without a flowId (in-memory only, no localStorage write)", () => {
    const { result } = renderHook(() => useEditLevel());
    act(() => result.current.setEditLevel("detail"));
    expect(result.current.editLevel).toBe("detail");
    // editLevel 系の localStorage entry が 1 件もないこと (sentinel key も書かない)
    const allKeys = Object.keys(localStorage).filter((k) => k.startsWith("processFlow:editLevel:"));
    expect(allKeys).toHaveLength(0);
  });

  it("isolates levels between different flow IDs", () => {
    const { result: resultA } = renderHook(() => useEditLevel("flow-A"));
    const { result: resultB } = renderHook(() => useEditLevel("flow-B"));
    act(() => resultA.current.setEditLevel("rough"));
    act(() => resultB.current.setEditLevel("detail"));
    expect(resultA.current.editLevel).toBe("rough");
    expect(resultB.current.editLevel).toBe("detail");
  });

  it("does not bleed editLevel across flowId changes within the same hook instance (S-2 regression)", () => {
    // S-2: ProcessFlowEditor が React Router で別 flow に再利用された場合 (タブ切替) でも、
    // 旧 flowId の設定が新 flowId の localStorage に上書きされてはいけない。
    // 旧 flow-X の永続値は flow-X 側のみで保持し、新 flow-Y では flow-Y 永続値を再読込する。
    localStorage.setItem("processFlow:editLevel:flow-X", '"rough"');
    localStorage.setItem("processFlow:editLevel:flow-Y", '"detail"');

    const { result, rerender } = renderHook(({ flowId }) => useEditLevel(flowId), {
      initialProps: { flowId: "flow-X" as string | undefined },
    });
    expect(result.current.editLevel).toBe("rough");

    rerender({ flowId: "flow-Y" });
    expect(result.current.editLevel).toBe("detail");

    // 旧 flow-X の値が壊されていないこと (にじみがないこと)
    expect(localStorage.getItem("processFlow:editLevel:flow-X")).toBe('"rough"');
    expect(localStorage.getItem("processFlow:editLevel:flow-Y")).toBe('"detail"');
  });

  it("writes to the new flowId's storage when setEditLevel is called after flowId change", () => {
    localStorage.setItem("processFlow:editLevel:flow-X", '"rough"');
    const { result, rerender } = renderHook(({ flowId }) => useEditLevel(flowId), {
      initialProps: { flowId: "flow-X" as string | undefined },
    });
    rerender({ flowId: "flow-Y" });
    act(() => result.current.setEditLevel("rough"));
    // 新 flow-Y にのみ書き込まれ、flow-X は 'rough' (元) のまま、
    // flow-Y は新たに 'rough' で永続化される
    expect(localStorage.getItem("processFlow:editLevel:flow-X")).toBe('"rough"');
    expect(localStorage.getItem("processFlow:editLevel:flow-Y")).toBe('"rough"');
  });
});

describe("presetEditLevel (ISSUE #1528 f)", () => {
  it("覚えている深さが無い処理フローには、最初の深さを書く", async () => {
    const { presetEditLevel } = await import("./useEditLevel");
    window.localStorage.clear();
    presetEditLevel("new-flow", "rough");
    expect(JSON.parse(window.localStorage.getItem("processFlow:editLevel:new-flow") ?? "null")).toBe("rough");
  });
  it("すでに覚えている深さは、上書きしない", async () => {
    const { presetEditLevel } = await import("./useEditLevel");
    window.localStorage.setItem("processFlow:editLevel:old-flow", JSON.stringify("implementation"));
    presetEditLevel("old-flow", "rough");
    expect(JSON.parse(window.localStorage.getItem("processFlow:editLevel:old-flow") ?? "null")).toBe("implementation");
  });
});
