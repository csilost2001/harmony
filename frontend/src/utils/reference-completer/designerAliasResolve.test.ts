import { describe, expect, it } from "vitest";
import {
  type DesignerAliasContext,
  findDesignerAliases,
  resolveDesignerAlias,
} from "./designerAliasResolve";

const flowCtx: DesignerAliasContext = {
  editorKind: "processFlow",
  flowId: "test-flow",
  stepId: "step-1",
  stepKind: "compute",
};

const screenCtx: DesignerAliasContext = {
  editorKind: "screen",
  screenId: "test-screen",
  itemId: "item-1",
};

describe("resolveDesignerAlias (#1322 Phase B-3b)", () => {
  describe("ProcessFlow editor", () => {
    it("@this.action.<id>.<path> → flowAction kind", () => {
      const r = resolveDesignerAlias("this", ["action", "action-1", "outputBinding"], flowCtx);
      expect(r).toEqual({
        kind: "flowAction",
        flowId: "test-flow",
        actionId: "action-1",
        path: ["outputBinding"],
      });
    });

    it("@this.action (id 未指定) → unresolved", () => {
      const r = resolveDesignerAlias("this", ["action"], flowCtx);
      expect(r.kind).toBe("unresolved");
    });

    it("@this.meta.<known field>.<path> → flowMeta kind", () => {
      const r = resolveDesignerAlias("this", ["meta", "flowType"], flowCtx);
      expect(r).toEqual({
        kind: "flowMeta",
        flowId: "test-flow",
        field: "flowType",
        path: [],
      });
    });

    it("@this.meta.<unknown field> → unresolved", () => {
      const r = resolveDesignerAlias("this", ["meta", "unknownField"], flowCtx);
      expect(r.kind).toBe("unresolved");
    });

    it("@this.context.<path> → flowContext kind (loose)", () => {
      const r = resolveDesignerAlias("this", ["context", "catalogs", "events"], flowCtx);
      expect(r).toEqual({
        kind: "flowContext",
        flowId: "test-flow",
        path: ["catalogs", "events"],
      });
    });

    it("@this.expressionLanguage → flowExpressionLanguage kind", () => {
      const r = resolveDesignerAlias("this", ["expressionLanguage"], flowCtx);
      expect(r).toEqual({
        kind: "flowExpressionLanguage",
        flowId: "test-flow",
      });
    });

    it("@this.<unknown top-level> → unresolved", () => {
      const r = resolveDesignerAlias("this", ["unknownTopLevel"], flowCtx);
      expect(r.kind).toBe("unresolved");
    });

    it("@self.<known step field> → stepSelf kind", () => {
      const r = resolveDesignerAlias("self", ["runIf"], flowCtx);
      expect(r).toEqual({
        kind: "stepSelf",
        stepId: "step-1",
        field: "runIf",
        path: [],
      });
    });

    it("@self.outputBinding.<sub> → stepSelf kind with path", () => {
      const r = resolveDesignerAlias("self", ["outputBinding", "name"], flowCtx);
      expect(r).toEqual({
        kind: "stepSelf",
        stepId: "step-1",
        field: "outputBinding",
        path: ["name"],
      });
    });

    it("@self.<unknown field> → unresolved", () => {
      const r = resolveDesignerAlias("self", ["unknownField"], flowCtx);
      expect(r.kind).toBe("unresolved");
    });

    it("@self in step-context-less call → unresolved", () => {
      const r = resolveDesignerAlias("self", ["id"], { ...flowCtx, stepId: undefined });
      expect(r.kind).toBe("unresolved");
    });
  });

  describe("Screen editor", () => {
    it("@this.item.<id>.<path> → screenItem kind", () => {
      const r = resolveDesignerAlias("this", ["item", "item-2", "value"], screenCtx);
      expect(r).toEqual({
        kind: "screenItem",
        screenId: "test-screen",
        itemId: "item-2",
        path: ["value"],
      });
    });

    it("@this.id (top-level) → screenTopLevel kind", () => {
      const r = resolveDesignerAlias("this", ["id"], screenCtx);
      expect(r).toEqual({
        kind: "screenTopLevel",
        screenId: "test-screen",
        field: "id",
        path: [],
      });
    });

    it("@this.<unknown> → unresolved", () => {
      const r = resolveDesignerAlias("this", ["unknownField"], screenCtx);
      expect(r.kind).toBe("unresolved");
    });

    it("@self.<known field> → screenItemSelf kind", () => {
      const r = resolveDesignerAlias("self", ["value"], screenCtx);
      expect(r).toEqual({
        kind: "screenItemSelf",
        screenId: "test-screen",
        itemId: "item-1",
        field: "value",
        path: [],
      });
    });

    it("@self.<unknown> → unresolved", () => {
      const r = resolveDesignerAlias("self", ["unknownField"], screenCtx);
      expect(r.kind).toBe("unresolved");
    });

    it("@self in item-context-less call → unresolved", () => {
      const r = resolveDesignerAlias("self", ["value"], { ...screenCtx, itemId: undefined });
      expect(r.kind).toBe("unresolved");
    });
  });
});

describe("findDesignerAliases (#1322 Phase B-3b)", () => {
  it("template 内の複数 alias を全件検出", () => {
    const template = "SELECT * FROM @this.meta.id WHERE step = @self.id AND ref = @this.action.action-1.outputBinding";
    const matches = findDesignerAliases(template, flowCtx);
    expect(matches).toHaveLength(3);
    expect(matches[0].alias).toBe("this");
    expect(matches[0].original).toBe("@this.meta.id");
    expect(matches[1].alias).toBe("self");
    expect(matches[1].original).toBe("@self.id");
    expect(matches[2].alias).toBe("this");
    expect(matches[2].original).toBe("@this.action.action-1.outputBinding");
  });

  it("template 内に alias 0 件なら空配列", () => {
    const matches = findDesignerAliases("SELECT * FROM users WHERE id = @var.action.userId", flowCtx);
    expect(matches).toHaveLength(0);
  });

  it("offset / length は元 string の position を正確に指す", () => {
    const template = "prefix @this.meta.id suffix";
    const matches = findDesignerAliases(template, flowCtx);
    expect(matches).toHaveLength(1);
    expect(matches[0].offset).toBe(7);
    expect(matches[0].length).toBe("@this.meta.id".length);
    expect(template.substring(matches[0].offset, matches[0].offset + matches[0].length)).toBe(
      "@this.meta.id",
    );
  });

  it("email-like false-positive を回避 (lookbehind)", () => {
    // `user@self.something` のような email/IRC 風文字列は match しない
    const matches = findDesignerAliases("contact: user@self.foo for support", flowCtx);
    expect(matches).toHaveLength(0);
  });

  it("Markdown link 内 mailto は match しない", () => {
    const matches = findDesignerAliases("see [docs](mailto:admin@self.example)", flowCtx);
    expect(matches).toHaveLength(0);
  });

  it("unresolved な match も結果に含まれる (consumer 側で error 表示用)", () => {
    const matches = findDesignerAliases("@this.unknownTop", flowCtx);
    expect(matches).toHaveLength(1);
    expect(matches[0].resolution.kind).toBe("unresolved");
  });
});
