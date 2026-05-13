import { describe, it, expect, beforeEach } from "vitest";
import {
  setGenericDefinitionStorageBackend,
  listGenericDefinitions,
  loadGenericDefinition,
  saveGenericDefinition,
  deleteGenericDefinition,
  createGenericDefinitionTemplate,
  type GenericDefinitionStorageBackend,
} from "./genericDefinitionStore";
import { GENERIC_DEFINITION_NAME_PATTERN } from "../types/v3";

const orderForm = {
  kind: "data-contract" as const,
  name: "OrderForm",
  purpose: "注文フォームの層間契約",
  responsibilities: ["顧客入力を保持する", "ProcessFlow の入力となる"],
  targets: ["backend" as const, "frontend" as const],
  fields: [
    { name: "customerId", type: "string" },
    { name: "items", type: "OrderLineItem[]" },
  ],
};

const stockError = {
  kind: "exception-type" as const,
  name: "StockInsufficientError",
  purpose: "在庫不足を表す業務例外",
  responsibilities: ["在庫不足を呼び出し側に通知する"],
  targets: ["backend" as const],
};

function makeMockBackend(): GenericDefinitionStorageBackend & { _store: Map<string, unknown[]> } {
  const store = new Map<string, unknown[]>();
  return {
    _store: store,
    async listAll(kind) {
      return store.get(kind) ?? [];
    },
    async load(kind, name) {
      const items = store.get(kind) ?? [];
      return items.find((i) => (i as { name: string }).name === name) ?? null;
    },
    async save(kind, name, data) {
      const items = store.get(kind) ?? [];
      const idx = items.findIndex((i) => (i as { name: string }).name === name);
      if (idx >= 0) items[idx] = data;
      else items.push(data);
      store.set(kind, items);
    },
    async delete(kind, name) {
      const items = store.get(kind) ?? [];
      store.set(kind, items.filter((i) => (i as { name: string }).name !== name));
    },
  };
}

describe("genericDefinitionStore", () => {
  let backend: ReturnType<typeof makeMockBackend>;

  beforeEach(() => {
    backend = makeMockBackend();
    setGenericDefinitionStorageBackend(backend);
  });

  it("list は空を返す (初期状態)", async () => {
    const result = await listGenericDefinitions("data-contract");
    expect(result).toEqual([]);
  });

  it("save → list でサマリが取得できる", async () => {
    await saveGenericDefinition(orderForm);
    const list = await listGenericDefinitions("data-contract");
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("OrderForm");
    expect(list[0].purpose).toBe("注文フォームの層間契約");
    expect(list[0].targets).toEqual(["backend", "frontend"]);
    expect(list[0].fieldCount).toBe(2);
  });

  it("load で full object が取得できる", async () => {
    await saveGenericDefinition(orderForm);
    const loaded = await loadGenericDefinition("data-contract", "OrderForm");
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe("OrderForm");
    expect(loaded?.responsibilities).toHaveLength(2);
  });

  it("load で存在しない name は null を返す", async () => {
    const loaded = await loadGenericDefinition("data-contract", "NonExistent");
    expect(loaded).toBeNull();
  });

  it("delete でアイテムが削除される", async () => {
    await saveGenericDefinition(orderForm);
    await deleteGenericDefinition("data-contract", "OrderForm");
    const list = await listGenericDefinitions("data-contract");
    expect(list).toHaveLength(0);
  });

  it("kind ごとに独立して管理される", async () => {
    await saveGenericDefinition(orderForm);
    await saveGenericDefinition(stockError);
    const contracts = await listGenericDefinitions("data-contract");
    const exceptions = await listGenericDefinitions("exception-type");
    expect(contracts).toHaveLength(1);
    expect(exceptions).toHaveLength(1);
    expect(contracts[0].name).toBe("OrderForm");
    expect(exceptions[0].name).toBe("StockInsufficientError");
  });

  it("createGenericDefinitionTemplate は必須フィールドを含む", () => {
    const def = createGenericDefinitionTemplate({
      kind: "data-contract",
      name: "TestContract",
      purpose: "テスト用",
      responsibilities: ["テスト責務"],
      targets: ["backend"],
    });
    expect(def.kind).toBe("data-contract");
    expect(def.name).toBe("TestContract");
    expect(def.responsibilities).toEqual(["テスト責務"]);
    expect(def.targets).toEqual(["backend"]);
  });

  it("GENERIC_DEFINITION_NAME_PATTERN: PascalCase は通過する", () => {
    expect(GENERIC_DEFINITION_NAME_PATTERN.test("OrderForm")).toBe(true);
    expect(GENERIC_DEFINITION_NAME_PATTERN.test("StockInsufficientError")).toBe(true);
    expect(GENERIC_DEFINITION_NAME_PATTERN.test("Abc123")).toBe(true);
  });

  it("GENERIC_DEFINITION_NAME_PATTERN: 不正な名前は拒否される", () => {
    expect(GENERIC_DEFINITION_NAME_PATTERN.test("")).toBe(false);
    expect(GENERIC_DEFINITION_NAME_PATTERN.test("123Start")).toBe(false);
    expect(GENERIC_DEFINITION_NAME_PATTERN.test("has-hyphen")).toBe(false);
    expect(GENERIC_DEFINITION_NAME_PATTERN.test("has space")).toBe(false);
  });
});
