/**
 * handleRenameSuccess unit test (#1298 I-6 follow-up, S-4)
 *
 * RenameEntityDialog の onSuccess / RenameEntityUndoToast の onUndo から呼ばれる helper を
 * tabStore + navigate mock で順序検証する。
 *
 * 検証ポイント:
 *   - rename 経路: closeTab(oldTabId, true) → openTab(newTabId) → navigate(wsPath(editRoute(newId)))
 *   - undo 経路: 同 helper を oldId/newId 反転で呼ぶことで、new → old へ完全に戻る
 *   - entity 種別 (table/screen/processFlow) ごとの tabType / editRoute mapping が正しく反映される
 *   - label 未指定 / 空文字時の fallback (newId)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// tabStore を module mock 化 (各関数の呼出順序を spy で記録)
vi.mock("../store/tabStore", () => ({
  closeTab: vi.fn(),
  openTab: vi.fn(),
  makeTabId: (type: string, id: string) => `${type}:${id}`,
}));

// Phase J Must-fix E: tableStore local pubsub も mock 化 (table rename で emit されることを assert)
vi.mock("../store/tableStore", () => ({
  _emitTableChangeForRename: vi.fn(),
}));

import { closeTab, openTab } from "../store/tabStore";
import { _emitTableChangeForRename } from "../store/tableStore";
import { handleRenameSuccess } from "./handleRenameSuccess";

const closeTabMock = vi.mocked(closeTab);
const openTabMock = vi.mocked(openTab);
const emitTableMock = vi.mocked(_emitTableChangeForRename);

beforeEach(() => {
  closeTabMock.mockReset();
  openTabMock.mockReset();
  emitTableMock.mockReset();
});

describe("handleRenameSuccess", () => {
  it("rename 経路: closeTab(old, force=true) → openTab(new) → navigate(wsPath(/table/edit/new)) の順序で呼ばれる", () => {
    const navigate = vi.fn();
    const wsPath = vi.fn((p: string) => `/w/ws1${p}`);
    const callOrder: string[] = [];
    closeTabMock.mockImplementation(() => { callOrder.push("closeTab"); return true; });
    openTabMock.mockImplementation(() => { callOrder.push("openTab"); });
    navigate.mockImplementation(() => { callOrder.push("navigate"); });

    handleRenameSuccess({
      entityType: "table",
      oldId: "products",
      newId: "products-v2",
      label: "商品マスタ",
      navigate,
      wsPath,
    });

    // 呼出順序
    expect(callOrder).toEqual(["closeTab", "openTab", "navigate"]);

    // closeTab: old tab id + force=true
    expect(closeTabMock).toHaveBeenCalledTimes(1);
    expect(closeTabMock).toHaveBeenCalledWith("table:products", true);

    // openTab: new tab item
    expect(openTabMock).toHaveBeenCalledTimes(1);
    expect(openTabMock).toHaveBeenCalledWith({
      id: "table:products-v2",
      type: "table",
      resourceId: "products-v2",
      label: "商品マスタ",
    });

    // navigate: wsPath で workspace prefix された URL に replace=true
    expect(wsPath).toHaveBeenCalledWith("/table/edit/products-v2");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/w/ws1/table/edit/products-v2", { replace: true });
  });

  it("undo 経路 (rename と oldId/newId 反転で呼ぶ): new → old に完全に戻る", () => {
    const navigate = vi.fn();
    const wsPath = (p: string) => p;

    // 呼出: 先程の rename を逆向きに (new=products-v2 を old に、old=products を new に)
    handleRenameSuccess({
      entityType: "table",
      oldId: "products-v2", // 直前 rename 後の id
      newId: "products",    // 元に戻す id
      label: "商品マスタ",
      navigate,
      wsPath,
    });

    expect(closeTabMock).toHaveBeenCalledWith("table:products-v2", true);
    expect(openTabMock).toHaveBeenCalledWith({
      id: "table:products",
      type: "table",
      resourceId: "products",
      label: "商品マスタ",
    });
    expect(navigate).toHaveBeenCalledWith("/table/edit/products", { replace: true });
  });

  it("entity 種別ごとに tabType / editRoute が切り替わる (screen)", () => {
    const navigate = vi.fn();
    const wsPath = (p: string) => p;

    handleRenameSuccess({
      entityType: "screen",
      oldId: "dashboard",
      newId: "home",
      label: "ホーム",
      navigate,
      wsPath,
    });

    expect(closeTabMock).toHaveBeenCalledWith("design:dashboard", true);
    expect(openTabMock).toHaveBeenCalledWith({
      id: "design:home",
      type: "design",
      resourceId: "home",
      label: "ホーム",
    });
    expect(navigate).toHaveBeenCalledWith("/screen/design/home", { replace: true });
  });

  it("entity 種別ごとに tabType / editRoute が切り替わる (processFlow)", () => {
    const navigate = vi.fn();
    const wsPath = (p: string) => p;

    handleRenameSuccess({
      entityType: "processFlow",
      oldId: "order-create",
      newId: "place-order",
      label: "注文登録",
      navigate,
      wsPath,
    });

    expect(closeTabMock).toHaveBeenCalledWith("process-flow:order-create", true);
    expect(openTabMock).toHaveBeenCalledWith({
      id: "process-flow:place-order",
      type: "process-flow",
      resourceId: "place-order",
      label: "注文登録",
    });
    expect(navigate).toHaveBeenCalledWith("/process-flow/edit/place-order", { replace: true });
  });

  it("label が空文字の場合は newId を fallback として使う", () => {
    const navigate = vi.fn();
    const wsPath = (p: string) => p;

    handleRenameSuccess({
      entityType: "table",
      oldId: "products",
      newId: "products-v2",
      label: "",
      navigate,
      wsPath,
    });

    expect(openTabMock).toHaveBeenCalledWith({
      id: "table:products-v2",
      type: "table",
      resourceId: "products-v2",
      label: "products-v2",
    });
  });

  // Phase J Must-fix E (#1298 round 4 Antigravity M-7)
  it("table rename 経路で _emitTableChangeForRename({tableId: newId}) が呼ばれる", () => {
    handleRenameSuccess({
      entityType: "table",
      oldId: "old-tbl",
      newId: "new-tbl",
      label: "Tbl",
      navigate: vi.fn(),
      wsPath: (p) => p,
    });
    expect(emitTableMock).toHaveBeenCalledTimes(1);
    expect(emitTableMock).toHaveBeenCalledWith({ tableId: "new-tbl" });
  });

  it("table 以外の entity type では _emitTableChangeForRename は呼ばれない", () => {
    handleRenameSuccess({
      entityType: "screen",
      oldId: "old-scr",
      newId: "new-scr",
      label: "Scr",
      navigate: vi.fn(),
      wsPath: (p) => p,
    });
    expect(emitTableMock).not.toHaveBeenCalled();
  });

  it("undo 経路 (rename と oldId/newId 反転) でも table の場合 emit される (newId = 戻った後の id)", () => {
    handleRenameSuccess({
      entityType: "table",
      oldId: "new-tbl",  // 直前 rename 後の id
      newId: "old-tbl",  // 元に戻す id
      label: "Tbl",
      navigate: vi.fn(),
      wsPath: (p) => p,
    });
    expect(emitTableMock).toHaveBeenCalledTimes(1);
    expect(emitTableMock).toHaveBeenCalledWith({ tableId: "old-tbl" });
  });
});
