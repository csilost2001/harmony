import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FavoritesMenu } from "./FavoritesMenu";
import { FavoritesPanel } from "../dashboard/panels/FavoritesPanel";
import { _resetFavoritesCache, loadFavorites, toggleFavorite } from "../../utils/favorites";
import { _resetForTests, makeTabId, openTab } from "../../store/tabStore";

vi.mock("../quick-open/loadSources", async () => {
  const actual = await vi.importActual<typeof import("../quick-open/loadSources")>("../quick-open/loadSources");
  return { ...actual, loadQuickOpenSources: async () => ({ tables: [{ id: "orders", name: "注文" }], screens: [{ id: "cart", name: "カート" }] }) };
});

const wrap = (ui: React.ReactNode) => render(<MemoryRouter initialEntries={["/w/ws1/"]}><Routes><Route path="/w/:wsId/*" element={ui} /></Routes></MemoryRouter>);

describe("お気に入り (ヘッダーとダッシュボード)", () => {
  beforeEach(() => { localStorage.clear(); _resetFavoritesCache(); _resetForTests(); });

  it("いま開いている設計を、ここから追加・解除できる。固定したものは名前つきで一覧に出る", async () => {
    openTab({ id: makeTabId("table", "orders"), type: "table", resourceId: "orders", label: "注文" });
    wrap(<FavoritesMenu />);
    fireEvent.click(screen.getByTestId("favorites-open"));
    expect(screen.getByText(/お気に入りはまだありません/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("favorites-toggle"));
    expect(loadFavorites("ws1")).toEqual(["table:orders"]);
    await waitFor(() => expect(screen.getByTestId("favorites-item").textContent).toContain("注文"));
    fireEvent.click(screen.getByRole("button", { name: "注文をお気に入りから外す" }));
    expect(loadFavorites("ws1")).toEqual([]);
  });

  it("消えた設計は「見つかりません」と出し、外せる。設計でないタブでは、追加のボタンは出ない", async () => {
    toggleFavorite("ws1", "table:gone");
    openTab({ id: makeTabId("dashboard", "main"), type: "dashboard", resourceId: "main", label: "ダッシュボード" });
    wrap(<FavoritesMenu />);
    fireEvent.click(screen.getByTestId("favorites-open"));
    expect(screen.queryByTestId("favorites-toggle")).toBeNull();
    await waitFor(() => expect(screen.getByText("見つかりません")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /をお気に入りから外す/ }));
    expect(loadFavorites("ws1")).toEqual([]);
  });

  it("Esc で閉じる", () => {
    wrap(<FavoritesMenu />);
    fireEvent.click(screen.getByTestId("favorites-open"));
    fireEvent.keyDown(screen.getByTestId("favorites-open"), { key: "Escape" });
    expect(screen.queryByTestId("favorites-pop")).toBeNull();
  });

  it("ダッシュボードのパネルは、空なら案内、あれば名前つきの一覧", async () => {
    const { unmount } = wrap(<FavoritesPanel />);
    expect(screen.getByTestId("favorites-panel-empty")).toBeInTheDocument();
    unmount();
    toggleFavorite("ws1", "screen:cart");
    wrap(<FavoritesPanel />);
    await waitFor(() => expect(screen.getByTestId("favorites-panel-item").textContent).toContain("カート"));
  });
});
