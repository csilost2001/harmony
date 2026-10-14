import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const request = vi.fn(async () => ({ hits: [] }));
vi.mock("../../mcp/mcpBridge", () => ({ mcpBridge: { request: (...a: unknown[]) => request(...(a as [])) } }));
vi.mock("./loadSources", async () => {
  const actual = await vi.importActual<typeof import("./loadSources")>("./loadSources");
  return { ...actual, loadQuickOpenSources: async () => ({ tables: [{ id: "orders", name: "注文" }, { id: "items", name: "商品" }], screens: [{ id: "cart", name: "カート" }] }) };
});

import { QuickOpen } from "./QuickOpen";
import { _resetFavoritesCache, loadFavorites, toggleFavorite } from "../../utils/favorites";
import { _resetForTests, makeTabId, openTab } from "../../store/tabStore";
import { getAppThemePref, setAppThemePref } from "../../theme/appTheme";

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }
const mount = () => render(
  <MemoryRouter initialEntries={["/w/ws1/"]}>
    <Routes><Route path="/w/:wsId/*" element={<><QuickOpen /><Where /></>} /></Routes>
  </MemoryRouter>,
);
const open = () => { fireEvent.click(screen.getByTestId("quick-open-trigger")); };

describe("QuickOpen (クイックオープン / コマンドパレット / お気に入り)", () => {
  beforeEach(() => { localStorage.clear(); _resetFavoritesCache(); _resetForTests(); setAppThemePref("light"); request.mockClear(); });

  it("名前で探して Enter で開く。検索語が空のときは、お気に入りが先頭に出る", async () => {
    toggleFavorite("ws1", "table:items");
    mount(); open();
    await waitFor(() => expect(screen.getAllByTestId("quick-open-item").length).toBeGreaterThan(1));
    expect(screen.getAllByTestId("quick-open-item")[0].getAttribute("data-key")).toBe("table:items");
    fireEvent.change(screen.getByTestId("quick-open-input"), { target: { value: "注文" } });
    await waitFor(() => expect(screen.getAllByTestId("quick-open-item")[0].getAttribute("data-key")).toBe("table:orders"));
    fireEvent.keyDown(screen.getByTestId("quick-open-input"), { key: "Enter" });
    expect(screen.getByTestId("where").textContent).toBe("/w/ws1/table/edit/orders");
  });

  it("★ と Ctrl+D で、お気に入りに追加・解除する (開かない)", async () => {
    mount(); open();
    await waitFor(() => screen.getAllByTestId("quick-open-item"));
    const first = screen.getAllByTestId("quick-open-item")[0];
    fireEvent.click(first.querySelector('[data-testid="quick-open-star"]')!);
    expect(loadFavorites("ws1")).toHaveLength(1);
    expect(screen.getByTestId("where").textContent).toBe("/w/ws1/");
    fireEvent.keyDown(screen.getByTestId("quick-open-input"), { key: "d", ctrlKey: true });
    expect(loadFavorites("ws1")).toHaveLength(0);
  });

  it("「>」で操作だけを出し、Enter で実行する (配色)。操作の無い語では、「一致する操作はありません」", async () => {
    mount(); open();
    fireEvent.change(screen.getByTestId("quick-open-input"), { target: { value: ">ダーク" } });
    const cmd = await screen.findByTestId("quick-open-command");
    expect(cmd.getAttribute("data-command")).toBe("theme-dark");
    expect(screen.queryAllByTestId("quick-open-item")).toHaveLength(0);
    fireEvent.keyDown(screen.getByTestId("quick-open-input"), { key: "Enter" });
    expect(getAppThemePref()).toBe("dark");
    open();
    fireEvent.change(screen.getByTestId("quick-open-input"), { target: { value: ">zzzzzz" } });
    expect(screen.getByTestId("quick-open-empty").textContent).toContain("一致する操作はありません");
  });

  it("「>」なしでも、検索語に合う操作は、名前の候補の後ろに出る。いまのタブへの操作 (保存) は、未保存のときだけ", async () => {
    act(() => { openTab({ id: makeTabId("table", "orders"), type: "table", resourceId: "orders", label: "注文" }); });
    mount(); open();
    fireEvent.change(screen.getByTestId("quick-open-input"), { target: { value: "配色" } });
    await screen.findAllByTestId("quick-open-command");
    expect(screen.getByTestId("quick-open-command-head")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("quick-open-input"), { target: { value: ">ほぞん" } });
    expect(screen.queryAllByTestId("quick-open-command")).toHaveLength(0);
  });

  it("Ctrl+Shift+P は、「>」つきで開く。Ctrl+K はもう一度で閉じる", () => {
    mount();
    fireEvent.keyDown(document, { key: "P", ctrlKey: true, shiftKey: true });
    expect((screen.getByTestId("quick-open-input") as HTMLInputElement).value).toBe(">");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(screen.getByTestId("quick-open-input"), { key: "Escape" });
    expect(screen.queryByTestId("quick-open")).toBeNull();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("quick-open")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.queryByTestId("quick-open")).toBeNull();
  });
});
