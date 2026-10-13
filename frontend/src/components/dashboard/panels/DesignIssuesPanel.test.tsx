/**
 * 設計の要確認パネル: 件数・種類ごとの内訳・保守ボタン (一覧の食い違いを直す・uuid を固定する。予行の件数を確認してから実行)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const request = vi.fn();
vi.mock("../../../mcp/mcpBridge", () => ({
  mcpBridge: {
    request: (...a: unknown[]) => request(...a),
    onBroadcast: () => () => undefined,
    onStatusChange: () => () => undefined,
  },
}));
const loadDesignInput = vi.fn();
vi.mock("../../document/loadDesignInput", () => ({ loadDesignInput: () => loadDesignInput() }));
vi.mock("../../../hooks/useWorkspacePath", () => ({ useWorkspacePath: () => ({ wsPath: (p: string) => `/w/x${p}` }) }));
vi.mock("../../../utils/toast", () => ({ showToast: vi.fn() }));
import { DesignIssuesPanel } from "./DesignIssuesPanel";

const input = {
  project: { name: "t" },
  screens: [{ id: "s1", name: "画面1", items: [] }],
  flows: [], tables: [{ id: "t1", name: "表1", physicalName: "t1", columns: [] }],
  extraIssues: [{ severity: "warning", section: "テーブル 表1", message: "スキーマ: 件数が少なすぎます", ref: { kind: "table", id: "t1" } }],
};

let health: Array<{ code: string }> = [];
beforeEach(() => {
  health = [];
  request.mockReset();
  loadDesignInput.mockReset();
  loadDesignInput.mockResolvedValue({ input, skipped: [] });
  request.mockImplementation(async (method: string, params?: { apply?: boolean }) => {
    if (method === "workspace.getHealth") return { issues: health };
    if (method === "workspace.repairRegistry") return params?.apply ? { applied: true } : { add: [{ kind: "table", id: "loose" }], remove: [{ kind: "table", id: "ghost" }], applied: false };
    if (method === "workspace.persistUuids") return params?.apply ? { applied: true, files: [] } : { files: ["tables/a.json", "tables/b.json"], applied: false };
    throw new Error(`unexpected ${method}`);
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); });

const renderPanel = () => render(<MemoryRouter><DesignIssuesPanel /></MemoryRouter>);

describe("DesignIssuesPanel", () => {
  it("警告の件数と、種類ごとの内訳 (0 件の種類もあわせて) を出す。保守ボタンは、案内が無ければ出ない", async () => {
    renderPanel();
    const warnings = Number(/警告 (\d+)/.exec((await screen.findByTestId("design-issues-warning")).textContent ?? "")?.[1]);
    expect(warnings).toBeGreaterThanOrEqual(1); // 設計書の検査 (表に主キーが無いなど) と、外から足したスキーマ違反
    expect(Number(/テーブル (\d+)/.exec(screen.getByTestId("design-issues-kind-テーブル").textContent ?? "")?.[1])).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("design-issues-kind-画面")).toBeTruthy();
    expect(screen.getByTestId("design-issues-kind-処理フロー").textContent).toContain("処理フロー 0");
    expect(screen.queryByTestId("design-issues-repair-registry")).toBeNull();
    expect(screen.queryByTestId("design-issues-persist-uuids")).toBeNull();
  });

  it("一覧の食い違いの案内 (code) があれば、ボタンを出す。予行の件数 (足す・外す対象) を確認して、実行する。やめれば書かない", async () => {
    health = [{ code: "registry-missing-file" }];
    renderPanel();
    const btn = await screen.findByTestId("design-issues-repair-registry");
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    fireEvent.click(btn);
    await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
    const msg = (window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(msg).toContain("table:loose");
    expect(msg).toContain("table:ghost");
    expect(request).not.toHaveBeenCalledWith("workspace.repairRegistry", { apply: true });

    fireEvent.click(btn);
    await waitFor(() => expect(request).toHaveBeenCalledWith("workspace.repairRegistry", { apply: true }));
  });

  it("uuid 未保存の案内 (code) があれば、ボタンを出す。件数を確認して固定する", async () => {
    health = [{ code: "uuid-unsaved" }];
    renderPanel();
    fireEvent.click(await screen.findByTestId("design-issues-persist-uuids"));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect((window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("2 件");
    await waitFor(() => expect(request).toHaveBeenCalledWith("workspace.persistUuids", { apply: true }));
  });

  it("健全性が取れなくても、要確認の表示は続ける", async () => {
    request.mockImplementation(async (m: string) => { if (m === "workspace.getHealth") throw new Error("x"); return {}; });
    renderPanel();
    expect((await screen.findByTestId("design-issues-warning")).textContent).toMatch(/警告 \d+/);
  });
});
