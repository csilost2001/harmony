import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { KEYBOARD_MOVE_SETTLE_MS, useKeyboardNodeMove } from "./useKeyboardNodeMove";

interface N { id: string; selected?: boolean }
function Harness({ nodes, commit, enabled = true }: { nodes: N[]; commit: (n: N[]) => void; enabled?: boolean }) {
  const onKeyUp = useKeyboardNodeMove(() => nodes, commit, enabled);
  return (
    <div data-testid="canvas" onKeyUp={onKeyUp}>
      <div className="react-flow__node"><button data-testid="in-node">n</button></div>
      <button data-testid="outside">x</button>
    </div>
  );
}
afterEach(() => { vi.useRealTimers(); });

describe("useKeyboardNodeMove", () => {
  it("ノードで矢印キーを押し終えて落ち着いたら、選択中のノードだけで 1 回呼ぶ (連続した押下はまとめる)", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const nodes: N[] = [{ id: "a", selected: true }, { id: "b" }];
    const { getByTestId } = render(<Harness nodes={nodes} commit={commit} />);
    for (let i = 0; i < 5; i++) { fireEvent.keyUp(getByTestId("in-node"), { key: "ArrowRight" }); vi.advanceTimersByTime(100); }
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(KEYBOARD_MOVE_SETTLE_MS);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([{ id: "a", selected: true }]);
  });

  it("ノードの外・矢印以外のキー・無効のときは、何もしない。選択が無ければ呼ばない", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const { getByTestId, rerender } = render(<Harness nodes={[{ id: "a", selected: true }]} commit={commit} />);
    fireEvent.keyUp(getByTestId("outside"), { key: "ArrowRight" });
    fireEvent.keyUp(getByTestId("in-node"), { key: "Enter" });
    vi.advanceTimersByTime(1000);
    expect(commit).not.toHaveBeenCalled();
    rerender(<Harness nodes={[{ id: "a", selected: true }]} commit={commit} enabled={false} />);
    fireEvent.keyUp(getByTestId("in-node"), { key: "ArrowLeft" });
    vi.advanceTimersByTime(1000);
    expect(commit).not.toHaveBeenCalled();
    rerender(<Harness nodes={[{ id: "a" }]} commit={commit} />);
    fireEvent.keyUp(getByTestId("in-node"), { key: "ArrowLeft" });
    vi.advanceTimersByTime(1000);
    expect(commit).not.toHaveBeenCalled();
  });
});
