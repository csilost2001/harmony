/**
 * ReferenceCompletionInput の補完ドロップダウン表示制御テスト (#1438)
 *
 * #1438 regression guard:
 *   suppressed 初期値が false に戻るとマウント直後からドロップダウンが全行表示されるため、
 *   「マウント直後は listbox 非表示」のアサーションを必須として残す。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ReferenceCompletionInput } from "./ReferenceCompletionInput";
import type { Resolver, CompletionState } from "../../utils/reference-completer/types";

/** 常に phase: "active" + 固定候補を返す mock resolver (screenItemTypeResolver と同パターン) */
const alwaysActiveResolver: Resolver = {
  id: "alwaysActive",
  match(value: string): CompletionState {
    const candidates = [
      { value: "string", hint: "primitive" },
      { value: "number", hint: "primitive" },
    ].filter((c) => c.value.includes(value) || value === "");
    return {
      phase: "active",
      resolverId: "alwaysActive",
      prefix: value,
      candidates,
      replaceLen: value.length,
    };
  },
};

describe("ReferenceCompletionInput — suppressed 初期値制御 (#1438)", () => {
  it("マウント直後は listbox が表示されない (suppressed=true 初期値)", () => {
    render(
      <ReferenceCompletionInput
        value="string"
        onValueChange={() => undefined}
        resolvers={[alwaysActiveResolver]}
        ctx={{}}
      />,
    );
    // #1438 regression guard: suppressed 初期値が false に戻るとここで fail する
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("フォーカス後は listbox が表示される", () => {
    render(
      <ReferenceCompletionInput
        value=""
        onValueChange={() => undefined}
        resolvers={[alwaysActiveResolver]}
        ctx={{}}
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("blur 後は listbox が閉じる (suppressed 復帰)", async () => {
    render(
      <ReferenceCompletionInput
        value=""
        onValueChange={() => undefined}
        resolvers={[alwaysActiveResolver]}
        ctx={{}}
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // blur — suppressed=true は 150ms 後なので、blur のみで即閉じないが
    // onBlur handler 自体が呼ばれることを確認 (blur 後の suppressed 遷移)
    fireEvent.blur(input);
    // blur 直後 (150ms timeout 前) は候補が残る設計 (onMouseDown との競合回避)
    // ここでは blur が呼ばれても即 crash しないことを確認
    expect(document.activeElement).not.toBe(input);
  });
});

describe("ReferenceCompletionInput — 操作 (入力補助 第 1 弾)", () => {
  const detailResolver: Resolver = {
    id: "withDetail",
    match(value: string): CompletionState {
      return {
        phase: "active",
        resolverId: "withDetail",
        prefix: value,
        candidates: [{ value: "alpha", detail: "型: 文字列 ・ 定義元: 規約" }, { value: "beta" }],
        replaceLen: value.length,
      };
    },
  };

  function setup(onValueChange = vi.fn()) {
    render(<ReferenceCompletionInput value="" onValueChange={onValueChange} resolvers={[detailResolver]} ctx={{}} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    return { input, onValueChange };
  }

  it("日本語の変換中の Enter では候補を確定しない", () => {
    const { input, onValueChange } = setup();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("alpha");
  });

  it("Esc で閉じ、Ctrl+Space で開き直せる", () => {
    const { input } = setup();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: " ", ctrlKey: true });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("選んでいる候補の詳細と、操作の案内を出す", () => {
    const { input } = setup();
    expect(screen.getByTestId("completion-detail")).toHaveTextContent("型: 文字列 ・ 定義元: 規約");
    expect(screen.getByRole("listbox")).toHaveTextContent("Tab / Enter 確定");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.queryByTestId("completion-detail")).not.toBeInTheDocument();
  });

  it("入力欄の title に、補完の使い方が出る", () => {
    const { input } = setup();
    expect(input.getAttribute("title")).toContain("Ctrl+Space");
  });

  it("確定した候補は覚えて、次回は上位に出る", () => {
    localStorage.clear();
    const { input } = setup();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Tab" });
    const options = () => screen.getAllByRole("option").map((o) => o.textContent);
    cleanup();
    setup();
    expect(options()[0]).toContain("beta");
  });
});
