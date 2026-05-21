import { describe, it, expect } from "vitest";
import {
  screenIdResolver,
  tableIdResolver,
  viewDefinitionIdResolver,
  handlerFlowIdResolver,
  handlerActionIdResolver,
  fragmentRefResolver,
  componentRefResolver,
  exceptionTypeRefResolver,
  modelRefResolver,
  secretRefResolver,
  topicResolver,
} from "./workspaceResolver";
import type { CompletionContext, WorkspaceRefs } from "./types";

const mockWorkspace: WorkspaceRefs = {
  screens: [
    { id: "scr-001", name: "ログイン画面", maturity: "committed" },
    { id: "scr-002", name: "商品一覧", maturity: "draft" },
    { id: "scr-003", name: "注文確認" },
  ],
  tables: [
    { id: "tbl-001", physicalName: "users", name: "ユーザー", maturity: "committed" },
    { id: "tbl-002", physicalName: "orders", name: "注文", maturity: "draft" },
  ],
  viewDefinitions: [
    { id: "vd-001", name: "商品ビュー" },
    { id: "vd-002", name: "注文ビュー", maturity: "committed" },
  ],
  processFlows: [
    {
      id: "pf-001",
      name: "ログインフロー",
      kind: "screen",
      actions: [
        { id: "act-login", name: "ログイン処理" },
        { id: "act-logout", name: "ログアウト" },
      ],
    },
    {
      id: "pf-002",
      name: "注文フロー",
      kind: "screen",
      actions: [{ id: "act-order", name: "注文処理" }],
    },
  ],
  fragments: [
    { name: "HeaderFragment" },
    { name: "FooterFragment" },
  ],
  components: [
    { name: "SearchBox" },
    { name: "DataTable" },
  ],
  exceptionTypes: [
    { name: "BusinessException" },
    { name: "AuthException" },
  ],
  modelEndpoints: [
    { id: "gpt4", name: "GPT-4" },
    { id: "claude3", name: "Claude 3" },
  ],
  secrets: [
    { id: "DB_PASSWORD", name: "DB_PASSWORD" },
    { id: "API_KEY", name: "API_KEY" },
  ],
  events: [
    { topic: "order.created", description: "注文作成" },
    { topic: "user.login", description: "ログイン" },
  ],
};

function ctx(fieldKind: string, extra: Partial<CompletionContext> = {}): CompletionContext {
  return { fieldKind, workspace: mockWorkspace, ...extra };
}

describe("screenIdResolver", () => {
  it("fieldKind='screenId' → 全 screen を返す", () => {
    const s = screenIdResolver.match("", 0, ctx("screenId"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(3);
      expect(s.candidates[0].value).toBe("scr-001");
      expect(s.candidates[0].label).toBe("ログイン画面");
    }
  });

  it("prefix フィルタで絞り込み", () => {
    const s = screenIdResolver.match("注文", 2, ctx("screenId"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      // "注文確認" の 1 件 (商品一覧は除外)
      expect(s.candidates.length).toBeGreaterThanOrEqual(1);
      expect(s.candidates.every((c) => (c.label ?? "").includes("注文"))).toBe(true);
    }
  });

  it("fieldKind 不一致 → null", () => {
    const s = screenIdResolver.match("", 0, ctx("tableId"));
    expect(s).toBeNull();
  });
});

describe("tableIdResolver", () => {
  it("fieldKind='tableId' → 全 table を返す", () => {
    const s = tableIdResolver.match("", 0, ctx("tableId"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(2);
      // label に physicalName を含む
      expect(s.candidates[0].label).toContain("users");
    }
  });

  it("physicalName で絞り込み", () => {
    const s = tableIdResolver.match("order", 5, ctx("tableId"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("viewDefinitionIdResolver", () => {
  it("fieldKind='viewDefinitionId' → 全 viewDefinition を返す", () => {
    const s = viewDefinitionIdResolver.match("", 0, ctx("viewDefinitionId"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(2);
    }
  });
});

describe("handlerFlowIdResolver", () => {
  it("fieldKind='handlerFlowId' → 全 processFlow を返す", () => {
    const s = handlerFlowIdResolver.match("", 0, ctx("handlerFlowId"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(2);
      expect(s.candidates[0].hint).toBe("screen");
    }
  });

  it("name で絞り込み", () => {
    const s = handlerFlowIdResolver.match("ログイン", 4, ctx("handlerFlowId"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates.length).toBeGreaterThanOrEqual(1);
      expect(s.candidates[0].label).toContain("ログイン");
    }
  });
});

describe("handlerActionIdResolver", () => {
  it("handlerFlowId 指定時: 該当フローの actions のみ", () => {
    const s = handlerActionIdResolver.match("", 0, {
      ...ctx("handlerActionId"),
      handlerFlowId: "pf-001",
    });
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(2);
      expect(s.candidates.map((c) => c.value)).toContain("act-login");
    }
  });

  it("handlerFlowId 未指定時: 全フローの actions", () => {
    const s = handlerActionIdResolver.match("", 0, ctx("handlerActionId"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      // pf-001 の 2 件 + pf-002 の 1 件 = 3 件
      expect(s.candidates).toHaveLength(3);
    }
  });
});

describe("fragmentRefResolver", () => {
  it("fieldKind='fragmentRef' → 全 fragment を返す", () => {
    const s = fragmentRefResolver.match("", 0, ctx("fragmentRef"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(2);
      expect(s.candidates.map((c) => c.value)).toContain("HeaderFragment");
    }
  });
});

describe("componentRefResolver", () => {
  it("fieldKind='componentRef' → 全 component を返す", () => {
    const s = componentRefResolver.match("", 0, ctx("componentRef"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(2);
    }
  });
});

describe("exceptionTypeRefResolver", () => {
  it("fieldKind='exceptionTypeRef' → 全 exceptionType を返す", () => {
    const s = exceptionTypeRefResolver.match("", 0, ctx("exceptionTypeRef"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(2);
      expect(s.candidates.map((c) => c.value)).toContain("BusinessException");
    }
  });
});

describe("modelRefResolver", () => {
  it("fieldKind='modelRef' → 全 modelEndpoint を返す", () => {
    const s = modelRefResolver.match("", 0, ctx("modelRef"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(2);
      expect(s.candidates.map((c) => c.value)).toContain("gpt4");
    }
  });
});

describe("secretRefResolver", () => {
  it("fieldKind='secretRef' → 全 secret を返す", () => {
    const s = secretRefResolver.match("", 0, ctx("secretRef"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(2);
    }
  });
});

describe("topicResolver", () => {
  it("fieldKind='topic' → 全 event topic を返す", () => {
    const s = topicResolver.match("", 0, ctx("topic"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(2);
      expect(s.candidates[0].value).toBe("order.created");
      expect(s.candidates[0].hint).toBe("注文作成");
    }
  });

  it("prefix フィルタ", () => {
    const s = topicResolver.match("order", 5, ctx("topic"));
    expect(s?.phase).toBe("active");
    if (s?.phase === "active") {
      expect(s.candidates).toHaveLength(1);
      expect(s.candidates[0].value).toBe("order.created");
    }
  });
});
