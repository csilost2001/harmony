/**
 * 履歴の画面 (DraftHistoryModal): draft 履歴の復元と、保存前の版 (上書きされる前の内容) の読み込み。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const request = vi.fn();
vi.mock("../../mcp/mcpBridge", () => ({ mcpBridge: { request: (...a: unknown[]) => request(...a) } }));
import { DraftHistoryModal } from "./DraftHistoryModal";

const versions = [
  { id: "2026-10-13T05-00-00.000Z-001", savedAt: "2026-10-13T05:00:00.000Z", size: 2048 },
  { id: "2026-10-13T04-00-00.000Z-000", savedAt: "2026-10-13T04:00:00.000Z", size: 900 },
];

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (method: string) => {
    if (method === "editSession.listHistory") return { history: [] };
    if (method === "fileVersions.list") return { versions };
    if (method === "fileVersions.get") return { snapshot: { id: "orders", name: "戻した内容" } };
    throw new Error(`unexpected ${method}`);
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); });

const open = (extra: Partial<Parameters<typeof DraftHistoryModal>[0]> = {}) => {
  const props = { resourceType: "table" as const, resourceId: "orders", isOpen: true, onClose: vi.fn(), onRestore: vi.fn(), ...extra };
  render(<DraftHistoryModal {...props} />);
  return props;
};

describe("DraftHistoryModal: 保存前の版", () => {
  it("編集画面の中 (onApplyVersion あり) で、保存前の版の一覧が出る。履歴が空でも「履歴がありません」とは出さない", async () => {
    open({ onApplyVersion: vi.fn() });
    expect(await screen.findByTestId("file-versions")).toBeTruthy();
    expect(screen.getByTestId(`file-version-${versions[0].id}`).textContent).toContain("上書きされた内容");
    expect(screen.queryByText("履歴がありません。")).toBeNull();
  });

  it("一覧 (onApplyVersion なし) では、保存前の版を出さず、問い合わせもしない", async () => {
    open();
    await waitFor(() => expect(request).toHaveBeenCalledWith("editSession.listHistory", expect.anything()));
    expect(request).not.toHaveBeenCalledWith("fileVersions.list", expect.anything());
    expect(screen.queryByTestId("file-versions")).toBeNull();
  });

  it("「この版を読み込む」: 確認のあと、版の内容を onApplyVersion へ渡して閉じる。確認でやめれば何もしない", async () => {
    const onApplyVersion = vi.fn();
    const props = open({ onApplyVersion });
    const btn = await screen.findByTestId(`file-version-restore-${versions[0].id}`);
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    fireEvent.click(btn);
    expect(onApplyVersion).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalledWith("fileVersions.get", expect.anything());

    fireEvent.click(btn);
    await waitFor(() => expect(onApplyVersion).toHaveBeenCalledWith({ id: "orders", name: "戻した内容" }));
    expect(request).toHaveBeenCalledWith("fileVersions.get", { resourceType: "table", resourceId: "orders", versionId: versions[0].id });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("版の読み込みに失敗したら、エラーを出して閉じない", async () => {
    request.mockImplementation(async (method: string) => {
      if (method === "editSession.listHistory") return { history: [] };
      if (method === "fileVersions.list") return { versions };
      throw new Error("版が見つかりません");
    });
    const onApplyVersion = vi.fn();
    const props = open({ onApplyVersion });
    fireEvent.click(await screen.findByTestId(`file-version-restore-${versions[1].id}`));
    expect((await screen.findByRole("alert")).textContent).toContain("版が見つかりません");
    expect(onApplyVersion).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("対応しない種類 (画面項目など) は、版を問い合わせない", async () => {
    open({ resourceType: "screen-item", onApplyVersion: vi.fn() });
    await waitFor(() => expect(request).toHaveBeenCalledWith("editSession.listHistory", expect.anything()));
    expect(request).not.toHaveBeenCalledWith("fileVersions.list", expect.anything());
  });
});
