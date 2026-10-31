import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readServerBuildId } from "./buildId.js";

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
