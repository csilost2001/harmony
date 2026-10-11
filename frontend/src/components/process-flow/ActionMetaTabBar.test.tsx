import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../store/flowStore", () => ({
  loadProject: vi.fn(async () => ({ screens: [{ id: "cart", name: "カート" }, { id: "gadget1", name: "ヘッダ", purpose: "gadget" }] })),
}));
vi.mock("../../hooks/useWorkspacePath", () => ({ useWorkspacePath: () => ({ wsPath: (p: string) => p }) }));
import { ActionMetaTabBar } from "./ActionMetaTabBar";

const group = (meta: Record<string, unknown>) => ({ meta: { id: "f", name: "処理", flowType: "screen", ...meta }, actions: [] } as never);

function setup(meta: Record<string, unknown>) {
  const state = { meta: group(meta) as { meta: Record<string, unknown> } };
  const silent = vi.fn((recipe: (g: { meta: Record<string, unknown> }) => void) => recipe(state.meta));
  render(<MemoryRouter><ActionMetaTabBar group={state.meta as never} updateGroup={vi.fn()} updateGroupSilent={silent as never} /></MemoryRouter>);
  fireEvent.click(screen.getByText("基本情報"));
  return { state, silent };
}

describe("ActionMetaTabBar: 紐付け画面", () => {
  it("「画面」の処理フローでは、画面 (ガジェットを除く) を選べる。選ぶと meta.screenId、未設定に戻すと項目ごと外す", async () => {
    const { state } = setup({});
    const select = await screen.findByTestId("flow-screen-select") as HTMLSelectElement;
    await waitFor(() => expect(select.querySelectorAll("option").length).toBe(2)); // (未設定) + カート
    fireEvent.change(select, { target: { value: "cart" } });
    expect(state.meta.meta.screenId).toBe("cart");
    fireEvent.change(select, { target: { value: "" } });
    expect("screenId" in state.meta.meta).toBe(false);
  });

  it("「画面」以外の処理フローには出さない", () => {
    setup({ flowType: "batch" });
    expect(screen.queryByTestId("flow-screen-select")).toBeNull();
  });
});
