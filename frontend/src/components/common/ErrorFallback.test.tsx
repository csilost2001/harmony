import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabErrorFallback, AppErrorFallback } from "./ErrorFallback";
import { saveDraft, clearDraft } from "../../utils/draftStorage";

// e2e error-dialog.spec.ts:97 「TabErrorFallback ログ表示」placeholder を Vitest 単体テストで実装。
// React Error Boundary 経由でしか発火しない fallback は props 経由 render の Vitest が確実。

describe("TabErrorFallback", () => {
  it("error.message と tabLabel が表示される", () => {
    render(
      <TabErrorFallback
        error={new Error("テスト用エラー")}
        tabLabel="テストタブ"
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/「テストタブ」を表示できませんでした/)).toBeInTheDocument();
    expect(screen.getByText("テスト用エラー")).toBeInTheDocument();
  });

  it("再試行ボタンクリックで onRetry が呼ばれる", () => {
    const onRetry = vi.fn();
    render(
      <TabErrorFallback error={new Error("e")} tabLabel="t" onRetry={onRetry} onClose={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("「このタブを閉じる」ボタンクリックで onClose が呼ばれる", () => {
    const onClose = vi.fn();
    render(
      <TabErrorFallback error={new Error("e")} tabLabel="t" onRetry={() => undefined} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "このタブを閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ErrorDetailsPanel のコピーボタンが render される (ログ表示確認)", () => {
    render(
      <TabErrorFallback
        error={new Error("e")}
        tabLabel="t"
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId("error-copy-btn")).toBeInTheDocument();
  });
});

describe("AppErrorFallback", () => {
  it("error.message が表示される", () => {
    render(<AppErrorFallback error={new Error("アプリ全体エラー")} onReset={() => undefined} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("アプリ全体エラー")).toBeInTheDocument();
  });

  it("再試行ボタンクリックで onReset が呼ばれる", () => {
    const onReset = vi.fn();
    render(<AppErrorFallback error={new Error("e")} onReset={onReset} />);
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});


describe("エラー画面からの復旧 (下書きの案内)", () => {
  it("この設計の下書きがブラウザに残っていれば、そのことを伝える", () => {
    saveDraft("table", "orders", { id: "orders" });
    try {
      render(<TabErrorFallback error={new Error("e")} tabLabel="注文" tabType="table" resourceId="orders" onRetry={() => undefined} onClose={() => undefined} />);
      expect(screen.getByTestId("error-draft-assurance").textContent).toContain("この設計の編集中の内容は、下書きとして残っています");
      expect(screen.getByTestId("error-draft-assurance").textContent).toContain("1 件");
    } finally { clearDraft("table", "orders"); }
  });

  it("ブラウザの下書きが見つからなくても、変更のたびに下書きへ保存していることと、再試行の仕方を伝える", () => {
    render(<TabErrorFallback error={new Error("e")} tabLabel="画面" tabType="design" resourceId="cart" onRetry={() => undefined} onClose={() => undefined} />);
    const t = screen.getByTestId("error-draft-assurance").textContent ?? "";
    expect(t).toContain("変更のたびに下書き");
    expect(t).toContain("再試行");
    expect(t).not.toContain("この設計の編集中の内容は");
  });

  it("アプリ全体のエラー画面にも、同じ案内が出る。状況をまとめてコピーするボタンがある", () => {
    render(<AppErrorFallback error={new Error("e")} onReset={() => undefined} />);
    expect(screen.getByTestId("error-draft-assurance")).toBeInTheDocument();
    expect(screen.getByTestId("error-copy-btn").textContent).toContain("状況をまとめてコピー");
  });
});
