import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SaveConflictDialog } from "./SaveConflictDialog";

const conflict = { editSessionId: "es-1", savedBy: "sess-a", savedAt: "2026-10-13T05:00:00.000Z", displayLabel: "田中" };

describe("SaveConflictDialog (上書き確認 / last-save-wins)", () => {
  it("相手の名前と、上書きすると相手の内容が失われることを示す", () => {
    render(<SaveConflictDialog conflict={conflict} onOverwrite={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog").textContent).toContain("田中");
    expect(screen.getByRole("dialog").textContent).toContain("相手の保存済み内容は失われます");
  });
  it("「上書きする」で onOverwrite、「キャンセル」・閉じる・外側のクリックで onCancel。キャンセルでは上書きしない", () => {
    const onOverwrite = vi.fn(), onCancel = vi.fn();
    render(<SaveConflictDialog conflict={conflict} onOverwrite={onOverwrite} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId("save-conflict-cancel"));
    fireEvent.click(screen.getByLabelText("閉じる"));
    fireEvent.click(screen.getByRole("presentation")); // 外側
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onOverwrite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("overwrite-confirm-btn"));
    expect(onOverwrite).toHaveBeenCalledTimes(1);
  });
  it("日時が不正でも、落ちずに値をそのまま出す", () => {
    render(<SaveConflictDialog conflict={{ ...conflict, savedAt: "not-a-date" }} onOverwrite={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
