import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { requestQuickCreate, useQuickCreate } from "./useQuickCreate";

function Probe({ kind, onOpen }: { kind: string; onOpen: () => void }) { useQuickCreate(kind, onOpen); return null; }

describe("useQuickCreate", () => {
  beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); });

  it("一覧がまだ開いていないとき: 旗が立っていれば、マウントで 1 回だけ開く", () => {
    sessionStorage.setItem("harmony-quick-create:table", "1");
    const open = vi.fn();
    const { rerender } = render(<Probe kind="table" onOpen={open} />);
    expect(open).toHaveBeenCalledTimes(1);
    rerender(<Probe kind="table" onOpen={open} />);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("一覧がすでに開いているとき: 通知で開く。別の種類は開かない", () => {
    const table = vi.fn(); const flow = vi.fn();
    render(<><Probe kind="table" onOpen={table} /><Probe kind="process-flow" onOpen={flow} /></>);
    expect(table).not.toHaveBeenCalled();
    act(() => { requestQuickCreate("table"); vi.runAllTimers(); });
    expect(table).toHaveBeenCalledTimes(1);
    expect(flow).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new CustomEvent("harmony:quick-create")); });
    expect(table).toHaveBeenCalledTimes(1); // 旗は消えているので、もう開かない
  });
});
