/**
 * 編集の帯 (EditModeToolbar): 状態ごとの表示と、保存・破棄・編集開始の操作。
 * 「画面を開いただけでは原本を書き換えない (明示保存)」の入口なので、閲覧中は編集開始だけ、変更が無ければ保存を押せない、を見張る。
 */
import { describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditModeToolbar } from "./EditModeToolbar";
import type { EditMode } from "../../hooks/useEditSession";

const setup = (mode: EditMode, extra: Partial<Parameters<typeof EditModeToolbar>[0]> = {}) => {
  const h = { onStartEditing: vi.fn(), onSave: vi.fn(), onDiscardClick: vi.fn(), onForceReleaseClick: vi.fn() };
  render(<EditModeToolbar mode={mode} {...h} {...extra} />);
  return h;
};

describe("EditModeToolbar", () => {
  it("閲覧中: 「閲覧中」と「編集開始」だけ。押すと編集を始める", () => {
    const h = setup({ kind: "readonly" });
    expect(screen.getByTestId("edit-mode-state").textContent).toContain("閲覧中");
    expect(screen.queryByTestId("edit-mode-save")).toBeNull();
    fireEvent.click(screen.getByTestId("edit-mode-start"));
    expect(h.onStartEditing).toHaveBeenCalledTimes(1);
  });

  it("閲覧中: 押せない理由の案内 (押すと入力や追加ができるようになる) が、編集開始の隣に出る (ISSUE #1528 b)", () => {
    setup({ kind: "readonly" });
    expect(screen.getByTestId("edit-mode-readonly-hint").textContent).toContain("入力や追加ができるようになります");
  });

  it("編集中: 変更が無い (保存済み) ときは「編集を終える」、変更があるときは「破棄」と出る。どちらも同じ操作 (ISSUE #1528 e)", () => {
    const h1 = setup({ kind: "editing" }, { dirty: false });
    expect(screen.getByTestId("edit-mode-discard").textContent).toContain("編集を終える");
    fireEvent.click(screen.getByTestId("edit-mode-discard"));
    expect(h1.onDiscardClick).toHaveBeenCalledTimes(1);
    cleanup();
    setup({ kind: "editing" }, { dirty: true });
    expect(screen.getByTestId("edit-mode-discard").textContent).toContain("破棄");
    cleanup();
    setup({ kind: "editing" });
    expect(screen.getByTestId("edit-mode-discard").textContent).toContain("破棄");
  });

  it("編集中: 保存・破棄が押せる。変更が無い (dirty=false) あいだは保存を押せない。保存中も押せない", () => {
    const h = setup({ kind: "editing" }, { dirty: true });
    expect(screen.getByTestId("edit-mode-state").textContent).toContain("編集中");
    fireEvent.click(screen.getByTestId("edit-mode-save"));
    fireEvent.click(screen.getByTestId("edit-mode-discard"));
    expect(h.onSave).toHaveBeenCalledTimes(1);
    expect(h.onDiscardClick).toHaveBeenCalledTimes(1);
  });

  it("変更が無ければ保存は無効 (理由を title で示す)", () => {
    const h = setup({ kind: "editing" }, { dirty: false });
    const save = screen.getByTestId("edit-mode-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toContain("変更がない");
    fireEvent.click(save);
    expect(h.onSave).not.toHaveBeenCalled();
  });

  it("保存中は「保存中...」で、押せない", () => {
    setup({ kind: "editing" }, { saving: true, dirty: true });
    const save = screen.getByTestId("edit-mode-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.textContent).toContain("保存中");
  });

  it("ほかの人が編集中: 編集者の名前と「強制解除」だけ (編集開始は出ない)", () => {
    const h = setup({ kind: "locked-by-other", ownerSessionId: "sess-1234" }, { ownerLabel: "田中" });
    expect(screen.getByTestId("edit-mode-lock-info").textContent).toContain("が編集中");
    expect(screen.queryByTestId("edit-mode-start")).toBeNull();
    fireEvent.click(screen.getByTestId("edit-mode-force-release"));
    expect(h.onForceReleaseClick).toHaveBeenCalledTimes(1);
  });

  it("編集権限が解除された・強制解除後の状態は、それぞれの案内を出す", () => {
    setup({ kind: "force-released-pending", previousDraftExists: true });
    expect(screen.getByTestId("edit-mode-forced-out-notice").textContent).toContain("編集権限が解除");
  });
});
