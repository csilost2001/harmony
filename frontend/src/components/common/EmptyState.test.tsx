import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("何も無いときは、見出し・ひとこと・最初の 1 件を作るボタンを出す", () => {
    const onCreate = vi.fn();
    render(<EmptyState noun="画面" icon="bi-window" hint="画面を設計します" onCreate={onCreate} createLabel="画面を追加" />);
    expect(screen.getByText("画面がまだありません")).toBeInTheDocument();
    expect(screen.getByText("画面を設計します")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("empty-state-create"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("empty-state-clear")).toBeNull();
  });

  it("検索で 0 件のときは、該当なしと絞り込みの解除を出し、作成のボタンは出さない", () => {
    const onClear = vi.fn();
    render(<EmptyState noun="テーブル定義" filtered onCreate={() => undefined} onClear={onClear} hint="使わない" />);
    expect(screen.getByText("該当するテーブル定義がありません")).toBeInTheDocument();
    expect(screen.queryByText("使わない")).toBeNull();
    expect(screen.queryByTestId("empty-state-create")).toBeNull();
    fireEvent.click(screen.getByTestId("empty-state-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("onCreate が無ければ (閲覧のみ)、ボタンは出さない。作成のボタンの文言は既定で「<名前>を追加」", () => {
    const { rerender } = render(<EmptyState noun="カラム" />);
    expect(screen.queryByTestId("empty-state-create")).toBeNull();
    rerender(<EmptyState noun="カラム" onCreate={() => undefined} />);
    expect(screen.getByTestId("empty-state-create").textContent).toContain("カラムを追加");
  });
});
