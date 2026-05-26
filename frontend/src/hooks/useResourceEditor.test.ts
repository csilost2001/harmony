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

  // Phase G S-1 (#1298 Codex round 2): rename / undo の `{ reload: true }` broadcast を
  // id filter で reject せず全件 invalidation として処理する
  it("Phase G S-1: { reload: true } broadcast は id filter を通過して reload を発火する (clean 時)", async () => {
    let current = { id: "abc", name: "before-rename", count: 0 };
    const load = vi.fn(async () => current);
    const { hook } = setup({ load });
    await waitFor(() => expect(hook.result.current.state?.name).toBe("before-rename"));

    // rename event の broadcast を模す: payload は id field 無し、reload: true のみ
    current = { id: "abc", name: "after-rename", count: 1 };
    await act(async () => emitBroadcast("tableChanged", { reload: true }));
    await waitFor(() => expect(hook.result.current.state?.name).toBe("after-rename"));
    expect(hook.result.current.serverChanged).toBe(false);
  });

  it("Phase G S-1: { reload: true } broadcast は dirty 時に serverChanged=true を立てる", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    act(() => hook.result.current.update((d) => { d.name = "user-editing"; }));
    expect(hook.result.current.isDirty).toBe(true);

    await act(async () => emitBroadcast("tableChanged", { reload: true }));
    await waitFor(() => expect(hook.result.current.serverChanged).toBe(true));
    // dirty 中の自動 reload は走らないので state は維持
    expect(hook.result.current.state?.name).toBe("user-editing");
  });
});

// ── P1-B 順序回帰: actions.save (conflict check) → postSave (dirty クリア) (#908) ──────

describe("useResourceEditor: P1-B save 順序回帰 (#908)", () => {
  it("conflict check が postSave より先に呼ばれれば postSave は書き込みを行わない", async () => {
    // 旧実装では resourceHandleSave (= save関数) → actions.save の順だったため
    // conflict があっても既にファイルが書き込まれていた。
    // 修正後は actions.save (conflict check) → postSave (dirty クリアのみ) の順。
    // このテストは postSave が save 関数を一切呼ばないことを確認する。
    const callOrder: string[] = [];
    const save = vi.fn(async () => { callOrder.push("save"); });
    const { hook } = setup({ save });
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    act(() => hook.result.current.update((d) => { d.name = "edited"; }));

    // actions.save (conflict check) が先に完了したと仮定して postSave を呼ぶ
    await act(async () => {
      callOrder.push("conflict-check");
      await hook.result.current.postSave();
      callOrder.push("post-save-done");
    });

    // save 関数 (ファイル書き込み相当) は呼ばれない
    expect(save).not.toHaveBeenCalled();
    // conflict-check → post-save-done の順で完了
    expect(callOrder).toEqual(["conflict-check", "post-save-done"]);
    // dirty クリア完了
    expect(hook.result.current.isDirty).toBe(false);
  });
});

// ── postSave (#908 P1-B fix) ─────────────────────────────────────────────────

describe("useResourceEditor: postSave (#908 P1-B fix)", () => {
  it("postSave: save 関数を呼ばずに isDirty=false・draft 削除・タブ clean になる", async () => {
    const save = vi.fn(async () => { /* ok */ });
    const { hook } = setup({ save });
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    act(() => hook.result.current.update((d) => { d.name = "changed"; }));
    expect(hook.result.current.isDirty).toBe(true);

    // postSave は save() を呼ばない (editSession.save が backend 側で書き込みを担う)
    await act(async () => { await hook.result.current.postSave(); });

    expect(save).not.toHaveBeenCalled(); // save 関数は呼ばれない
    expect(hook.result.current.isDirty).toBe(false);
    expect(hasDraft("table", "abc")).toBe(false);
    expect(getTabs().find((t) => t.id === makeTabId("table", "abc"))?.isDirty).toBe(false);
  });

  it("postSave: isSaving は true → false と変化する", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    act(() => hook.result.current.update((d) => { d.name = "changed"; }));

    // postSave 後は isSaving が false に戻る
    await act(async () => { await hook.result.current.postSave(); });
    expect(hook.result.current.isSaving).toBe(false);
  });

  it("postSave: handleSave との違い — handleSave は save() を呼ぶが postSave は呼ばない", async () => {
    const save = vi.fn(async () => { /* ok */ });
    const { hook } = setup({ save });
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    act(() => hook.result.current.update((d) => { d.name = "v1"; }));

    // handleSave は save() を呼ぶ
    await act(async () => { await hook.result.current.handleSave(); });
    expect(save).toHaveBeenCalledTimes(1);

    // postSave は save() を呼ばない
    act(() => hook.result.current.update((d) => { d.name = "v2"; }));
    await act(async () => { await hook.result.current.postSave(); });
    expect(save).toHaveBeenCalledTimes(1); // 変わらず 1 回のまま
    expect(hook.result.current.isDirty).toBe(false);
  });
});
