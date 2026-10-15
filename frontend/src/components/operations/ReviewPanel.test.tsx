import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let tab: { type: string; resourceId: string } | null = { type: "table", resourceId: "orders" };
vi.mock("../../hooks/useActiveTab", () => ({ useActiveTab: () => tab }));
vi.mock("../../hooks/useWorkspacePath", () => ({ useWorkspacePath: () => ({ wsPath: (p: string) => `/w/x${p}` }) }));
const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));
const request = vi.fn();
vi.mock("../../mcp/mcpBridge", () => ({ mcpBridge: { request: (...a: unknown[]) => request(...a), onBroadcast: () => () => undefined, onStatusChange: () => () => undefined, startWithoutEditor: () => undefined } }));
vi.mock("../../utils/failureToast", () => ({ reportFailure: vi.fn() }));
vi.mock("../../utils/toast", () => ({ showToast: vi.fn() }));
import { ReviewPanel } from "./ReviewPanel";
import { requestHeaderPanel } from "../../utils/headerPanels";

const thread = (id: string, status: string, kind = "table", target = "orders") => ({ id, status, target: { kind, id: target }, messages: [{ id: `${id}m`, by: "花子", at: "2026-10-01T09:00:00.000Z", text: `コメント ${id}` }] });
beforeEach(() => {
  request.mockReset(); navigate.mockReset();
  tab = { type: "table", resourceId: "orders" };
  request.mockImplementation(async (m: string) => {
    if (m === "reviewComments.load") return { problems: [], threads: [thread("t1", "open"), thread("t2", "resolved"), thread("t3", "open", "table", "other"), thread("t4", "open", "screen", "orders")] };
    if (m === "approvals.load") return { problems: [], rows: [{ kind: "table", id: "orders", name: "注文", state: "review", status: "review", history: [], nextStates: [{ to: "approved", needs: "approver" }] }] };
    throw new Error(m);
  });
});
const mount = () => render(<MemoryRouter><ReviewPanel /></MemoryRouter>);

describe("ヘッダーのレビューパネル", () => {
  it("設計のタブだけに出る (一覧などのタブでは出さず、何も問い合わせない)", async () => {
    tab = { type: "table-list", resourceId: "main" };
    mount();
    expect(screen.queryByTestId("review-open")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("いまの設計の未解決のコメントの数を印に出す (ほかの設計・同じ id の別の種類は数えない)。開くと、承認の状態とコメントが出る", async () => {
    mount();
    expect((await screen.findByTestId("review-badge")).textContent).toBe("1");
    fireEvent.click(screen.getByTestId("review-open"));
    const panel = await screen.findByTestId("review-panel");
    expect(panel.textContent).toContain("コメント t1");
    expect(panel.textContent).toContain("コメント t2"); // 解決済みも、一覧には出る
    expect(panel.textContent).not.toContain("コメント t3");
    expect(panel.textContent).not.toContain("コメント t4");
    expect(panel.textContent).toContain("承認待ち");
    expect(screen.getByTestId("op-approval-approved")).toBeTruthy();
  });

  it("画面の種類 (画面項目) は、画面として扱う。コマンドパレットの合図でも開く。Escape で閉じる。「連携と運用を開く」で移動する", async () => {
    tab = { type: "screen-items", resourceId: "orders" };
    mount();
    await screen.findByTestId("review-open");
    await waitFor(() => expect(screen.getByTestId("review-badge").textContent).toBe("1")); // t4 (screen / orders)
    act(() => requestHeaderPanel("review"));
    const panel = await screen.findByTestId("review-panel");
    expect(panel.textContent).toContain("コメント t4");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByTestId("review-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("review-open"));
    fireEvent.click(screen.getByRole("button", { name: "連携と運用を開く" }));
    expect(navigate).toHaveBeenCalledWith("/w/x/operations");
  });

  it("コメントがなければ、そう出す。新しいコメントを送ると、要求になる", async () => {
    request.mockImplementation(async (m: string) => (m === "reviewComments.load" ? { problems: [], threads: [] } : m === "approvals.load" ? { problems: [], rows: [] } : { threadId: "t9" }));
    mount();
    fireEvent.click(await screen.findByTestId("review-open"));
    expect((await screen.findByTestId("review-panel")).textContent).toContain("この設計へのコメントは、まだありません");
    fireEvent.change(screen.getByTestId("op-thread-text"), { target: { value: "確認してください" } });
    fireEvent.click(screen.getByTestId("op-thread-send"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("reviewComments.add", { target: { kind: "table", id: "orders" }, text: "確認してください" }));
  });
});
