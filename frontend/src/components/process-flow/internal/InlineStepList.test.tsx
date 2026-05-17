import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { InlineStepList } from "./InlineStepList";
import type { Step } from "../../../types/action";

/**
 * InlineStepList: StepCard.tsx から抽出 (#1145)。
 *
 * branch/loop の steps 配列を再帰レンダリングし、追加ボタンと型ピッカーから
 * 新規 step を生成できる。本テストは、step 0 件で picker トグルが正しく
 * 動作することと、`readOnly` で追加 UI が消えることを確認する。
 *
 * StepCard 自体は別レベルでテスト対象 — 当 spec では list ラッパー責務に絞る。
 */
describe("InlineStepList", () => {
  const baseProps = {
    parentLabel: "L",
    allSteps: [] as Step[],
    tables: [],
    screens: [],
    commonGroups: [],
    onNavigateCommon: () => {},
  };

  it("steps 空 + readOnly=false でステップ追加ボタンを表示", () => {
    const { container } = render(
      <InlineStepList
        {...baseProps}
        steps={[]}
        onChange={() => {}}
      />,
    );
    const addBtn = container.querySelector(".inline-add-btn");
    expect(addBtn).not.toBeNull();
    expect(addBtn?.textContent).toContain("ステップを追加");
  });

  it("readOnly=true で追加 UI を非表示", () => {
    const { container } = render(
      <InlineStepList
        {...baseProps}
        steps={[]}
        onChange={() => {}}
        readOnly
      />,
    );
    expect(container.querySelector(".inline-add-btn")).toBeNull();
    expect(container.querySelector(".inline-step-add")).toBeNull();
  });

  it("追加ボタンを押すと型ピッカーが開き、22 種の kind が選べる", () => {
    const { container } = render(
      <InlineStepList
        {...baseProps}
        steps={[]}
        onChange={() => {}}
      />,
    );
    const addBtn = container.querySelector(".inline-add-btn") as HTMLButtonElement;
    fireEvent.click(addBtn);

    const picker = container.querySelector(".inline-type-picker");
    expect(picker).not.toBeNull();
    const typeButtons = picker?.querySelectorAll(".inline-type-btn");
    // ALL_SUB_STEP_TYPES は 22 種
    expect(typeButtons?.length).toBe(22);
  });

  it("型ピッカーから kind を選択すると onChange + onCommit が呼ばれる", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(
      <InlineStepList
        {...baseProps}
        steps={[]}
        onChange={onChange}
        onCommit={onCommit}
      />,
    );
    fireEvent.click(container.querySelector(".inline-add-btn") as HTMLButtonElement);
    const firstType = container.querySelector(".inline-type-btn") as HTMLButtonElement;
    fireEvent.click(firstType);

    expect(onChange).toHaveBeenCalledTimes(1);
    const newSteps = onChange.mock.calls[0][0];
    expect(Array.isArray(newSteps)).toBe(true);
    expect(newSteps.length).toBe(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
