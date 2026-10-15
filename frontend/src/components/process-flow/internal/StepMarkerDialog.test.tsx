import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StepMarkerDialog } from "./StepMarkerDialog";

describe("StepMarkerDialog", () => {
  it("種類を選び、複数行で書いて、Enter で追加。Shift+Enter は改行。日本語の変換中の Enter は追加しない", () => {
    const onSubmit = vi.fn();
    render(<StepMarkerDialog stepLabel="3 DB アクセス" onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(screen.getByTestId("step-marker-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("step-marker-kind"), { target: { value: "question" } });
    const body = screen.getByTestId("step-marker-body");
    fireEvent.change(body, { target: { value: "1 行目\n2 行目" } });
    fireEvent.keyDown(body, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(body, { key: "Enter", isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(body, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("1 行目\n2 行目", "question");
  });

  it("追加ボタンでも追加できる / Esc で閉じる / 対象の工程が見出しに出る", () => {
    const onSubmit = vi.fn(); const onClose = vi.fn();
    render(<StepMarkerDialog stepLabel="3 DB アクセス" onSubmit={onSubmit} onClose={onClose} />);
    expect(screen.getByText("3 DB アクセス")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("step-marker-body"), { target: { value: "  直して  " } });
    fireEvent.click(screen.getByTestId("step-marker-submit"));
    expect(onSubmit).toHaveBeenCalledWith("直して", "todo");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
