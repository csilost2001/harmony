import { describe, it, expect } from "vitest";
import { TABLE_STARTERS, starterColumns } from "./tableStarters";
import { COLUMN_TEMPLATES } from "./tableConstants";

describe("tableStarters", () => {
  it("どのスターターも、実在するテンプレートだけを使う", () => {
    const ids = new Set(COLUMN_TEMPLATES.map((t) => t.id));
    for (const s of TABLE_STARTERS) for (const tid of s.templateIds) expect(ids.has(tid), `${s.id}: ${tid}`).toBe(true);
  });

  it("スターターごとのカラム。物理名は重ならない", () => {
    expect(starterColumns("empty")).toEqual([]);
    expect(starterColumns("unknown")).toEqual([]);
    expect(starterColumns("standard").map((c) => c.physicalName)).toEqual(["id", "created_at", "updated_at"]);
    for (const s of TABLE_STARTERS) {
      const names = starterColumns(s.id).map((c) => c.physicalName);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(starterColumns("master")[0]).toMatchObject({ primaryKey: true, dataType: "BIGINT" });
  });

  it("呼び出しごとに別のオブジェクト (あとで書き換えても元のテンプレートに影響しない)", () => {
    const a = starterColumns("standard");
    a[0].physicalName = "changed" as never;
    expect(starterColumns("standard")[0].physicalName).toBe("id");
    expect(COLUMN_TEMPLATES.find((t) => t.id === "tpl-pk-bigint")!.column.physicalName).toBe("id");
  });
});
