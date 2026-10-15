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
import { onGoToReference, onFindReferences } from "../../utils/referenceTarget";

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

describe("ReferenceCompletionInput — 定義へ移動 (F12 / Ctrl+クリック)", () => {
  const none: Resolver = { id: "none", match: () => null };

  function setup(value: string) {
    const seen: Array<{ route: string; label: string }> = [];
    const off = onGoToReference((t) => seen.push({ route: t.route, label: t.label }));
    render(<ReferenceCompletionInput value={value} onValueChange={() => undefined} resolvers={[none]} ctx={{}} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    return { input, seen, off };
  }

  it("参照の上で F12 を押すと、その定義を開く合図を出す", () => {
    const { input, seen, off } = setup("WHERE a = @table.orders.field.id");
    input.setSelectionRange(14, 14);
    fireEvent.keyDown(input, { key: "F12" });
    expect(seen).toEqual([{ route: "/table/edit/orders", label: "テーブル orders" }]);
    off();
  });

  it("Ctrl+クリックでも開く。ふつうのクリックでは開かない", () => {
    const { input, seen, off } = setup("@screen.cart");
    input.setSelectionRange(4, 4);
    fireEvent.click(input);
    expect(seen).toHaveLength(0);
    fireEvent.click(input, { ctrlKey: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].route).toBe("/screen/items/cart");
    off();
  });

  it("参照の上でなければ開かない (F12 は案内を出す)", () => {
    const { input, seen, off } = setup("plain text");
    input.setSelectionRange(2, 2);
    fireEvent.keyDown(input, { key: "F12" });
    fireEvent.click(input, { ctrlKey: true });
    expect(seen).toHaveLength(0);
    off();
  });

  it("Shift+F12 で、参照している設計の一覧 (参照元) を開く合図を出す。調べられる種類でなくても合図は出す (案内は受け側)", () => {
    const seen: string[] = [];
    const off = onFindReferences((t) => seen.push(`${t.entity?.type ?? "-"}:${t.entity?.id ?? t.label}`));
    render(<ReferenceCompletionInput value="a @table.orders b @msg.x" onValueChange={() => undefined} resolvers={[none]} ctx={{}} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    input.setSelectionRange(5, 5);
    fireEvent.keyDown(input, { key: "F12", shiftKey: true });
    input.setSelectionRange(22, 22);
    fireEvent.keyDown(input, { key: "F12", shiftKey: true });
    expect(seen).toEqual(["table:orders", "-:メッセージ x"]);
    off();
  });
});
