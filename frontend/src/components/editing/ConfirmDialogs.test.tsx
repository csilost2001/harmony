/**
 * 確認のダイアログ (破棄・強制解除・解除された後の選択): 押したボタンに応じた結果を返す。キャンセルで何も起きない。
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AfterForceUnlockChoiceDialog, DiscardConfirmDialog, ForceReleaseConfirmDialog, ForcedOutChoiceDialog } from "./ConfirmDialogs";

describe("確認のダイアログ", () => {
  it("破棄: 「破棄する」で onConfirm、「キャンセル」で onCancel (取り消せない旨を示す)", () => {
    const onConfirm = vi.fn(), onCancel = vi.fn();
    render(<DiscardConfirmDialog onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText(/元に戻せません/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("discard-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("discard-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("強制解除: 相手の名前を出し、確認・キャンセルできる", () => {
    const onConfirm = vi.fn(), onCancel = vi.fn();
    render(<ForceReleaseConfirmDialog ownerSessionId="sess-1" ownerLabel="田中" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText("田中")).toBeTruthy();
    fireEvent.click(screen.getByTestId("force-release-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("force-release-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("編集権限が解除された: 下書きがあるときだけ「採用する」を出す。選んだ結果を返す", () => {
    const onChoice = vi.fn();
    const { rerender } = render(<ForcedOutChoiceDialog previousDraftExists={false} onChoice={onChoice} />);
    expect(screen.queryByTestId("forced-out-adopt")).toBeNull();
    fireEvent.click(screen.getByTestId("forced-out-continue"));
    expect(onChoice).toHaveBeenLastCalledWith("continue");
    rerender(<ForcedOutChoiceDialog previousDraftExists onChoice={onChoice} />);
    fireEvent.click(screen.getByTestId("forced-out-adopt"));
    expect(onChoice).toHaveBeenLastCalledWith("adopt");
    fireEvent.click(screen.getByTestId("forced-out-discard"));
    expect(onChoice).toHaveBeenLastCalledWith("discard");
  });

  it("強制解除の完了後: 破棄 / 採用を選べる", () => {
    const onChoice = vi.fn();
    render(<AfterForceUnlockChoiceDialog previousOwner="sess-9" onChoice={onChoice} />);
    fireEvent.click(screen.getByTestId("after-force-unlock-adopt"));
    expect(onChoice).toHaveBeenLastCalledWith("adopt");
    fireEvent.click(screen.getByTestId("after-force-unlock-discard"));
    expect(onChoice).toHaveBeenLastCalledWith("discard");
  });
});
