import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResumeOrDiscardDialog } from "./ResumeOrDiscardDialog";

describe("ResumeOrDiscardDialog (前回の編集の続き)", () => {
  it("続ける / 破棄して本体を読み込む / キャンセルを、それぞれ呼び分ける", () => {
    const h = { onResume: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() };
    render(<ResumeOrDiscardDialog {...h} />);
    fireEvent.click(screen.getByTestId("resume-continue"));
    expect(h.onResume).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("resume-discard"));
    expect(h.onDiscard).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("resume-cancel"));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });
  it("Esc でキャンセル (破棄はしない)。ダイアログにフォーカスが移る", () => {
    const h = { onResume: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() };
    render(<ResumeOrDiscardDialog {...h} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onDiscard).not.toHaveBeenCalled();
  });
});
