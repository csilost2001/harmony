import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListEditor } from "./useListEditor";

interface Item {
  id: string;
  name: string;
}

function makeItems(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${i + 1}`, name: `item-${i + 1}` }));
}

function setup(opts: { initial?: Item[]; commit?: ReturnType<typeof vi.fn> } = {}) {
  const items = opts.initial ?? makeItems(3);
  const load = vi.fn(async () => items);
  const commit = opts.commit ?? vi.fn(async () => undefined);
  const result = renderHook(() =>
    useListEditor<Item>({
      getId: (it) => it.id,
      load,
      commit,
    }),
  );
  return { ...result, load, commit };
}

describe("useListEditor", () => {
  it("初期は空、reload 後に items が入る", async () => {
    const { result } = setup();
    expect(result.current.items).toEqual([]);
    await act(async () => { await result.current.reload(); });
    expect(result.current.items).toHaveLength(3);
    expect(result.current.isDirty).toBe(false);
  });

  it("reorder で draft が並び替わり、dirty=true になる", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.reorder(0, 2));
    expect(result.current.items.map((x) => x.id)).toEqual(["id-2", "id-3", "id-1"]);
    expect(result.current.isDirty).toBe(true);
  });

  it("reorder が同じインデックスだと何もしない", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.reorder(1, 1));
    expect(result.current.items.map((x) => x.id)).toEqual(["id-1", "id-2", "id-3"]);
    expect(result.current.isDirty).toBe(false);
  });

  it("markDeleted で deletedIds に追加され、dirty=true", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.markDeleted(["id-2"]));
    expect(result.current.deletedIds.has("id-2")).toBe(true);
    expect(result.current.isDeleted("id-2")).toBe(true);
    expect(result.current.isDirty).toBe(true);
  });

  it("unmarkDeleted で元に戻り、dirty=false に戻る", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.markDeleted(["id-2"]));
    act(() => result.current.unmarkDeleted(["id-2"]));
    expect(result.current.deletedIds.size).toBe(0);
    expect(result.current.isDirty).toBe(false);
  });

  it("toggleDeleted は複数回呼ぶと状態が切り替わる", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.toggleDeleted(["id-1"]));
    expect(result.current.isDeleted("id-1")).toBe(true);
    act(() => result.current.toggleDeleted(["id-1"]));
    expect(result.current.isDeleted("id-1")).toBe(false);
  });

  it("save で commit が呼ばれ、削除と並び順が反映される", async () => {
    const commit = vi.fn(async () => undefined);
    const { result } = setup({ commit });
    await act(async () => { await result.current.reload(); });
    act(() => result.current.reorder(0, 2));
    act(() => result.current.markDeleted(["id-3"]));
    await act(async () => { await result.current.save(); });
    expect(commit).toHaveBeenCalledOnce();
    const [arg] = commit.mock.calls[0];
    expect(arg.deletedIds).toEqual(["id-3"]);
    expect(arg.itemsInOrder.map((x: Item) => x.id)).toEqual(["id-2", "id-1"]);
  });

  it("save 後は isDirty=false に戻る", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.markDeleted(["id-1"]));
    expect(result.current.isDirty).toBe(true);
    await act(async () => { await result.current.save(); });
    expect(result.current.isDirty).toBe(false);
    expect(result.current.deletedIds.size).toBe(0);
  });

  it("reset でドラフト破棄、reload される", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.reorder(0, 2));
    act(() => result.current.markDeleted(["id-1"]));
    await act(async () => { await result.current.reset(); });
    expect(result.current.items.map((x) => x.id)).toEqual(["id-1", "id-2", "id-3"]);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.deletedIds.size).toBe(0);
  });

  it("insert で末尾に追加、dirty=true", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.insert([{ id: "id-new", name: "new" }]));
    expect(result.current.items.map((x) => x.id)).toEqual(["id-1", "id-2", "id-3", "id-new"]);
    expect(result.current.isDirty).toBe(true);
  });

  it("insertAt で指定位置に挿入", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.insertAt([{ id: "id-new", name: "new" }], 1));
    expect(result.current.items.map((x) => x.id)).toEqual(["id-1", "id-new", "id-2", "id-3"]);
  });

  it("tabId を指定しても hook はエラーにならず dirty 追跡が動く", async () => {
    // tabStore の副作用は e2e で検証。ここでは hook が落ちないこと + dirty 追跡のみ確認。
    const load = vi.fn(async () => makeItems(2));
    const commit = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useListEditor<Item>({
        getId: (it) => it.id,
        load,
        commit,
        tabId: "nonexistent-tab-for-test",
      }),
    );
    await act(async () => { await result.current.reload(); });
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.markDeleted(["id-1"]));
    expect(result.current.isDirty).toBe(true);
  });
});
