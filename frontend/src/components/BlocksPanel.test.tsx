import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { BlocksPanel } from "./BlocksPanel";
import "../styles/app.css";

vi.mock("@grapesjs/react", () => ({
  useEditorMaybe: () => null,
}));

vi.mock("../store/customBlockStore", () => ({
  deleteCustomBlock: vi.fn(),
}));

vi.mock("./SharedBlockSyncModal", () => ({
  SharedBlockSyncModal: () => null,
}));

type FakeBlock = {
  getId: () => string;
  get: (key: string) => unknown;
};

function makeBlock(id: string, label: string): FakeBlock {
  return {
    getId: () => id,
    get: (key: string) => {
      if (key === "label") return label;
      if (key === "media") return "<svg viewBox=\"0 0 16 16\"><rect width=\"16\" height=\"16\" /></svg>";
      if (key === "content") return `<div>${label}</div>`;
      return undefined;
    },
  };
}

describe("BlocksPanel", () => {
  it("keeps the high-count block palette scroll contract in DOM and CSS", () => {
    const mapCategoryBlocks = new Map<string, FakeBlock[]>();
    mapCategoryBlocks.set(
      "大量ブロック",
      Array.from({ length: 120 }, (_, i) => makeBlock(`block-${i + 1}`, `ブロック ${i + 1}`)),
    );

    const { container } = render(
      <BlocksPanel
        mapCategoryBlocks={mapCategoryBlocks as never}
        blocks={[] as never}
        Container={({ children }: { children: ReactNode }) => <>{children}</>}
        dragStart={vi.fn()}
        dragStop={vi.fn()}
      />,
    );

    expect(screen.getByText("ブロック 120")).toBeInTheDocument();
    expect(container.querySelector(".blocks-list-scroll-end")).toBeInTheDocument();
    expect(container.querySelector(".blocks-list-scroll-end")).toHaveAttribute("aria-hidden", "true");

    const appCss = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
    expect(appCss).toMatch(/\.blocks-list\s*{[^}]*overflow-y:\s*auto;/s);
    expect(appCss).toMatch(/\.blocks-list\s*{[^}]*overscroll-behavior:\s*contain;/s);
    expect(appCss).toMatch(/\.blocks-list\s*{[^}]*scrollbar-gutter:\s*stable;/s);
    expect(appCss).toMatch(/\.blocks-list-scroll-end\s*{[^}]*height:\s*max\(56px,\s*env\(safe-area-inset-bottom\)\);/s);
  });
});
