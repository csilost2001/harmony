import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResourceLoading, ViewLoading } from "./ResourceLoading";

describe("読み込み中の表示", () => {
  it("リソースの種類ごとの文言を、読み上げ可能 (role=status) で出す", () => {
    render(<ResourceLoading kind="table" />);
    expect(screen.getByRole("status").textContent).toContain("テーブルを読み込んでいます");
  });
  it("画面の部品 (遅延読み込み) を読み込む間の表示も、読み上げ可能", () => {
    render(<ViewLoading />);
    expect(screen.getByTestId("view-loading").getAttribute("role")).toBe("status");
    expect(screen.getByTestId("view-loading").textContent).toContain("読み込んでいます");
  });
});
