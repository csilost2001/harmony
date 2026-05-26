/**
 * EntityIdInput component test (RFC #1284 / ISSUE #1297)
 */

import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { EntityIdInput } from "./EntityIdInput";

// AI 提案 utility は test 用 mock に置き換える (Codex 実通信を避ける)
vi.mock("../../utils/entityIdSuggestion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/entityIdSuggestion")>();
  return {
    ...actual,
    requestAiSuggestedEntityId: vi.fn(async (opts: { name: string; existingIds?: readonly string[] }) => {
      if (opts.name === "fail") throw new Error("mock AI failure");
      // 単純な変換 mock
      return "ai-suggested-id";
    }),
  };
});

function Wrapper({ initialValue = "", existingIds = [] as string[], name = "" }) {
  const [value, setValue] = useState(initialValue);
  return (
    <EntityIdInput
      value={value}
      onChange={setValue}
      name={name}
      existingIds={existingIds}
      entityLabel="画面"
    />
  );
}

describe("EntityIdInput", () => {
  it("初期描画 — 入力 field と AI 提案ボタンと hint が出る", () => {
    render(<Wrapper />);
    expect(screen.getByTestId("entity-id-input")).toBeTruthy();
    expect(screen.getByTestId("entity-id-ai-button")).toBeTruthy();
    expect(screen.getByText(/kebab-case 英単語/)).toBeTruthy();
  });

  it("形式違反 (大文字) を入力すると format error を表示", () => {
    render(<Wrapper initialValue="" />);
    const input = screen.getByTestId("entity-id-input") as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: "Foo_Bar" } }));
    expect(screen.getByTestId("entity-id-format-error")).toBeTruthy();
    expect(input.classList.contains("is-invalid")).toBe(true);
  });

  it("有効な kebab-case を入力すると error が出ない", () => {
    render(<Wrapper />);
    const input = screen.getByTestId("entity-id-input") as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: "today-sales" } }));
    expect(screen.queryByTestId("entity-id-format-error")).toBeNull();
    expect(screen.queryByTestId("entity-id-unique-error")).toBeNull();
    expect(input.classList.contains("is-invalid")).toBe(false);
  });

  it("既存 id と衝突する場合 unique error + suffix 候補ボタンを表示", () => {
    render(<Wrapper existingIds={["today-sales"]} />);
    const input = screen.getByTestId("entity-id-input") as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: "today-sales" } }));
    expect(screen.getByTestId("entity-id-unique-error")).toBeTruthy();
    const applyBtn = screen.getByTestId("entity-id-apply-suggested");
    expect(applyBtn.textContent).toMatch(/today-sales-2/);
  });

  it("「適用」クリックで suffix 候補 (today-sales-2) が field に入る", () => {
    render(<Wrapper existingIds={["today-sales"]} />);
    const input = screen.getByTestId("entity-id-input") as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: "today-sales" } }));
    act(() => screen.getByTestId("entity-id-apply-suggested").click());
    expect(input.value).toBe("today-sales-2");
    expect(screen.queryByTestId("entity-id-unique-error")).toBeNull();
  });

  it("空 name のとき AI 提案ボタンは disabled", () => {
    render(<Wrapper name="" />);
    const btn = screen.getByTestId("entity-id-ai-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("name が入っていれば AI 提案ボタンが enable、押下で field 更新", async () => {
    render(<Wrapper name="本日売上" />);
    const btn = screen.getByTestId("entity-id-ai-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    await act(async () => {
      btn.click();
      // wait microtask
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = screen.getByTestId("entity-id-input") as HTMLInputElement;
    expect(input.value).toBe("ai-suggested-id");
  });

  it("AI 提案失敗時は error メッセージを表示", async () => {
    render(<Wrapper name="fail" />);
    const btn = screen.getByTestId("entity-id-ai-button") as HTMLButtonElement;

    await act(async () => {
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("entity-id-ai-error").textContent).toMatch(/mock AI failure/);
  });

  it("onValidationChange が format/unique/invalid 状態を通知する", () => {
    const onChange = vi.fn();
    const onVal = vi.fn();
    render(
      <EntityIdInput
        value=""
        onChange={onChange}
        name="test"
        existingIds={["existing"]}
        entityLabel="画面"
        onValidationChange={onVal}
      />,
    );
    // 初期: 空文字 → isInvalid=true
    expect(onVal).toHaveBeenLastCalledWith(
      expect.objectContaining({ isInvalid: true, isFormatValid: false }),
    );
  });

  it("Enter キー押下時 onEnter コールバック発火 (validation pass 時のみ)", () => {
    const onEnter = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(
      <EntityIdInput
        value="invalid_id"
        onChange={onChange}
        name="test"
        existingIds={[]}
        entityLabel="画面"
        onEnter={onEnter}
      />,
    );
    const input = screen.getByTestId("entity-id-input") as HTMLInputElement;
    act(() => fireEvent.keyDown(input, { key: "Enter" }));
    // invalid_id は format invalid なので onEnter 発火しない
    expect(onEnter).not.toHaveBeenCalled();

    // 有効値で再描画
    rerender(
      <EntityIdInput
        value="valid-id"
        onChange={onChange}
        name="test"
        existingIds={[]}
        entityLabel="画面"
        onEnter={onEnter}
      />,
    );
    const input2 = screen.getByTestId("entity-id-input") as HTMLInputElement;
    act(() => fireEvent.keyDown(input2, { key: "Enter" }));
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
