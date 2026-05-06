import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useResourceEditor } from "./useResourceEditor";
import { _resetForTests as resetTabs, getTabs, openTab, makeTabId } from "../store/tabStore";
import { saveDraft, loadDraft, hasDraft } from "../utils/draftStorage";
import { setLastSeenMtime } from "../utils/serverMtime";

// ── mcpBridge を stub ─────────────────────────────────────────────────────────
vi.mock("../mcp/mcpBridge", () => {
  type BroadcastHandler = (data: unknown) => void;
  const handlers = new Map<string, Set<BroadcastHandler>>();
  const statusCallbacks = new Set<(s: string) => void>();
  return {
    mcpBridge: {
      onBroadcast(event: string, handler: BroadcastHandler) {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(handler);
        return () => handlers.get(event)?.delete(handler);
      },
      onStatusChange(cb: (s: string) => void) {
        statusCallbacks.add(cb);
        cb("disconnected");
        return () => statusCallbacks.delete(cb);
      },
      request: async () => ({ mtime: null }),
      _emit(event: string, data: unknown) {
        handlers.get(event)?.forEach((h) => h(data));
      },
    },
  };
});

// エミッタに触るためのヘルパー
async function emitBroadcast(event: string, data: unknown) {
  const m = await import("../mcp/mcpBridge");
  (m.mcpBridge as unknown as { _emit: (e: string, d: unknown) => void })._emit(event, data);
}

interface TestData {
  id: string;
  name: string;
  count: number;
}

function setup(overrides: {
  id?: string | undefined;
  load?: (id: string) => Promise<TestData | null>;
  save?: (data: TestData) => Promise<void>;
  onNotFound?: () => void;
  onLoaded?: (data: TestData) => void;
  broadcastName?: string;
  autoReloadOnClean?: boolean;
} = {}) {
  const load = overrides.load ?? vi.fn(async (id: string) => ({ id, name: "initial", count: 0 }));
  const save = overrides.save ?? vi.fn(async () => { /* ok */ });
  const resolvedId = "id" in overrides ? overrides.id : "abc";
  const hook = renderHook(() =>
    useResourceEditor<TestData>({
      tabType: "table",
      mtimeKind: "table",
      draftKind: "table",
      id: resolvedId,
      load,
      save,
      broadcastName: overrides.broadcastName ?? "tableChanged",
      broadcastIdField: "id",
      onNotFound: overrides.onNotFound,
      onLoaded: overrides.onLoaded,
      autoReloadOnClean: overrides.autoReloadOnClean,
      enableUndoKeyboard: false, // テスト中のキーバインド無効化
    }),
  );
  return { hook, load, save };
}

beforeEach(() => {
  resetTabs();
  localStorage.clear();
  // tabStore.setDirty の副作用を観測するために、事前にタブを開いておく
  openTab({ id: makeTabId("table", "abc"), type: "table", resourceId: "abc", label: "テスト" });
});

// ── 初回ロード ───────────────────────────────────────────────────────────────

describe("useResourceEditor: 初回ロード", () => {
  it("draft が無ければ backend のデータをロードして isDirty=false", async () => {
    const { hook, load } = setup();
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    expect(hook.result.current.state).toEqual({ id: "abc", name: "initial", count: 0 });
    expect(hook.result.current.isDirty).toBe(false);
    expect(load).toHaveBeenCalledWith("abc");
  });

  it("draft があれば draft を優先して isDirty=true", async () => {
    saveDraft("table", "abc", { id: "abc", name: "drafted", count: 99 });
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    expect(hook.result.current.state).toEqual({ id: "abc", name: "drafted", count: 99 });
    expect(hook.result.current.isDirty).toBe(true);
  });

  it("load が null を返したら onNotFound を呼ぶ", async () => {
    const onNotFound = vi.fn();
    setup({ load: async () => null, onNotFound });
    await waitFor(() => expect(onNotFound).toHaveBeenCalledTimes(1));
  });

  it("onLoaded は draft 有無に関わらず backend データで呼ばれる", async () => {
    const onLoaded = vi.fn();
    saveDraft("table", "abc", { id: "abc", name: "drafted", count: 99 });
    setup({ onLoaded });
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith({ id: "abc", name: "initial", count: 0 }));
  });

  it("id が undefined の間はロードしない", async () => {
    const load = vi.fn();
    setup({ id: undefined, load });
    // 少し待ってから呼ばれていないことを確認
    await new Promise((r) => setTimeout(r, 30));
    expect(load).not.toHaveBeenCalled();
  });
});

// ── update / updateSilent / dirty 追跡 ────────────────────────────────────────

describe("useResourceEditor: update / dirty 追跡", () => {
  it("update で draft が保存され isDirty=true、タブも dirty", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());

    act(() => hook.result.current.update((d) => { d.name = "changed"; }));

    expect(hook.result.current.state?.name).toBe("changed");
    expect(hook.result.current.isDirty).toBe(true);
    expect(loadDraft<TestData>("table", "abc")?.name).toBe("changed");
    expect(getTabs().find((t) => t.id === makeTabId("table", "abc"))?.isDirty).toBe(true);
  });

  it("updateSilent も draft 保存 + dirty 立てるが undo に積まない", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    expect(hook.result.current.canUndo).toBe(false);

    act(() => hook.result.current.updateSilent((d) => { d.name = "silent"; }));

    expect(hook.result.current.state?.name).toBe("silent");
    expect(hook.result.current.isDirty).toBe(true);
    expect(hook.result.current.canUndo).toBe(false); // undo 履歴には積まれない
    expect(loadDraft<TestData>("table", "abc")?.name).toBe("silent");
  });
});

// ── handleSave ───────────────────────────────────────────────────────────────

describe("useResourceEditor: handleSave", () => {
  it("保存成功で draft 削除・isDirty=false・タブ clean", async () => {
    const { hook, save } = setup();
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    act(() => hook.result.current.update((d) => { d.name = "changed"; }));
    expect(hook.result.current.isDirty).toBe(true);

    await act(async () => { await hook.result.current.handleSave(); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "changed" }));
    expect(hook.result.current.isDirty).toBe(false);
    expect(hasDraft("table", "abc")).toBe(false);
    expect(getTabs().find((t) => t.id === makeTabId("table", "abc"))?.isDirty).toBe(false);
  });

  it("保存中は isSaving=true、完了後に false", async () => {
    let resolveSave: () => void = () => { /* noop */ };
    const save = vi.fn(() => new Promise<void>((res) => { resolveSave = res; }));
    const { hook } = setup({ save });
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    act(() => hook.result.current.update((d) => { d.name = "changed"; }));

    let savePromise: Promise<void> = Promise.resolve();
    act(() => { savePromise = hook.result.current.handleSave(); });
    await waitFor(() => expect(hook.result.current.isSaving).toBe(true));

    resolveSave();
    await act(async () => { await savePromise; });
    expect(hook.result.current.isSaving).toBe(false);
  });
});

// ── handleReset ──────────────────────────────────────────────────────────────

describe("useResourceEditor: handleReset", () => {
  it("リセットで draft 削除・backend から再ロード・isDirty=false", async () => {
    saveDraft("table", "abc", { id: "abc", name: "drafted", count: 99 });
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.isDirty).toBe(true));
    expect(hook.result.current.state?.name).toBe("drafted");

    await act(async () => { await hook.result.current.handleReset(); });

    expect(hook.result.current.state?.name).toBe("initial");
    expect(hook.result.current.isDirty).toBe(false);
    expect(hasDraft("table", "abc")).toBe(false);
    expect(getTabs().find((t) => t.id === makeTabId("table", "abc"))?.isDirty).toBe(false);
  });

  it("serverChanged もリセットでクリアされる", async () => {
    saveDraft("table", "abc", { id: "abc", name: "drafted", count: 99 });
    // サーバー mtime を古く設定して「更新あり」を検知させる
    setLastSeenMtime("table", "abc", 0);
    const { hook } = setup({
      load: async (id) => ({ id, name: "initial", count: 0 }),
    });
    // 初回ロード中に serverChanged を true にするため broadcast で誘発
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    await act(async () => emitBroadcast("tableChanged", { id: "abc" }));
    await waitFor(() => expect(hook.result.current.serverChanged).toBe(true));

    await act(async () => { await hook.result.current.handleReset(); });
    expect(hook.result.current.serverChanged).toBe(false);
  });
});

// ── broadcast 受信 ───────────────────────────────────────────────────────────

describe("useResourceEditor: broadcast", () => {
  it("dirty 中の broadcast は serverChanged=true", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    act(() => hook.result.current.update((d) => { d.name = "editing"; }));

    await act(async () => emitBroadcast("tableChanged", { id: "abc" }));
    await waitFor(() => expect(hook.result.current.serverChanged).toBe(true));
  });

  it("clean 中の broadcast は自動リロード（デフォルト）", async () => {
    let current = { id: "abc", name: "v1", count: 0 };
    const load = vi.fn(async () => current);
    const { hook } = setup({ load });
    await waitFor(() => expect(hook.result.current.state?.name).toBe("v1"));

    current = { id: "abc", name: "v2", count: 1 };
    await act(async () => emitBroadcast("tableChanged", { id: "abc" }));
    await waitFor(() => expect(hook.result.current.state?.name).toBe("v2"));
    expect(hook.result.current.serverChanged).toBe(false);
  });

  it("autoReloadOnClean=false のとき clean でも serverChanged=true", async () => {
    const { hook } = setup({ autoReloadOnClean: false });
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());

    await act(async () => emitBroadcast("tableChanged", { id: "abc" }));
    await waitFor(() => expect(hook.result.current.serverChanged).toBe(true));
  });

  it("自分以外の id の broadcast は無視", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());

    await act(async () => emitBroadcast("tableChanged", { id: "different" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(hook.result.current.serverChanged).toBe(false);
  });
});
