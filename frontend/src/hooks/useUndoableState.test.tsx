import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useUndoableState } from "./useUndoableState";

function setup() {
  const onSave = vi.fn();
  const hook = renderHook(() => useUndoableState<number>(0, { onSave }));
  const push = (n: number) => act(() => hook.result.current.updateAndCommit(() => n));
  return { hook, onSave, push };
}

describe("useUndoableState の履歴", () => {
  it("積んだ状態が、古い順の過去として見える", () => {
    const { hook, push } = setup();
    push(1); push(2); push(3);
    expect(hook.result.current.state).toBe(3);
    expect(hook.result.current.history.past).toEqual([0, 1, 2]);
    expect(hook.result.current.history.future).toEqual([]);
  });

  it("jumpTo(負) で一度に戻り、戻した分が未来になる。onSave には移った先の状態が渡る", () => {
    const { hook, onSave, push } = setup();
    push(1); push(2); push(3);
    act(() => hook.result.current.jumpTo(-2));
    expect(hook.result.current.state).toBe(1);
    expect(hook.result.current.history.past).toEqual([0]);
    expect(hook.result.current.history.future).toEqual([2, 3]);
    expect(onSave).toHaveBeenLastCalledWith(1);
  });

  it("jumpTo(正) で一度にやり直せる。途中の状態は過去へ戻る", () => {
    const { hook, push } = setup();
    push(1); push(2); push(3);
    act(() => hook.result.current.jumpTo(-3));
    expect(hook.result.current.state).toBe(0);
    act(() => hook.result.current.jumpTo(2));
    expect(hook.result.current.state).toBe(2);
    expect(hook.result.current.history.past).toEqual([0, 1]);
    expect(hook.result.current.history.future).toEqual([3]);
  });

  it("端を越える歩数は、端までで止まる。0 は何もしない。移ったあとも undo / redo が続けて使える", () => {
    const { hook, onSave, push } = setup();
    push(1); push(2);
    act(() => hook.result.current.jumpTo(-99));
    expect(hook.result.current.state).toBe(0);
    act(() => hook.result.current.jumpTo(99));
    expect(hook.result.current.state).toBe(2);
    onSave.mockClear();
    act(() => hook.result.current.jumpTo(0));
    expect(onSave).not.toHaveBeenCalled();
    act(() => hook.result.current.jumpTo(-1));
    act(() => hook.result.current.undo());
    expect(hook.result.current.state).toBe(0);
    act(() => hook.result.current.redo());
    expect(hook.result.current.state).toBe(1);
  });

  it("新しい操作をすると、未来は消える。reset で履歴も空になる", () => {
    const { hook, push } = setup();
    push(1); push(2);
    act(() => hook.result.current.jumpTo(-1));
    push(9);
    expect(hook.result.current.history.future).toEqual([]);
    expect(hook.result.current.history.past).toEqual([0, 1]);
    act(() => hook.result.current.reset(5));
    expect(hook.result.current.history).toEqual({ past: [], future: [] });
  });
});

describe("useUndoableState: StrictMode でも、commit と undo が続けて動く (更新関数が純粋)", () => {
  it("commit → undo → redo を、同じ操作の中で続けても、戻せる", async () => {
    const { StrictMode } = await import("react");
    const wrapper = ({ children }: { children: React.ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useUndoableState<{ v: string }>({ v: "O" }), { wrapper });
    act(() => { result.current.reset({ v: "O" }); });
    act(() => { result.current.update((p) => ({ v: `${p.v}A` })); });
    act(() => { result.current.commit(); });
    expect([result.current.state.v, result.current.canUndo]).toEqual(["OA", true]);
    act(() => { result.current.commit(); result.current.undo(); });
    expect([result.current.state.v, result.current.canUndo, result.current.canRedo]).toEqual(["O", false, true]);
    act(() => { result.current.commit(); result.current.redo(); });
    expect(result.current.state.v).toBe("OA");
  });

  it("undo の通知 (トースト) は、1 回だけ出る", async () => {
    const { getToastHistory, clearToastHistory } = await import("../utils/toast");
    const { StrictMode } = await import("react");
    clearToastHistory();
    const wrapper = ({ children }: { children: React.ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useUndoableState<{ columns: Array<{ name: string }> }>({ columns: [] }), { wrapper });
    act(() => { result.current.updateAndCommit(() => ({ columns: [{ name: "金額" }] })); });
    act(() => { result.current.undo(); });
    const notices = getToastHistory().filter((t) => t.text.startsWith("元に戻しました"));
    expect(notices).toHaveLength(1);
    expect(notices[0].text).toContain("カラム『金額』の削除");
  });
});
