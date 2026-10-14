import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { TourOverlay, TourHost } from "./Tour";
import { TOURS, tourForTab } from "../../utils/tours";
import { requestHeaderPanel } from "../../utils/headerPanels";
import { _resetToastHistory, getToastHistory } from "../../utils/toast";
import { _resetForTests, openTab, makeTabId } from "../../store/tabStore";

const tour = { id: "t", title: "試験", steps: [
  { target: "#target-a", title: "手順 1", body: "最初の説明" },
  { title: "手順 2", body: "要素の無い手順" },
  { target: "#nope", title: "手順 3", body: "最後の説明" },
] };

describe("TourOverlay", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("手順を 1 つずつ進め戻りでき、最後は「終わる」で閉じる", () => {
    const onClose = vi.fn();
    render(<TourOverlay tour={tour} onClose={onClose} />);
    expect(screen.getByText("手順 1")).toBeInTheDocument();
    expect(screen.getByTestId("tour-prev")).toBeDisabled();
    fireEvent.click(screen.getByTestId("tour-next"));
    expect(screen.getByText("手順 2")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tour-prev"));
    expect(screen.getByText("手順 1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tour-next"));
    fireEvent.click(screen.getByTestId("tour-next"));
    expect(screen.getByTestId("tour-next").textContent).toBe("終わる");
    fireEvent.click(screen.getByTestId("tour-next"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("キーボード: → で次、← で前、Esc で閉じる", () => {
    const onClose = vi.fn();
    render(<TourOverlay tour={tour} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByText("手順 2")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByText("手順 1")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("光らせる要素があれば、その位置に枠を出す。無い手順は、枠なしで中央に出す", () => {
    const el = document.createElement("div");
    el.id = "target-a";
    el.getBoundingClientRect = () => ({ top: 100, left: 50, width: 200, height: 40, right: 250, bottom: 140, x: 50, y: 100, toJSON: () => ({}) });
    el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList; // jsdom は表示の有無を持たないので、表示されている要素として扱う
    document.body.appendChild(el);
    render(<TourOverlay tour={tour} onClose={() => undefined} />);
    const spot = screen.getByTestId("tour-spot");
    expect(spot.style.top).toBe("96px");
    expect(spot.style.width).toBe("208px");
    fireEvent.click(screen.getByTestId("tour-next"));
    expect(screen.queryByTestId("tour-spot")).toBeNull();
    fireEvent.click(screen.getByTestId("tour-next"));
    expect(screen.queryByTestId("tour-spot")).toBeNull(); // 3 つ目の対象 (#nope) は画面に無い
    expect(screen.getByTestId("tour-card")).toBeInTheDocument();
  });
});

describe("tours の定義", () => {
  it("どのツアーも、題・手順・説明があり、手順の対象は CSS セレクタとして正しい", () => {
    for (const t of Object.values(TOURS)) {
      expect(t.steps.length, t.id).toBeGreaterThan(0);
      for (const s of t.steps) {
        expect(s.title.trim(), t.id).not.toBe("");
        expect(s.body.trim().length, t.id).toBeGreaterThan(10);
        if (s.target) expect(() => document.querySelector(s.target as string), `${t.id}: ${s.target}`).not.toThrow();
      }
    }
  });
  it("タブの種類から、ツアーを引ける。無い種類・プロパティ名では null", () => {
    expect(tourForTab("table")?.id).toBe("table");
    expect(tourForTab("er")).toBeNull();
    expect(tourForTab("__proto__")).toBeNull();
    expect(tourForTab(undefined)).toBeNull();
  });
});

describe("TourHost", () => {
  beforeEach(() => { localStorage.clear(); _resetForTests(); _resetToastHistory(); });

  it("コマンドで、いまのタブのツアーが始まる。ツアーの無いタブでは、その旨を知らせる", () => {
    act(() => { openTab({ id: makeTabId("table", "orders"), type: "table", resourceId: "orders", label: "注文" }); });
    render(<TourHost />);
    act(() => requestHeaderPanel("tour"));
    expect(screen.getByTestId("tour")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tour-close"));
    expect(screen.queryByTestId("tour")).toBeNull();
    act(() => { openTab({ id: makeTabId("er", "main"), type: "er", resourceId: "main", label: "ER 図" }); });
    act(() => requestHeaderPanel("tour"));
    expect(screen.queryByTestId("tour")).toBeNull();
    expect(getToastHistory()[0].text).toContain("操作ツアーがありません");
  });

  it("初めて開く画面で、ツアーがあることを一度だけ通知する (勝手には始めない)", async () => {
    vi.useFakeTimers();
    try {
      openTab({ id: makeTabId("table", "orders"), type: "table", resourceId: "orders", label: "注文" });
      const { unmount } = render(<TourHost />);
      expect(screen.queryByTestId("tour")).toBeNull();
      await act(async () => { vi.advanceTimersByTime(1500); });
      expect(getToastHistory().filter((t) => t.text.includes("操作ツアーがあります"))).toHaveLength(1);
      unmount();
      render(<TourHost />);
      await act(async () => { vi.advanceTimersByTime(1500); });
      expect(getToastHistory().filter((t) => t.text.includes("操作ツアーがあります"))).toHaveLength(1); // 2 度目は出さない
    } finally { vi.useRealTimers(); }
  });
});
