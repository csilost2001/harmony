import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorDialog } from "./ErrorDialog";

describe("ErrorDialog", () => {
  it("閉じているときは何も出さない", () => {
    const { container } = render(<ErrorDialog open={false} title="エラー" message="x" onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
  it("開いているとき、題名・メッセージを出し、Esc・外側のクリックで閉じる。中のクリックでは閉じない", () => {
    const onClose = vi.fn();
    render(<ErrorDialog open title="保存に失敗" message="ディスクの空き容量が足りません" onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("保存に失敗");
    expect(dialog.textContent).toContain("ディスクの空き容量が足りません");
    fireEvent.click(dialog.querySelector(".error-dialog-panel") as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
