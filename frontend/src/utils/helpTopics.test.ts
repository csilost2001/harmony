import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HELP_TOPICS, helpTopic } from "./helpTopics";

const repoRoot = path.resolve(__dirname, "../../..");

describe("項目ごとのヘルプ", () => {
  it("すべての話題に、題と説明がある。くわしい仕様書の場所は、実在するファイルを指す", () => {
    for (const [id, t] of Object.entries(HELP_TOPICS)) {
      expect(t.title, id).not.toBe("");
      expect(t.body.length, id).toBeGreaterThan(0);
      expect(t.body.every((p) => p.trim().length > 10), id).toBe(true);
      if (t.doc) expect(fs.existsSync(path.join(repoRoot, t.doc)), `${id}: ${t.doc}`).toBe(true);
    }
  });

  it("知らない話題は null。Object のプロパティ名 (__proto__・toString) では引けない", () => {
    expect(helpTopic("table.physicalName")?.title).toBe("物理名");
    expect(helpTopic("nope")).toBeNull();
    expect(helpTopic("__proto__")).toBeNull();
    expect(helpTopic("toString")).toBeNull();
  });
});
