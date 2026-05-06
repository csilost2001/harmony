import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useFlowProjectSync } from "./useFlowProjectSync";
import {
  removeScreen,
  removeEdge as storeRemoveEdge,
  removeGroup as storeRemoveGroup,
} from "../store/flowStore";
import type { FlowProject } from "../types/flow";

vi.mock("../mcp/mcpBridge", () => {
  type BroadcastHandler = (data: unknown) => void;
  type StatusHandler = (s: string) => void;
  const handlers = new Map<string, Set<BroadcastHandler>>();
  const statusCallbacks = new Set<StatusHandler>();
  return {
    mcpBridge: {
      onBroadcast(event: string, handler: BroadcastHandler) {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(handler);
        return () => handlers.get(event)?.delete(handler);
      },
      onStatusChange(cb: StatusHandler) {
        statusCallbacks.add(cb);
        cb("disconnected");
        return () => statusCallbacks.delete(cb);
      },
      setFlowChangeHandler: vi.fn(),
      setNavigateHandler: vi.fn(),
      startWithoutEditor: vi.fn(),
      request: async () => ({ mtime: null }),
      _emit(event: string, data: unknown) {
        handlers.get(event)?.forEach((h) => h(data));
      },
      _emitStatus(status: string) {
        statusCallbacks.forEach((h) => h(status));
      },
    },
  };
});

async function emitBroadcast(event: string, data: unknown) {
  const m = await import("../mcp/mcpBridge");
  (m.mcpBridge as unknown as { _emit: (e: string, d: unknown) => void })._emit(event, data);
}

async function emitStatus(status: string) {
  const m = await import("../mcp/mcpBridge");
  (m.mcpBridge as unknown as { _emitStatus: (s: string) => void })._emitStatus(status);
}

function setup(
  isDirtyRef = { current: false },
  options: { navigate?: (path: string) => void } = {},
) {
  const reload = vi.fn(async () => undefined);
  const hook = renderHook(() =>
    useFlowProjectSync({ reload, isDirtyRef, navigate: options.navigate }),
  );
  return { hook, reload, isDirtyRef };
}

async function waitForInitialLoad(reload: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  reload.mockClear();
}

function createProject(): FlowProject {
  const now = "2026-04-29T00:00:00.000Z";
  return {
    version: 1,
    name: "test",
    screens: [
      {
        id: "screen-a",
        no: 1,
        name: "A",
        kind: "other",
        description: "",
        path: "/a",
        position: { x: 0, y: 0 },
        size: { width: 200, height: 100 },
        hasDesign: false,
        groupId: "group-a",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "screen-b",
        no: 2,
        name: "B",
        kind: "other",
        description: "",
        path: "/b",
        position: { x: 240, y: 0 },
        size: { width: 200, height: 100 },
        hasDesign: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    edges: [
      {
        id: "edge-a",
        source: "screen-a",
        target: "screen-b",
        label: "",
        trigger: "click",
      },
    ],
    groups: [
      {
        id: "group-a",
        name: "Group",
        position: { x: 0, y: 0 },
        size: { width: 360, height: 280 },
        createdAt: now,
        updatedAt: now,
      },
    ],
    updatedAt: now,
  } as FlowProject;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("broadcast received while dirty - shows banner, does not reload", () => {
  it("sets serverChanged without reload", async () => {
    const { hook, reload, isDirtyRef } = setup({ current: true });
    await waitForInitialLoad(reload);

    await act(async () => emitBroadcast("projectChanged", {}));

    await waitFor(() => expect(hook.result.current.serverChanged).toBe(true));
    expect(isDirtyRef.current).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("broadcast received while clean - auto reloads", () => {
  it("reloads and keeps banner hidden", async () => {
    const { hook, reload } = setup({ current: false });
    await waitForInitialLoad(reload);

    await act(async () => emitBroadcast("projectChanged", {}));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(hook.result.current.serverChanged).toBe(false);
  });
});

describe("MCP reconnect while dirty - shows banner, does not reload", () => {
  it("sets serverChanged without reload", async () => {
    const { hook, reload, isDirtyRef } = setup({ current: true });
    await waitForInitialLoad(reload);

    await act(async () => emitStatus("connected"));

    await waitFor(() => expect(hook.result.current.serverChanged).toBe(true));
    expect(isDirtyRef.current).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("MCP reconnect while clean - auto reloads", () => {
  it("reloads", async () => {
    const { reload } = setup({ current: false });
    await waitForInitialLoad(reload);

    await act(async () => emitStatus("connected"));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});

describe("delete operations mark dirty via flowDraft saves", () => {
  it("storeRemoveEdge flips isDirtyRef from false to true", async () => {
    const { reload, isDirtyRef } = setup({ current: false });
    await waitForInitialLoad(reload);
    expect(isDirtyRef.current).toBe(false);

    const project = createProject();
    await act(async () => {
      await storeRemoveEdge(project, "edge-a");
    });

    expect(isDirtyRef.current).toBe(true);
  });

  it("storeRemoveGroup flips isDirtyRef from false to true", async () => {
    const { reload, isDirtyRef } = setup({ current: false });
    await waitForInitialLoad(reload);
    expect(isDirtyRef.current).toBe(false);

    const project = createProject();
    await act(async () => {
      await storeRemoveGroup(project, "group-a");
    });

    expect(isDirtyRef.current).toBe(true);
  });

  it("removeScreen flips isDirtyRef from false to true", async () => {
    const { reload, isDirtyRef } = setup({ current: false });
    await waitForInitialLoad(reload);
    expect(isDirtyRef.current).toBe(false);

    const project = createProject();
    await act(async () => {
      await removeScreen(project, "screen-b");
    });

    expect(isDirtyRef.current).toBe(true);
  });
});

describe("cleanup behavior", () => {
  it("startWithoutEditor is invoked exactly once per mount", async () => {
    const { reload } = setup();
    await waitForInitialLoad(reload);

    const m = await import("../mcp/mcpBridge");
    expect(m.mcpBridge.startWithoutEditor).toHaveBeenCalledTimes(1);
  });

  it("setFlowChangeHandler is reset to null on unmount", async () => {
    const { hook, reload } = setup();
    await waitForInitialLoad(reload);

    const m = await import("../mcp/mcpBridge");
    const setFlowChangeHandler = m.mcpBridge.setFlowChangeHandler as ReturnType<typeof vi.fn>;
    expect(setFlowChangeHandler).toHaveBeenLastCalledWith(expect.any(Function));

    hook.unmount();

    expect(setFlowChangeHandler).toHaveBeenLastCalledWith(null);
  });

  it("setNavigateHandler is reset to null on unmount when navigate was provided", async () => {
    const navigate = vi.fn();
    const { hook, reload } = setup({ current: false }, { navigate });
    await waitForInitialLoad(reload);

    const m = await import("../mcp/mcpBridge");
    const setNavigateHandler = m.mcpBridge.setNavigateHandler as ReturnType<typeof vi.fn>;
    expect(setNavigateHandler).toHaveBeenLastCalledWith(expect.any(Function));

    hook.unmount();

    expect(setNavigateHandler).toHaveBeenLastCalledWith(null);
  });

  it("broadcast and status events after unmount do not trigger reload or banner", async () => {
    const { hook, reload } = setup({ current: false });
    await waitForInitialLoad(reload);

    hook.unmount();

    await act(async () => emitBroadcast("projectChanged", {}));
    await act(async () => emitStatus("connected"));

    expect(reload).not.toHaveBeenCalled();
  });
});
