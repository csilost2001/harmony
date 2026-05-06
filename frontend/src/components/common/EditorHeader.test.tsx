import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditorHeader } from "./EditorHeader";

describe("EditorHeader", () => {
  it("最小構成で header がレンダリングされる", () => {
    render(<EditorHeader />);
    const header = screen.getByTestId("editor-header");
    expect(header).toBeInTheDocument();
    expect(header.className).toContain("editor-header-light");
  });

  it("variant='dark' でダーククラスが付与される", () => {
    render(<EditorHeader variant="dark" />);
    expect(screen.getByTestId("editor-header").className).toContain("editor-header-dark");
  });

  it("backLink を渡すと戻るボタンが出る", () => {
    const onClick = vi.fn();
    render(<EditorHeader backLink={{ label: "テーブル一覧", onClick }} />);
    const btn = screen.getByTestId("editor-header-back");
    expect(btn).toHaveTextContent("テーブル一覧");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("backLink を渡さないと戻るボタンは出ない", () => {
    render(<EditorHeader />);
    expect(screen.queryByTestId("editor-header-back")).toBeNull();
  });

  it("title スロットが描画される", () => {
    render(<EditorHeader title={<span data-testid="t">タイトル</span>} />);
    expect(screen.getByTestId("t")).toBeInTheDocument();
  });

  it("centerTools スロットが描画される", () => {
    render(<EditorHeader centerTools={<div data-testid="center">中央</div>} />);
    expect(screen.getByTestId("center")).toBeInTheDocument();
  });

  it("undoRedo を渡すと Undo/Redo ボタンが出て、canUndo/canRedo=false で disabled になる", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <EditorHeader
        undoRedo={{ onUndo, onRedo, canUndo: false, canRedo: false }}
      />,
    );
    const undo = screen.getByTestId("editor-header-undo");
    const redo = screen.getByTestId("editor-header-redo");
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
  });

  it("canUndo/canRedo=true で有効化されクリックが届く", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <EditorHeader
        undoRedo={{ onUndo, onRedo, canUndo: true, canRedo: true }}
      />,
    );
    fireEvent.click(screen.getByTestId("editor-header-undo"));
    fireEvent.click(screen.getByTestId("editor-header-redo"));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("undoRedo を渡さないと Undo/Redo は描画されない", () => {
    render(<EditorHeader />);
    expect(screen.queryByTestId("editor-header-undo-redo")).toBeNull();
  });

  it("extraRight スロットが描画される", () => {
    render(<EditorHeader extraRight={<span data-testid="extra">X</span>} />);
    expect(screen.getByTestId("extra")).toBeInTheDocument();
  });

  it("saveReset を渡すと SaveResetButtons が出て、isDirty=true で保存が押せる", () => {
    const onSave = vi.fn();
    const onReset = vi.fn();
    render(
      <EditorHeader
        saveReset={{ isDirty: true, isSaving: false, onSave, onReset }}
      />,
    );
    const save = screen.getByTitle("保存 (Ctrl+S)");
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("saveReset を渡さないと SaveResetButtons は描画されない", () => {
    render(<EditorHeader />);
    expect(screen.queryByTitle("保存 (Ctrl+S)")).toBeNull();
  });
});
