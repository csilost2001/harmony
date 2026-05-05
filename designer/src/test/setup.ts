import "@testing-library/jest-dom";

// jsdom が実装していない API のモック (Puck / @grapesjs/react が require)
// vi はグローバル提供 (vitest.config: globals=true) なので type-only assertion で十分。
class ResizeObserverMock {
  observe(): void { /* no-op */ }
  unobserve(): void { /* no-op */ }
  disconnect(): void { /* no-op */ }
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock;
}

// localStorage のモック（jsdom は実装済みだがテスト間でリセット）
beforeEach(() => {
  localStorage.clear();
});
