import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../../hooks/useFocusTrap", () => ({ useFocusTrap: () => undefined }));
vi.mock("../../hooks/useWorkspacePath", () => ({ useWorkspacePath: () => ({ wsPath: (p: string) => `/w/x${p}`, wsId: "x" }) }));
const written: string[] = [];
vi.mock("../../utils/tableExport", () => ({ writeClipboardText: (t: string) => { written.push(t); return Promise.resolve(); } }));
vi.mock("../../utils/toast", () => ({ showToast: () => undefined }));
import { WalkthroughDialog } from "./WalkthroughDialog";
import { loadWalkthroughDone } from "../../utils/guidedWalkthrough";

function Where() { return <span data-testid="where">{useLocation().pathname}</span>; }
const renderIt = (onClose = vi.fn()) => render(<MemoryRouter><WalkthroughDialog onClose={onClose} /><Where /></MemoryRouter>);

beforeEach(() => { localStorage.clear(); written.length = 0; });

describe("WalkthroughDialog (続編 第 10 弾 #199)", () => {
  it("最初の手順が開いていて、「次はここ」が付く。終えた印を付けると、次の手順へ移り、覚える", () => {
    renderIt();
    expect(screen.getByTestId("wt-sample-table").textContent).toContain("customer_name");
    fireEvent.click(screen.getByTestId("wt-done-table"));
    expect([...loadWalkthroughDone("x")]).toEqual(["table"]);
    expect(screen.getByTestId("wt-step-table").getAttribute("data-done")).toBe("true");
    expect(screen.getByTestId("wt-step-screen").textContent).toContain("次はここ");
  });
  it("例をコピーできる。画面へ進むと、閉じて、その画面へ移る", () => {
    const onClose = vi.fn();
    renderIt(onClose);
    fireEvent.click(screen.getByTestId("wt-copy-table"));
    expect(written[0]).toContain("物理名\t表示名");
    fireEvent.click(screen.getByTestId("wt-go-table"));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId("where").textContent).toBe("/w/x/table/list");
  });
  it("手順の見出しを押すと、その手順が開く (もう一度で閉じる)", () => {
    renderIt();
    fireEvent.click(screen.getByTestId("wt-open-flow"));
    expect(screen.getByTestId("wt-sample-flow").textContent).toContain("INSERT INTO orders");
    expect(screen.queryByTestId("wt-sample-table")).toBeNull();
    fireEvent.click(screen.getByTestId("wt-open-flow"));
    expect(screen.queryByTestId("wt-sample-flow")).toBeNull();
  });
});
