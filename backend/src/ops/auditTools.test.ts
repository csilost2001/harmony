import { describe, it, expect } from "vitest";
import { AI_TOOLS_NOT_ATTRIBUTED, aiToolDesignKind } from "@harmony/shared";
import { tools } from "../tools.js";
import { isReadOnlyTool } from "../security/mcpAccess.js";

/** 書き込みの tool は、「設計の変更として数える (対応表)」か「数えない理由を書く」のどちらか。新しい tool を足すと、どちらかに入れるまで落ちる */
describe("AI の書き込みの tool の、監査ログでの扱い (続編 第 9 弾 レビュー M1')", () => {
  const writeTools = tools.map((t) => t.name).filter((n) => !isReadOnlyTool(n)).map((n) => n.replace(/^designer__/, ""));
  it("書き込みの tool は、すべて対応表にあるか、数えない理由がある", () => {
    const unclassified = writeTools.filter((n) => aiToolDesignKind(n, "table") === null && !(n in AI_TOOLS_NOT_ATTRIBUTED));
    expect(unclassified).toEqual([]);
  });
  it("対応表と、数えない理由が、重ならない。存在しない tool を、数えない理由に書かない", () => {
    expect(writeTools.filter((n) => aiToolDesignKind(n, "table") !== null && n in AI_TOOLS_NOT_ATTRIBUTED)).toEqual([]);
    expect(Object.keys(AI_TOOLS_NOT_ATTRIBUTED).filter((n) => !writeTools.includes(n))).toEqual([]);
  });
  it("種類が備考で決まる tool は、備考が無いと数えない。備考があれば、その種類", () => {
    expect(aiToolDesignKind("editSession__save")).toBeNull();
    expect(aiToolDesignKind("designer__restore_version", "page-layout")).toBe("pageLayout");
    expect(aiToolDesignKind("designer__rename_entity", "viewDefinition")).toBe("viewDefinition");
    expect(aiToolDesignKind("designer__update_table")).toBe("table");
    expect(aiToolDesignKind("designer__get_table")).toBeNull();
  });
});

describe("設計への新しいアクセスの tool (AI の入口 第 2 弾)", () => {
  it("save_design / delete_design は、引数 kind の設計の種類として数える。汎用定義は、種類が無いので数えない", async () => {
    const { describeAiTool } = await import("./auditMap.js");
    const d = describeAiTool("designer__save_design", { kind: "sequence", id: "seq-1" }, "");
    expect(d).toEqual({ target: "seq-1", detail: "sequence" });
    expect(aiToolDesignKind("designer__save_design", d.detail)).toBe("sequence");
    expect(aiToolDesignKind("designer__delete_design", "viewDefinition")).toBe("viewDefinition");
    expect(aiToolDesignKind("designer__save_design", "genericDefinition")).toBeNull();
    expect(describeAiTool("designer__save_design", { kind: "genericDefinition", definitionKind: "message", name: "m1" }, "").target).toBe("m1");
  });
});
