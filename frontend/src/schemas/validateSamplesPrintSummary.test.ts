/**
 * validate-samples.ts printSummary のユニットテスト (#722)
 *
 * warning 存在時の誤誘導 "All validations passed." を修正した三分岐メッセージを検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printSummary, type ValidationSummary } from "../../scripts/validate-samples";

// ─── テスト用ヘルパー ────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<ValidationSummary> = {}): ValidationSummary {
  return {
    totalFlows: 0,
    passedFlows: 0,
    failedFlows: 0,
    results: [],
    projectResults: [],
    projectCount: 1,
    totalTableCount: 0,
    totalConventionsCount: 0,
    totalScreenCount: 0,
    totalViewDefinitionCount: 0,
    extensionFileCount: 0,
    ...overrides,
  };
}

function makeIssue(
  validator: string,
  severity: "error" | "warning",
  code = "TEST_CODE",
  path = "test/path",
  message = "テストメッセージ",
) {
  return { validator, severity, code, path, message };
}

// ─── テスト ──────────────────────────────────────────────────────────────────

describe("printSummary — error = 0, warning = 0", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("error も warning もないとき 'All validations passed.' を出力する", () => {
    const summary = makeSummary({ totalFlows: 3, passedFlows: 3, failedFlows: 0 });
    printSummary(summary);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("All validations passed.");
  });

  it("error も warning もないとき 'All errors resolved' や 'failed' を出力しない", () => {
    const summary = makeSummary({ totalFlows: 3, passedFlows: 3, failedFlows: 0 });
    printSummary(summary);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).not.toContain("All errors resolved");
    expect(output).not.toContain("failed");
  });
});

describe("printSummary — error = 0, warning > 0", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("warning が 2 件 (異なる validator) のとき 'All errors resolved (2 warnings remain):' を出力する", () => {
    const summary = makeSummary({
      totalFlows: 2,
      passedFlows: 2,
      failedFlows: 0,
      projectResults: [
        {
          projectId: "test",
          displayName: "test",
          issues: [
            makeIssue("runtimeContractValidator", "warning", "EMPTY_SCREEN_ITEMS"),
            makeIssue("sqlOrderValidator", "warning", "WARN_CODE"),
          ],
        },
      ],
    });
    printSummary(summary);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("All errors resolved (2 warnings remain):");
  });

  it("warning が 2 件のとき per-validator 内訳を出力する", () => {
    const summary = makeSummary({
      totalFlows: 2,
      passedFlows: 2,
      failedFlows: 0,
      projectResults: [
        {
          projectId: "test",
          displayName: "test",
          issues: [
            makeIssue("runtimeContractValidator", "warning", "EMPTY_SCREEN_ITEMS"),
            makeIssue("sqlOrderValidator", "warning", "WARN_CODE"),
          ],
        },
      ],
    });
    printSummary(summary);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("[runtimeContractValidator] 1 warning");
    expect(output).toContain("[sqlOrderValidator] 1 warning");
  });

  it("warning が 2 件のとき 'All validations passed.' を出力しない", () => {
    const summary = makeSummary({
      totalFlows: 2,
      passedFlows: 2,
      failedFlows: 0,
      projectResults: [
        {
          projectId: "test",
          displayName: "test",
          issues: [
            makeIssue("runtimeContractValidator", "warning", "EMPTY_SCREEN_ITEMS"),
            makeIssue("sqlOrderValidator", "warning", "WARN_CODE"),
          ],
        },
      ],
    });
    printSummary(summary);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).not.toContain("All validations passed.");
  });

  it("warning が 1 件のとき単数形 'warning remains' を出力する", () => {
    const summary = makeSummary({
      totalFlows: 1,
      passedFlows: 1,
      failedFlows: 0,
      projectResults: [
        {
          projectId: "test",
          displayName: "test",
          issues: [
            makeIssue("runtimeContractValidator", "warning", "EMPTY_SCREEN_ITEMS"),
          ],
        },
      ],
    });
    printSummary(summary);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("All errors resolved (1 warning remains):");
  });
});

describe("printSummary — error > 0, warning > 0", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("error = 1, warning = 1 のとき '1 flow failed with 1 error and 1 warning:' を出力する", () => {
    const summary = makeSummary({
      totalFlows: 1,
      passedFlows: 0,
      failedFlows: 1,
      results: [
        {
          filePath: "/test/flow.json",
          displayName: "test/flow.json",
          projectId: "test",
          issues: [makeIssue("sqlColumnValidator", "error", "COL_NOT_FOUND")],
        },
      ],
      projectResults: [
        {
          projectId: "test",
          displayName: "test",
          issues: [makeIssue("runtimeContractValidator", "warning", "EMPTY_SCREEN_ITEMS")],
        },
      ],
    });
    printSummary(summary);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("1 flow failed with 1 error and 1 warning:");
  });

  it("error = 1, warning = 1 のとき per-validator 内訳を出力する", () => {
    const summary = makeSummary({
      totalFlows: 1,
      passedFlows: 0,
      failedFlows: 1,
      results: [
        {
          filePath: "/test/flow.json",
          displayName: "test/flow.json",
          projectId: "test",
          issues: [makeIssue("sqlColumnValidator", "error", "COL_NOT_FOUND")],
        },
      ],
      projectResults: [
        {
          projectId: "test",
          displayName: "test",
          issues: [makeIssue("runtimeContractValidator", "warning", "EMPTY_SCREEN_ITEMS")],
        },
      ],
    });
    printSummary(summary);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("[sqlColumnValidator] 1 error");
    expect(output).toContain("[runtimeContractValidator] 1 warning");
  });

  it("error = 1, warning = 1 のとき 'All validations passed.' を出力しない", () => {
    const summary = makeSummary({
      totalFlows: 1,
      passedFlows: 0,
      failedFlows: 1,
      results: [
        {
          filePath: "/test/flow.json",
          displayName: "test/flow.json",
          projectId: "test",
          issues: [makeIssue("sqlColumnValidator", "error", "COL_NOT_FOUND")],
        },
      ],
      projectResults: [
        {
          projectId: "test",
          displayName: "test",
          issues: [makeIssue("runtimeContractValidator", "warning", "EMPTY_SCREEN_ITEMS")],
        },
      ],
    });
    printSummary(summary);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).not.toContain("All validations passed.");
  });
});

describe("printSummary — error > 0, warning = 0", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("error = 2, warning = 0 のとき warning 言及なしで '2 flows failed with 2 errors:' を出力する", () => {
    const summary = makeSummary({
      totalFlows: 2,
      passedFlows: 0,
      failedFlows: 2,
      results: [
        {
          filePath: "/test/flow1.json",
          displayName: "test/flow1.json",
          projectId: "test",
          issues: [makeIssue("sqlColumnValidator", "error", "COL_NOT_FOUND")],
        },
        {
          filePath: "/test/flow2.json",
          displayName: "test/flow2.json",
          projectId: "test",
          issues: [makeIssue("conventionsValidator", "error", "REF_NOT_FOUND")],
        },
      ],
    });
    printSummary(summary);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("2 flows failed with 2 errors:");
    expect(output).not.toContain("warning");
  });
});
