import "@testing-library/jest-dom";

// React 18 act() 環境フラグ (jsdom 環境では act() 警告を正確に発するために必要)
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
