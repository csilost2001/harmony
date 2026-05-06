import { describe, it, expect } from "vitest";
import type { ActionDefinition, ProcessFlow, HttpRoute, HttpResponseSpec } from "./action";
import { migrateProcessFlow } from "../utils/actionMigration";

describe("ActionDefinition の httpRoute / responses (#160)", () => {
  it("httpRoute を保持できる", () => {
    const route: HttpRoute = { method: "POST", path: "/api/customers", auth: "none" };
    const action: ActionDefinition = {
      id: "a1",
      name: "登録",
      trigger: "submit",
      httpRoute: route,
      steps: [],
    };
    expect(action.httpRoute?.method).toBe("POST");
    expect(action.httpRoute?.path).toBe("/api/customers");
    expect(action.httpRoute?.auth).toBe("none");
  });

  it("responses[] を保持できる (成功 + エラー複数)", () => {
    const responses: HttpResponseSpec[] = [
      { status: 201, contentType: "application/json", bodySchema: "CustomerRegisterResponse", description: "登録成功" },
      { status: 400, bodySchema: "ApiError", description: "バリデーションエラー", when: "fieldErrors 有" },
      { status: 409, bodySchema: "ApiError", description: "メール重複", when: "@duplicateCustomer != null" },
    ];
    const action: ActionDefinition = {
      id: "a2",
      name: "登録",
      trigger: "submit",
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
      id: "a3",
      name: "x",
      trigger: "click",
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
    const raw = {
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
            { status: 201, bodySchema: "R" },
            { status: 400, description: "VALIDATION" },
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
    const raw = {
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
