/**
 * puckScreenValidation.test.ts
 * puckScreenValidation の error / warning ケースを検証する。
 *
 * 仕様書: docs/spec/multi-editor-puck.md § 8
 *
 * #806 子 5
 */
import { describe, it, expect } from "vitest";
import { validatePuckScreen, type PuckScreenValidationError } from "./puckScreenValidation";
import type { Screen } from "../types/v3/screen";
import type { CustomPuckComponentDef } from "../store/puckComponentsStore";

// ── ヘルパー ───────────────────────────────────────────────────────────────────

function makeScreen(overrides?: Partial<Screen>): Screen {
  return {
    $schema: "../schemas/v3/screen.v3.schema.json",
    id: "screen-1" as Screen["id"],
    name: "テスト画面",
    createdAt: "2026-01-01T00:00:00.000Z" as Screen["createdAt"],
    updatedAt: "2026-01-01T00:00:00.000Z" as Screen["updatedAt"],
    kind: "list",
    path: "/test",
    items: [],
    design: { editorKind: "puck", puckDataRef: "screen-1.puck.json" },
    ...overrides,
  };
}

function makeValidPuckData() {
  return {
    root: { props: { padding: "md" } },
    content: [
      { type: "Heading", props: { text: "Hello" } },
    ],
  };
}

function errorsOf(errors: PuckScreenValidationError[], severity: "error" | "warning") {
  return errors.filter((e) => e.severity === severity);
}

// ── テスト ────────────────────────────────────────────────────────────────────

describe("validatePuckScreen — grapesjs 画面はスキップ", () => {
  it("editorKind=grapesjs 画面は Puck 固有チェックをスキップする", () => {
    const screen = makeScreen({ design: { editorKind: "grapesjs" } });
    const errors = validatePuckScreen(screen, [], []);
    // grapesjs 画面は puckDataRef 必須チェックを行わない
    expect(errorsOf(errors, "error")).toHaveLength(0);
  });
});

describe("validatePuckScreen — editorKind 値域", () => {
  it("正常な editorKind=puck は error なし", () => {
    const screen = makeScreen();
    const errors = validatePuckScreen(screen, [], [], makeValidPuckData());
    expect(errorsOf(errors, "error").map((e) => e.field)).not.toContain("design.editorKind");
  });

  it("不正な editorKind は error", () => {
    const screen = makeScreen({ design: { editorKind: "unknown" as "puck" } });
    const errors = validatePuckScreen(screen, [], []);
    const editorKindErrors = errors.filter((e) => e.field === "design.editorKind" && e.severity === "error");
    expect(editorKindErrors).toHaveLength(1);
  });
});

describe("validatePuckScreen — cssFramework 値域", () => {
  it("正常な cssFramework=tailwind は error なし", () => {
    const screen = makeScreen({ design: { editorKind: "puck", puckDataRef: "s.json", cssFramework: "tailwind" } });
    const errors = validatePuckScreen(screen, [], [], makeValidPuckData());
    expect(errorsOf(errors, "error").map((e) => e.field)).not.toContain("design.cssFramework");
  });

  it("不正な cssFramework は error", () => {
    const screen = makeScreen({ design: { editorKind: "puck", puckDataRef: "s.json", cssFramework: "sass" as "bootstrap" } });
    const errors = validatePuckScreen(screen, [], []);
    const fw = errors.filter((e) => e.field === "design.cssFramework" && e.severity === "error");
    expect(fw).toHaveLength(1);
  });
});

describe("validatePuckScreen — puckDataRef 必須", () => {
  it("puckDataRef なし → error", () => {
    const screen = makeScreen({ design: { editorKind: "puck" } });
    const errors = validatePuckScreen(screen, [], []);
    expect(errors.some((e) => e.field === "design.puckDataRef" && e.severity === "error")).toBe(true);
  });

  it("puckDataRef あり → そのエラーなし", () => {
    const screen = makeScreen();
    const errors = validatePuckScreen(screen, [], [], makeValidPuckData());
    expect(errors.some((e) => e.field === "design.puckDataRef")).toBe(false);
  });
});

describe("validatePuckScreen — Puck Data 形式", () => {
  it("root + content が空 → error", () => {
    const screen = makeScreen();
    const emptyPuckData = { root: { props: {} }, content: [] };
    const errors = validatePuckScreen(screen, [], [], emptyPuckData);
    const rootErrors = errors.filter((e) => e.field === "puckData.root" && e.severity === "error");
    expect(rootErrors).toHaveLength(1);
  });

  it("content が空 → warning", () => {
    const screen = makeScreen();
    const noContentData = { root: { props: {} }, content: [] };
    const errors = validatePuckScreen(screen, [], [], noContentData);
    expect(errors.some((e) => e.field === "puckData.content" && e.severity === "warning")).toBe(true);
  });

  it("root / content のない不正形式 → error", () => {
    const screen = makeScreen();
    const invalidData = { something: "else" };
    const errors = validatePuckScreen(screen, [], [], invalidData);
    expect(errors.some((e) => e.field === "puckData" && e.severity === "error")).toBe(true);
  });
});

describe("validatePuckScreen — 共通レイアウト props 値域", () => {
  it("正常な padding=md は error なし", () => {
    const puckData = {
      root: { props: {} },
      content: [{ type: "Heading", props: { padding: "md", text: "x" } }],
    };
    const screen = makeScreen();
    const errors = validatePuckScreen(screen, [], [], puckData);
    const paddingErrors = errors.filter((e) => e.message.includes("padding") && e.severity === "error");
    expect(paddingErrors).toHaveLength(0);
  });

  it("不正な padding 値 → error", () => {
    const puckData = {
      root: { props: {} },
      content: [{ type: "Heading", props: { padding: "xxxl", text: "x" } }],
    };
    const screen = makeScreen();
    const errors = validatePuckScreen(screen, [], [], puckData);
    const paddingErrors = errors.filter((e) => e.message.includes("padding") && e.severity === "error");
    expect(paddingErrors).toHaveLength(1);
  });
});

describe("validatePuckScreen — カスタムコンポーネント定義の primitive 検証", () => {
  it("有効な primitive のカスタムコンポーネントは error なし", () => {
    const customComponents: CustomPuckComponentDef[] = [
      {
        id: "my-card",
        label: "マイカード",
        primitive: "card",
        propsSchema: {},
      },
    ];
    const screen = makeScreen();
    const errors = validatePuckScreen(screen, [], customComponents, makeValidPuckData());
    const primitiveErrors = errors.filter((e) => e.message.includes("primitive") && e.severity === "error");
    expect(primitiveErrors).toHaveLength(0);
  });

  it("存在しない primitive のカスタムコンポーネントは error", () => {
    const customComponents: CustomPuckComponentDef[] = [
      {
        id: "invalid-comp",
        label: "不正コンポーネント",
        primitive: "non-existent-primitive",
        propsSchema: {},
      },
    ];
    const screen = makeScreen();
    const errors = validatePuckScreen(screen, [], customComponents);
    const primitiveErrors = errors.filter((e) =>
      e.message.includes("primitive") && e.message.includes("non-existent-primitive") && e.severity === "error"
    );
    expect(primitiveErrors).toHaveLength(1);
  });
});

describe("validatePuckScreen — label 空の warning", () => {
  it("name が空のとき warning が出る", () => {
    const screen = makeScreen({ name: "" });
    const errors = validatePuckScreen(screen, [], [], makeValidPuckData());
    expect(errors.some((e) => e.field === "name" && e.severity === "warning")).toBe(true);
  });

  it("name があれば warning なし", () => {
    const screen = makeScreen({ name: "正常な画面名" });
    const errors = validatePuckScreen(screen, [], [], makeValidPuckData());
    expect(errors.some((e) => e.field === "name")).toBe(false);
  });
});
