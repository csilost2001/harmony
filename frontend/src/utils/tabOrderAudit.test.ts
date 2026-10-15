/**
 * Tab キーの順序の検査: tabIndex に正の値を付けると、画面の見た目の順と、Tab で移る順がずれる。
 * 0 (順番どおり) か -1 (Tab では止まらない。フォーカスはできる) だけを使う。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("Tab の順序", () => {
  it("tabIndex に正の値を使っていない", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(SRC, "components"))) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      fs.readFileSync(file, "utf-8").split("\n").forEach((line, i) => {
        if (/tabIndex=\{\s*[1-9]|tabindex="[1-9]/i.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
