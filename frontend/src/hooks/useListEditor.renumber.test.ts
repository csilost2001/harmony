import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListEditor } from "./useListEditor";
import { renumber } from "../utils/listOrder";

// docs/spec/list-common.md §3.10 — useListEditor の renumber コールバック

interface Item { id: string; no: number; name: string; }

function makeItems(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${i + 1}`, no: i + 1, name: `item-${i + 1}` }));
}

function setup(withRenumber = true) {
  const items = makeItems(3);
  const load = vi.fn(async () => items);
  const commit = vi.fn(async () => undefined);
  const hook = renderHook(() =>
    useListEditor<Item>({
      getId: (it) => it.id,
      load,
      commit,
      renumber: withRenumber ? renumber : undefined,
    }),
  );
  return { ...hook, load, commit };
}

describe("useListEditor — renumber 連動 (§3.10)", () => {
  it("reorder 後に no が配列順で振り直される", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    expect(result.current.items.map((i) => i.no)).toEqual([1, 2, 3]);
    act(() => result.current.reorder(0, 2));
    // id 順: [id-2, id-3, id-1]
    expect(result.current.items.map((i) => i.id)).toEqual(["id-2", "id-3", "id-1"]);
    expect(result.current.items.map((i) => i.no)).toEqual([1, 2, 3]);
  });

  it("insertAt 後に全体が再採番される (新規は末尾/挿入位置の no に)", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.insertAt([{ id: "new", no: 0, name: "new" }], 1));
    expect(result.current.items.map((i) => i.id)).toEqual(["id-1", "new", "id-2", "id-3"]);
    expect(result.current.items.map((i) => i.no)).toEqual([1, 2, 3, 4]);
  });

  it("insert (末尾追加) 後に no = N+1 が与えられる", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.insert([{ id: "new", no: 0, name: "new" }]));
    expect(result.current.items.map((i) => i.id)).toEqual(["id-1", "id-2", "id-3", "new"]);
    expect(result.current.items.map((i) => i.no)).toEqual([1, 2, 3, 4]);
  });

  it("markDeleted では no は再採番されない (ghost が元の no を保持)", async () => {
    const { result } = setup();
    await act(async () => { await result.current.reload(); });
    const noBefore = result.current.items.map((i) => i.no);
    act(() => result.current.markDeleted(["id-2"]));
    const noAfter = result.current.items.map((i) => i.no);
    expect(noAfter).toEqual(noBefore); // [1, 2, 3] のまま
  });

  it("save の itemsInOrder は削除後に 1..N で再採番されている", async () => {
    const { result, commit } = setup();
    await act(async () => { await result.current.reload(); });
    act(() => result.current.markDeleted(["id-2"]));
    await act(async () => { await result.current.save(); });
    expect(commit).toHaveBeenCalled();
    const committed = commit.mock.calls[0][0] as { itemsInOrder: Item[]; deletedIds: string[] };
    // id-2 が削除されて id-1, id-3 だけが残り、no は 1..N で再採番
    expect(committed.itemsInOrder.map((i) => i.id)).toEqual(["id-1", "id-3"]);
    expect(committed.itemsInOrder.map((i) => i.no)).toEqual([1, 2]);
    expect(committed.deletedIds).toEqual(["id-2"]);
  });

  it("renumber を渡さない場合、reorder 後も no は変わらない (後方互換)", async () => {
    const { result } = setup(false);
    await act(async () => { await result.current.reload(); });
    act(() => result.current.reorder(0, 2));
    expect(result.current.items.map((i) => i.id)).toEqual(["id-2", "id-3", "id-1"]);
    expect(result.current.items.map((i) => i.no)).toEqual([2, 3, 1]); // 元のまま
  });
});
