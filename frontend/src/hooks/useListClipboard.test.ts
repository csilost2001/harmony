import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListClipboard, _resetSharedClipboards } from "./useListClipboard";

interface Item {
  id: string;
  name: string;
  nested: { value: number };
}

const a: Item = { id: "a", name: "A", nested: { value: 1 } };
const b: Item = { id: "b", name: "B", nested: { value: 2 } };

function setup() {
  return renderHook(() => useListClipboard<Item>((it) => it.id));
}

describe("useListClipboard", () => {
  it("初期状態は空", () => {
    const { result } = setup();
    expect(result.current.hasContent).toBe(false);
    expect(result.current.clipboard.mode).toBeNull();
  });

  it("copy で mode=copy、items が保存される", () => {
    const { result } = setup();
    act(() => result.current.copy([a]));
    expect(result.current.hasContent).toBe(true);
    expect(result.current.clipboard.mode).toBe("copy");
    expect(result.current.clipboard.items).toEqual([a]);
  });

  it("cut で mode=cut、isItemCut=true になる", () => {
    const { result } = setup();
    act(() => result.current.cut([a]));
    expect(result.current.clipboard.mode).toBe("cut");
    expect(result.current.isItemCut("a")).toBe(true);
    expect(result.current.isItemCut("b")).toBe(false);
  });

  it("clear でクリップボードが空になる", () => {
    const { result } = setup();
    act(() => result.current.cut([a, b]));
    act(() => result.current.clear());
    expect(result.current.hasContent).toBe(false);
    expect(result.current.isItemCut("a")).toBe(false);
  });

  it("cut からの consume は items を返してクリアする", () => {
    const { result } = setup();
    act(() => result.current.cut([a]));
    let consumed: Item[] = [];
    act(() => { consumed = result.current.consume(); });
    expect(consumed).toEqual([a]);
    expect(result.current.hasContent).toBe(false);
  });

  it("copy からの consume はディープコピーを返してクリップボードは残る", () => {
    const { result } = setup();
    act(() => result.current.copy([a]));
    let consumed: Item[] = [];
    act(() => { consumed = result.current.consume(); });
    expect(consumed).toEqual([a]);
    // ディープコピーなので別オブジェクト
    expect(consumed[0]).not.toBe(a);
    expect(consumed[0].nested).not.toBe(a.nested);
    // 状態は残る
    expect(result.current.hasContent).toBe(true);
  });

  it("新しい cut は前の内容を上書きする", () => {
    const { result } = setup();
    act(() => result.current.cut([a]));
    act(() => result.current.cut([b]));
    expect(result.current.isItemCut("a")).toBe(false);
    expect(result.current.isItemCut("b")).toBe(true);
  });
});

describe("useListClipboard (別の編集画面へ運べる共有のクリップボード)", () => {
  const hookFor = (sourceId: string, channel = "test-cols") => renderHook(() => useListClipboard<Item>((it) => it.id, { channel, sourceId }));
  beforeEach(() => { _resetSharedClipboards(); });

  it("あるテーブルでコピーしたものを、別のテーブルの画面から貼り付けられる (元の画面と別のものとして)", () => {
    const t1 = hookFor("t1");
    const t2 = hookFor("t2");
    act(() => t1.result.current.copy([a]));
    expect(t2.result.current.hasContent).toBe(true);
    expect(t2.result.current.isForeign).toBe(true);
    expect(t1.result.current.isForeign).toBe(false);
    let got: Item[] = [];
    act(() => { got = t2.result.current.consume(); });
    expect(got).toEqual([a]);
    expect(got[0]).not.toBe(a); // 複製
    expect(t2.result.current.hasContent).toBe(true); // コピーは、何度でも貼れる
  });

  it("別の画面から切り取ったものは、元を消せないので、コピーとして貼る (クリップボードはコピーに変わる)", () => {
    const t1 = hookFor("t1");
    const t2 = hookFor("t2");
    act(() => t1.result.current.cut([a, b]));
    expect(t1.result.current.isItemCut("a")).toBe(true);
    expect(t2.result.current.isItemCut("a")).toBe(false); // 別の画面の行は薄くしない
    act(() => { t2.result.current.consume(); });
    expect(t2.result.current.clipboard.mode).toBe("copy");
    expect(t1.result.current.isItemCut("a")).toBe(false);
  });

  it("同じ画面の中の切り取り → 貼り付けは、従来どおり移動 (貼ったら空になる)", () => {
    const t1 = hookFor("t1");
    act(() => t1.result.current.cut([a]));
    let got: Item[] = [];
    act(() => { got = t1.result.current.consume(); });
    expect(got).toEqual([a]);
    expect(t1.result.current.hasContent).toBe(false);
  });

  it("種類 (channel) が違えば、混ざらない。共有を指定しなければ、画面ごとに別", () => {
    const cols = hookFor("t1", "cols");
    const items = hookFor("s1", "items");
    act(() => cols.result.current.copy([a]));
    expect(items.result.current.hasContent).toBe(false);
    const local1 = renderHook(() => useListClipboard<Item>((it) => it.id));
    const local2 = renderHook(() => useListClipboard<Item>((it) => it.id));
    act(() => local1.result.current.copy([a]));
    expect(local2.result.current.hasContent).toBe(false);
  });
});

describe("useListClipboard (クリップボード履歴)", () => {
  const hookFor = (sourceId: string) => renderHook(() => useListClipboard<Item>((it) => it.id, { channel: "hist-cols", sourceId }));
  beforeEach(() => { _resetSharedClipboards(); });

  it("コピーした順に新しい方を先頭へ残し、同じ内容は重ねない", () => {
    const t = hookFor("t1");
    act(() => t.result.current.copy([a]));
    act(() => t.result.current.copy([b]));
    act(() => t.result.current.copy([a]));
    expect(t.result.current.history.map((h) => h.items[0].id)).toEqual(["a", "b"]);
  });

  it("10 件までしか持たない", () => {
    const t = hookFor("t1");
    for (let i = 0; i < 14; i++) act(() => t.result.current.copy([{ id: "i" + i, name: "n", nested: { value: i } }]));
    expect(t.result.current.history).toHaveLength(10);
    expect(t.result.current.history[0].items[0].id).toBe("i13");
  });

  it("履歴から選ぶと、クリップボードに戻る (別の画面からも)", () => {
    const t1 = hookFor("t1");
    const t2 = hookFor("t2");
    act(() => t1.result.current.copy([a]));
    act(() => t1.result.current.copy([b]));
    act(() => t2.result.current.restoreFromHistory(1));
    expect(t2.result.current.clipboard.items.map((i) => i.id)).toEqual(["a"]);
    expect(t2.result.current.clipboard.mode).toBe("copy");
  });

  it("共有でないクリップボードは履歴を持たない", () => {
    const t = renderHook(() => useListClipboard<Item>((it) => it.id));
    act(() => t.result.current.copy([a]));
    expect(t.result.current.history).toEqual([]);
  });
});
