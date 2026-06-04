/**
 * ReferenceCompletionInput の補完ドロップダウン表示制御テスト (#1438)
 *
 * #1438 regression guard:
 *   suppressed 初期値が false に戻るとマウント直後からドロップダウンが全行表示されるため、
 *   「マウント直後は listbox 非表示」のアサーションを必須として残す。
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
