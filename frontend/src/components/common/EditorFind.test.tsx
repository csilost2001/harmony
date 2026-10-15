import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EditorFind } from "./EditorFind";

function page(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <EditorFind />
      <main id="app-main">
        <label>顧客名<input aria-label="name1" defaultValue="山田 customer" /></label>
        <input aria-label="name2" defaultValue="佐藤" />
        <textarea aria-label="note" defaultValue="Customer note" />
      </main>
    </MemoryRouter>,
  );
}
const ctrlF = () => fireEvent.keyDown(document, { key: "f", ctrlKey: true });
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("EditorFind", () => {
  it("編集画面では Ctrl+F で検索欄が開き、入力欄の値を探して、件数を出す", async () => {
    page("/w/ws/table/edit/orders");
    expect(screen.queryByTestId("editor-find")).toBeNull();
    ctrlF();
    const input = await screen.findByTestId("editor-find-input");
    fireEvent.change(input, { target: { value: "CUSTOMER" } });
    await wait(200);
    expect(screen.getByTestId("editor-find-count")).toHaveTextContent("1 / 2");
    expect(screen.getByLabelText("name1")).toHaveAttribute("data-find-current");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("editor-find-count")).toHaveTextContent("2 / 2");
    expect(screen.getByLabelText("note")).toHaveAttribute("data-find-current");
    expect(screen.getByLabelText("name1")).toHaveAttribute("data-find-hit"); // ほかの見つかった欄は、現在の印ではない
    expect(screen.getByLabelText("name1")).not.toHaveAttribute("data-find-current");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByTestId("editor-find-count")).toHaveTextContent("1 / 2");
  });

  it("見つからなければ案内する。Esc で閉じて、印を消し、見つけた欄へフォーカスを移す", async () => {
    page("/w/ws/screen/items/cart");
    ctrlF();
    const input = await screen.findByTestId("editor-find-input");
    fireEvent.change(input, { target: { value: "zzz" } });
    await wait(200);
    expect(screen.getByTestId("editor-find-count")).toHaveTextContent("見つかりません");
    fireEvent.change(input, { target: { value: "佐藤" } });
    await wait(200);
    expect(screen.getByLabelText("name2")).toHaveAttribute("data-find-hit");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("editor-find")).toBeNull();
    expect(document.querySelector("[data-find-hit]")).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("name2"));
  });

  it("編集画面でなければ Ctrl+F は何もしない (ブラウザの検索のまま)", () => {
    page("/w/ws/table/list");
    const ev = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByTestId("editor-find")).toBeNull();
  });

  it("日本語の変換中の Enter では移らない", async () => {
    page("/w/ws/table/edit/orders");
    ctrlF();
    const input = await screen.findByTestId("editor-find-input");
    fireEvent.change(input, { target: { value: "customer" } });
    await wait(200);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.getByTestId("editor-find-count")).toHaveTextContent("1 / 2");
  });
});
