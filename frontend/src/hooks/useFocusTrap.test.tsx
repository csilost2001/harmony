import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { useFocusTrap } from "./useFocusTrap";

function Dialog() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="dialog">
      <button data-testid="a">A</button>
      <button data-testid="b">B</button>
      <button data-testid="c" disabled>C</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("開いたら最初の要素へ。Tab は中で循環し、Shift+Tab は逆に回る", () => {
    render(<><button data-testid="outside">外</button><Dialog /></>);
    expect(document.activeElement).toBe(screen.getByTestId("a"));
    screen.getByTestId("b").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("a"));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId("b"));
  });

  it("閉じたら、開く前にフォーカスしていた要素へ戻す", () => {
    const { rerender } = render(<button data-testid="opener">開く</button>);
    screen.getByTestId("opener").focus();
    rerender(<><button data-testid="opener">開く</button><Dialog /></>);
    expect(document.activeElement).toBe(screen.getByTestId("a"));
    rerender(<button data-testid="opener">開く</button>);
    expect(document.activeElement).toBe(screen.getByTestId("opener"));
  });
});
