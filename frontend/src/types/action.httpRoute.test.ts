import { describe, it, expect } from "vitest";
import type {
  ActionDefinition,
  ProcessFlow,
  HttpRoute,
  HttpResponseSpec,
  LocalId,
  DisplayName,
  Description,
  Identifier,
} from "../types/v3";
import { migrateProcessFlow } from "../utils/actionMigration";

// #1355 Codex Must-fix: 各 type literal は `const x: <Type> = {...}` で type 注釈し、
// brand のみ局所 cast。`({...} as unknown) as <Type>` のような outer cast は使わない。

describe("ActionDefinition の httpRoute / responses (#160)", () => {
  it("httpRoute を保持できる", () => {
    const route: HttpRoute = { method: "POST", path: "/api/customers", auth: "none" };
    const action: ActionDefinition = {
      id: "a1" as LocalId,
      name: "登録" as DisplayName,
      trigger: "submit" as Identifier,
      httpRoute: route,
      steps: [],
    };
    expect(action.httpRoute?.method).toBe("POST");
    expect(action.httpRoute?.path).toBe("/api/customers");
    expect(action.httpRoute?.auth).toBe("none");
  });

  it("responses[] を保持できる (成功 + エラー複数)", () => {
    const responses: HttpResponseSpec[] = [
      { id: "resp-1" as LocalId, status: 201, contentType: "application/json", bodySchema: { typeRef: "CustomerRegisterResponse" }, description: "登録成功" as Description },
      { id: "resp-2" as LocalId, status: 400, bodySchema: { typeRef: "ApiError" }, description: "バリデーションエラー" as Description, when: "fieldErrors 有" },
      { id: "resp-3" as LocalId, status: 409, bodySchema: { typeRef: "ApiError" }, description: "メール重複" as Description, when: "@duplicateCustomer != null" },
    ];
    const action: ActionDefinition = {
      id: "a2" as LocalId,
      name: "登録" as DisplayName,
      trigger: "submit" as Identifier,
      responses,
      steps: [],
    };
    expect(action.responses).toHaveLength(3);
    expect(action.responses![0].status).toBe(201);
    expect(action.responses![1].status).toBe(400);
    expect(action.responses![2].when).toBe("@duplicateCustomer != null");
  });

  it("httpRoute / responses は省略可能", () => {
    const action: ActionDefinition = {
      id: "a3" as LocalId,
      name: "x" as DisplayName,
      trigger: "click" as Identifier,
      steps: [],
    };
    expect(action.httpRoute).toBeUndefined();
    expect(action.responses).toBeUndefined();
  });

  it("auth 省略時も型上は許容 (既定 'required' を値として書かなくて良い)", () => {
    const route: HttpRoute = { method: "GET", path: "/api/orders" };
    expect(route.auth).toBeUndefined();
  });
});

describe("migrateProcessFlow — httpRoute / responses 透過保持 (#160)", () => {
  it("新フィールドを持つ action を冪等にマイグレーションできる", () => {
    // raw は v1 legacy: bodySchema が string (v3 では {typeRef: string})
    const raw: unknown = {
      id: "g",
      name: "x",
      type: "screen",
      description: "",
      actions: [
        {
          id: "a",
          name: "a",
          trigger: "submit",
          httpRoute: { method: "POST", path: "/api/x", auth: "required" },
          responses: [
            { id: "resp-4", status: 201, bodySchema: "R" },
            { id: "resp-5", status: 400, description: "VALIDATION" },
          ],
          steps: [],
        },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const once = migrateProcessFlow(raw) as ProcessFlow;
    const twice = migrateProcessFlow(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));

    const action = once.actions[0];
    expect(action.httpRoute?.method).toBe("POST");
    expect(action.responses).toHaveLength(2);
    expect(action.responses?.[0].status).toBe(201);
  });

  it("新フィールドなしの旧データでも破壊されない", () => {
    const raw: unknown = {
      id: "g",
      name: "x",
      type: "screen",
      description: "",
      actions: [{ id: "a", name: "a", trigger: "click", steps: [] }],
      createdAt: "",
      updatedAt: "",
    };
    const migrated = migrateProcessFlow(raw) as ProcessFlow;
    expect(migrated.actions[0].httpRoute).toBeUndefined();
    expect(migrated.actions[0].responses).toBeUndefined();
  });
});
