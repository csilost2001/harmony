/**
 * defaultPaths 単体テスト (#755)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { getDefaultWorkspacesDir } from "./defaultPaths.js";

describe("getDefaultWorkspacesDir", () => {
  const origEnv = process.env.DESIGNER_WORKSPACES_DIR;

  beforeEach(() => {
    delete process.env.DESIGNER_WORKSPACES_DIR;
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.DESIGNER_WORKSPACES_DIR;
    } else {
      process.env.DESIGNER_WORKSPACES_DIR = origEnv;
    }
  });

  it("DESIGNER_WORKSPACES_DIR 未設定 → cwd/../workspaces/ の絶対パスを返す", () => {
    const result = getDefaultWorkspacesDir();
    // path.resolve で絶対パスになる
    expect(path.isAbsolute(result)).toBe(true);
    // cwd の親ディレクトリ配下の workspaces であること
    const expected = path.resolve(process.cwd(), "..", "workspaces");
    expect(result).toBe(expected);
  });

  it("DESIGNER_WORKSPACES_DIR を設定 → その絶対パスを返す", () => {
    process.env.DESIGNER_WORKSPACES_DIR = "/tmp/custom-workspaces";
    const result = getDefaultWorkspacesDir();
    expect(result).toBe(path.resolve("/tmp/custom-workspaces"));
  });

  it("DESIGNER_WORKSPACES_DIR に相対パスを設定 → 絶対パスに変換される", () => {
    process.env.DESIGNER_WORKSPACES_DIR = "relative/workspaces";
    const result = getDefaultWorkspacesDir();
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toBe(path.resolve("relative/workspaces"));
  });

  it("DESIGNER_WORKSPACES_DIR が空文字列 → cwd/../workspaces/ にフォールバック", () => {
    process.env.DESIGNER_WORKSPACES_DIR = "";
    const result = getDefaultWorkspacesDir();
    const expected = path.resolve(process.cwd(), "..", "workspaces");
    expect(result).toBe(expected);
  });

  it("DESIGNER_WORKSPACES_DIR が空白のみ → cwd/../workspaces/ にフォールバック", () => {
    process.env.DESIGNER_WORKSPACES_DIR = "   ";
    const result = getDefaultWorkspacesDir();
    const expected = path.resolve(process.cwd(), "..", "workspaces");
    expect(result).toBe(expected);
  });

  it("戻り値のパスが workspaces で終わる (env 未設定時)", () => {
    const result = getDefaultWorkspacesDir();
    expect(result.endsWith(path.sep + "workspaces") || result.endsWith("/workspaces")).toBe(true);
  });
});
