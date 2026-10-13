/**
 * 編集セッションの共通表示 (EditSessionChrome): 状態に応じて、帯・ダイアログを出し分ける。
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditSessionChrome, type EditSessionChromeProps } from "./EditSessionChrome";

const base = (): EditSessionChromeProps => ({
  mode: { kind: "editing" }, saving: false, dirty: true, serverChanged: false, saveError: null,
  onDismissSaveError: vi.fn(), saveConflict: null, showDiscard: false, showForceRelease: false, showResume: false, lockedByOther: null,
  onStartEditing: vi.fn(), onSave: vi.fn(), onDiscardClick: vi.fn(), onForceReleaseClick: vi.fn(), onReloadServer: vi.fn(), onDismissServerBanner: vi.fn(),
  onForcedOutChoice: vi.fn(), onAfterForceUnlockChoice: vi.fn(), onResume: vi.fn(), onResumeDiscard: vi.fn(), onResumeCancel: vi.fn(),
  onDiscardConfirm: vi.fn(), onDiscardCancel: vi.fn(), onForceReleaseConfirm: vi.fn(), onForceReleaseCancel: vi.fn(),
  onSaveConflictOverwrite: vi.fn(), onSaveConflictCancel: vi.fn(),
});

describe("EditSessionChrome", () => {
  it("何も無ければ、帯 (編集中) だけ。ダイアログ・お知らせは出ない", () => {
    render(<EditSessionChrome {...base()} />);
    expect(screen.getByTestId("edit-mode-state").textContent).toContain("編集中");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("discard-confirm")).toBeNull();
  });

  it("他で更新された (serverChanged) ら、帯で知らせる。保存に失敗したら、理由と閉じるボタンを出す", () => {
    const p = base();
    render(<EditSessionChrome {...p} serverChanged saveError="保存できませんでした。" />);
    expect(screen.getByText("再読み込み")).toBeTruthy();
    expect(screen.getByTestId("edit-save-error").textContent).toContain("保存できませんでした");
    fireEvent.click(screen.getByLabelText("閉じる"));
    expect(p.onDismissSaveError).toHaveBeenCalledTimes(1);
  });

  it("破棄の確認 (showDiscard): 確認で onDiscardConfirm、キャンセルで onDiscardCancel", () => {
    const p = base();
    render(<EditSessionChrome {...p} showDiscard />);
    fireEvent.click(screen.getByTestId("discard-confirm"));
    expect(p.onDiscardConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("discard-cancel"));
    expect(p.onDiscardCancel).toHaveBeenCalledTimes(1);
  });

  it("強制解除の確認は、ほかの人が編集中 (lockedByOther) のときだけ出る", () => {
    const p = base();
    const { rerender } = render(<EditSessionChrome {...p} showForceRelease />);
    expect(screen.queryByTestId("force-release-confirm")).toBeNull();
    rerender(<EditSessionChrome {...p} mode={{ kind: "locked-by-other", ownerSessionId: "s1" }} lockedByOther={{ ownerSessionId: "s1" }} showForceRelease />);
    fireEvent.click(screen.getByTestId("force-release-confirm"));
    expect(p.onForceReleaseConfirm).toHaveBeenCalledTimes(1);
  });

  it("編集権限が解除された (force-released-pending) ら、選択のダイアログを出す", () => {
    const p = base();
    render(<EditSessionChrome {...p} mode={{ kind: "force-released-pending", previousDraftExists: true }} />);
    fireEvent.click(screen.getByTestId("forced-out-continue"));
    expect(p.onForcedOutChoice).toHaveBeenCalledWith("continue");
  });
});
