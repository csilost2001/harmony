import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListClipboard } from "./useListClipboard";

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
