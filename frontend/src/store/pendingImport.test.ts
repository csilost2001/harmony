import { describe, it, expect } from "vitest";
import { importKindOf, setPendingImport, takePendingImport } from "./pendingImport";

describe("pendingImport", () => {
  it("置いた文は、1 回だけ取り出せる", () => {
    setPendingImport("ddl", "CREATE TABLE a (id INT);");
    expect(takePendingImport("openapi")).toBeNull();
    expect(takePendingImport("ddl")).toBe("CREATE TABLE a (id INT);");
    expect(takePendingImport("ddl")).toBeNull();
  });
  it("ファイル名 (拡張子) から、取り込みの種類を決める", () => {
    expect(importKindOf("schema.SQL")).toBe("ddl");
    expect(importKindOf("dump.ddl")).toBe("ddl");
    expect(importKindOf("openapi.json")).toBe("openapi");
    expect(importKindOf("表.xlsx")).toBe("xlsx");
    expect(importKindOf("memo.txt")).toBeNull();
    expect(importKindOf("noext")).toBeNull();
  });
});
