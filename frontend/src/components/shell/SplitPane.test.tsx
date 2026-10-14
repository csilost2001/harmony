import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SplitPane } from "./SplitPane";
import { _resetSplitCache, getSplit, setSplit } from "../../store/splitStore";

const target = { path: "/table/edit/orders", label: "注文", tabId: "table:orders" };
function post(win: Window | null, data: unknown, origin = window.location.origin) {
  act(() => { window.dispatchEvent(new MessageEvent("message", { data, origin, source: win })); });
}

describe("SplitPane (並べて表示の右ペイン)", () => {
  beforeEach(() => { sessionStorage.clear(); _resetSplitCache(); vi.restoreAllMocks(); });

  it("同じアプリを ?pane=1 つきで iframe に開く。ワークスペースの ID は URL 用にエンコードする", () => {
    render(<SplitPane wsId="my ws" target={target} onOpenInMain={() => undefined} onSwap={() => undefined} />);
    expect(screen.getByTestId("split-frame").getAttribute("src")).toBe("/w/my%20ws/table/edit/orders?pane=1");
    expect(screen.getByText("注文")).toBeInTheDocument();
  });

  it("右ペインの中からの、未保存の合図だけを受け取る (ほかの窓・別のオリジンの合図は無視)", () => {
    render(<SplitPane wsId="ws1" target={target} onOpenInMain={() => undefined} onSwap={() => undefined} />);
    const win = (screen.getByTestId("split-frame") as HTMLIFrameElement).contentWindow;
    post(window, { type: "harmony-pane-dirty", dirty: true }); // 親自身
    post(win, { type: "harmony-pane-dirty", dirty: true }, "https://evil.example");
    expect(screen.queryByTestId("split-pane-dirty")).toBeNull();
    post(win, { type: "harmony-pane-dirty", dirty: true });
    expect(screen.getByTestId("split-pane-dirty")).toBeInTheDocument();
    post(win, { type: "harmony-pane-dirty", dirty: false });
    expect(screen.queryByTestId("split-pane-dirty")).toBeNull();
  });

  it("「左で開く」「入れ替え」は、右ペインの中でいま開いている画面のパスで呼ぶ。別のワークスペースのパスは使わない", () => {
    const onOpenInMain = vi.fn();
    const onSwap = vi.fn();
    render(<SplitPane wsId="ws1" target={target} onOpenInMain={onOpenInMain} onSwap={onSwap} />);
    const win = (screen.getByTestId("split-frame") as HTMLIFrameElement).contentWindow;
    fireEvent.click(screen.getByTestId("split-open-main"));
    expect(onOpenInMain).toHaveBeenLastCalledWith("/table/edit/orders");
    post(win, { type: "harmony-pane-nav", path: "/w/ws1/process-flow/edit/order-confirm" });
    fireEvent.click(screen.getByTestId("split-swap"));
    expect(onSwap).toHaveBeenLastCalledWith("/process-flow/edit/order-confirm");
    post(win, { type: "harmony-pane-nav", path: "/w/other/table/list" });
    fireEvent.click(screen.getByTestId("split-open-main"));
    expect(onOpenInMain).toHaveBeenLastCalledWith("/process-flow/edit/order-confirm"); // 他のワークスペースのパスは、受け取らない
  });

  it("閉じると、右ペインの記録が消える。未保存があれば、先に確認する (取りやめると閉じない)", () => {
    setSplit("ws1", target);
    render(<SplitPane wsId="ws1" target={target} onOpenInMain={() => undefined} onSwap={() => undefined} />);
    const win = (screen.getByTestId("split-frame") as HTMLIFrameElement).contentWindow;
    post(win, { type: "harmony-pane-dirty", dirty: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByTestId("split-close"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(getSplit("ws1")).not.toBeNull();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId("split-close"));
    expect(getSplit("ws1")).toBeNull();
  });

  it("未保存が無ければ、確認なしで閉じる", () => {
    setSplit("ws1", target);
    const confirm = vi.spyOn(window, "confirm");
    render(<SplitPane wsId="ws1" target={target} onOpenInMain={() => undefined} onSwap={() => undefined} />);
    fireEvent.click(screen.getByTestId("split-close"));
    expect(confirm).not.toHaveBeenCalled();
    expect(getSplit("ws1")).toBeNull();
  });
});
