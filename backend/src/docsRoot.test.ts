import { afterEach, describe, expect, it, vi } from "vitest";
import { findDocsRoot as viaKnowledge } from "./mcpKnowledge.js";
import { findDocsRoot } from "./docsRoot.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("docsRoot (資料の置き場)", () => {
  it("mcpKnowledge からも同じ関数を import できる (re-export)", () => {
    expect(viaKnowledge).toBe(findDocsRoot);
  });
  it("HARMONY_DOCS_DIR が不正でも本体の置き場に戻り、同じ警告は何度呼んでも 1 回だけ出す。別の値なら別に 1 回出す", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = { HARMONY_DOCS_DIR: "/nonexistent/docs-root-a" };
    const first = findDocsRoot(bad);
    expect(first).not.toBeNull(); // 本体のルートに戻る
    for (let i = 0; i < 5; i++) expect(findDocsRoot(bad)).toBe(first);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain("/nonexistent/docs-root-a");
    findDocsRoot({ HARMONY_DOCS_DIR: "/nonexistent/docs-root-b" });
    expect(err).toHaveBeenCalledTimes(2);
  });
  it("HARMONY_DOCS_DIR が無ければ警告しない", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    findDocsRoot({});
    expect(err).not.toHaveBeenCalled();
  });
});
