/**
 * 独自部品の編集 (ComponentEditor): 部品を置くと、置いた部品が選択される (変更の関数は、その場で適用される)・元に戻す / やり直す・未保存の印。
 * (以前、元に戻す履歴を state の更新関数で持つ作りにしたとき、「置いた部品の id を、関数の中で決めて、すぐあとで選択する」が空振りして、
 *  置いた部品が選択されなかった。E2E (layout-components.spec.ts) でしか気づけなかったので、単体でも見張る。)
 */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { LayoutComponentDef } from "@harmony/shared";
import { ComponentEditor } from "./ComponentEditor";

const initial: LayoutComponentDef = { id: "notice-box", label: "お知らせ", params: [], nodes: [] };
const setup = () => render(<ComponentEditor initial={initial} isNew={false} others={[]} screens={[]} onSave={vi.fn(async () => undefined)} onClose={vi.fn()} />);

describe("ComponentEditor", () => {
  it("部品 (文章) を置くと、置いた部品が選択され、インスペクタで文言を編集できる", () => {
    setup();
    const editor = screen.getByTestId("component-editor");
    expect(within(editor).queryByLabelText?.("文章")).toBeNull();
    fireEvent.click(within(editor).getByTestId("layout-part-text"));
    // 選択された文章の部品の編集欄 (#sld-text) が出る
    expect(editor.querySelector("#sld-text")).not.toBeNull();
  });

  it("1 回の操作 (同じ描画の前) に続けて 2 つ置いても、2 つとも置かれる (変更の関数は、その場で最新の状態へ適用する)", () => {
    setup();
    const editor = screen.getByTestId("component-editor");
    act(() => {
      (within(editor).getByTestId("layout-part-text") as HTMLElement).click();
      (within(editor).getByTestId("layout-part-heading") as HTMLElement).click();
    });
    expect(editor.querySelector('section[aria-label$="(2 部品)"]')).not.toBeNull();
    // 最後に置いた部品 (見出し。階層の選択がある) が選択されている (文章の「調子」ではない)
    expect(editor.querySelector("#sld-level")).not.toBeNull();
    expect(editor.querySelector("#sld-tone")).toBeNull();
  });

  it("置くと「保存」が押せる (未保存の印)。元に戻すと、置く前になり、やり直すと戻る", () => {
    setup();
    const editor = screen.getByTestId("component-editor");
    const save = within(editor).getByTestId("component-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true); // 変更なし
    const undo = within(editor).getByTitle("元に戻す") as HTMLButtonElement;
    const redo = within(editor).getByTitle("やり直す") as HTMLButtonElement;
    expect(undo.disabled).toBe(true);

    fireEvent.click(within(editor).getByTestId("layout-part-text"));
    expect(save.disabled).toBe(false);
    expect(undo.disabled).toBe(false);

    fireEvent.click(undo);
    expect(save.disabled).toBe(true); // 置く前に戻った (保存済みの内容と同じ)
    expect(redo.disabled).toBe(false);
    fireEvent.click(redo);
    expect(save.disabled).toBe(false);
  });

  it("表示名の入力は、入力中は履歴に積まず、確定 (blur) で 1 件積む", () => {
    setup();
    const editor = screen.getByTestId("component-editor");
    const undo = within(editor).getByTitle("元に戻す") as HTMLButtonElement;
    const label = within(editor).getByTestId("component-label");
    fireEvent.change(label, { target: { value: "お知らせ2" } });
    fireEvent.change(label, { target: { value: "お知らせ23" } });
    expect(undo.disabled).toBe(true);
    fireEvent.blur(label);
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect((label as HTMLInputElement).value).toBe("お知らせ");
  });
});
