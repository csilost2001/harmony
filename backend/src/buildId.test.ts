import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getServerBuildId, readServerBuildId } from "./buildId.js";

describe("readServerBuildId (#1572)", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-buildid-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("build-id.txt の中身 (前後の空白は除く) を返す", () => {
    fs.writeFileSync(path.join(dir, "build-id.txt"), "mh3k9-abc123\n");
    expect(readServerBuildId(dir)).toBe("mh3k9-abc123");
  });

  it("dir が無い・ファイルが無い・空・不正な形なら undefined", () => {
    expect(readServerBuildId(undefined)).toBeUndefined();
    expect(readServerBuildId(path.join(dir, "none"))).toBeUndefined();
    expect(readServerBuildId(dir)).toBeUndefined();
    fs.writeFileSync(path.join(dir, "build-id.txt"), "  \n");
    expect(readServerBuildId(dir)).toBeUndefined();
    fs.writeFileSync(path.join(dir, "build-id.txt"), "<html>not an id</html>");
    expect(readServerBuildId(dir)).toBeUndefined();
  });
});

describe("getServerBuildId (#1572)", () => {
  let dir: string;
  const orig = process.env.HARMONY_STATIC_DIR;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-buildid-"));
    process.env.HARMONY_STATIC_DIR = dir;
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.HARMONY_STATIC_DIR; else process.env.HARMONY_STATIC_DIR = orig;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("build-id.txt なしで呼んだあとに書くと、次の呼び出しで新しい ID が返る", () => {
    expect(getServerBuildId()).toBeUndefined();
    fs.writeFileSync(path.join(dir, "build-id.txt"), "first-1\n");
    expect(getServerBuildId()).toBe("first-1");
  });

  it("dist を作り直して build-id.txt が書き換わると追従する", () => {
    fs.writeFileSync(path.join(dir, "build-id.txt"), "old-1\n");
    expect(getServerBuildId()).toBe("old-1");
    fs.writeFileSync(path.join(dir, "build-id.txt"), "new-2\n");
    expect(getServerBuildId()).toBe("new-2");
  });

  it("HARMONY_STATIC_DIR が未設定なら undefined", () => {
    delete process.env.HARMONY_STATIC_DIR;
    expect(getServerBuildId()).toBeUndefined();
  });
});
