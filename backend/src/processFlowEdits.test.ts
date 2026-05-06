import { describe, it, expect } from "vitest";
import {
  updateStep,
  removeStep,
  moveStep,
  setMaturity,
  addStepNote,
  addCatalogEntry,
  removeCatalogEntry,
  insertStepAt,
  findStep,
  listMarkers,
  findAllMarkers,
  addMarker,
  resolveMarker,
  removeMarker,
  type ProcessFlowDoc,
} from "./processFlowEdits.js";

function makeGroup(): ProcessFlowDoc {
  return {
    id: "ag-1",
    actions: [{
      id: "act-1",
      steps: [
        { id: "s1", type: "validation", description: "v1" },
        { id: "s2", type: "compute", description: "c1" },
        {
          id: "s3",
          type: "branch",
          description: "b1",
          branches: [{ id: "br-a", steps: [{ id: "s3-a-1", type: "return", description: "r1" }] }],
          elseBranch: { id: "br-else", steps: [{ id: "s3-e-1", type: "other", description: "o1" }] },
        },
        {
          id: "s4",
          type: "loop",
          description: "l1",
          steps: [{ id: "s4-1", type: "other", description: "o2" }],
        },
        {
          id: "s5",
          type: "externalSystem",
          description: "ext",
          outcomes: {
            failure: { sideEffects: [{ id: "s5-se-1", type: "other", description: "logger" }] },
          },
        },
        {
          id: "s6",
          type: "transactionScope",
          description: "tx1",
          steps: [
            { id: "s6-tx-1", type: "dbAccess", description: "insert" },
            { id: "s6-tx-2", type: "dbAccess", description: "update" },
          ],
          onCommit: [{ id: "s6-c-1", type: "log", description: "commit log" }],
          onRollback: [{ id: "s6-r-1", type: "log", description: "rollback log" }],
        },
      ],
    }],
  };
}

describe("findStep — ネスト全対応", () => {
  const ag = makeGroup();
  it("top-level step", () => expect(findStep(ag, "s1")?.type).toBe("validation"));
  it("branch 配下", () => expect(findStep(ag, "s3-a-1")?.type).toBe("return"));
  it("elseBranch 配下", () => expect(findStep(ag, "s3-e-1")?.type).toBe("other"));
  it("loop 配下", () => expect(findStep(ag, "s4-1")?.type).toBe("other"));
  it("sideEffects 配下", () => expect(findStep(ag, "s5-se-1")?.type).toBe("other"));
  it("transactionScope.steps 配下 (#415)", () =>
    expect(findStep(ag, "s6-tx-1")?.type).toBe("dbAccess"));
  it("transactionScope.onCommit 配下 (#415)", () =>
    expect(findStep(ag, "s6-c-1")?.type).toBe("log"));
  it("transactionScope.onRollback 配下 (#415)", () =>
    expect(findStep(ag, "s6-r-1")?.type).toBe("log"));
  it("未知 id は null", () => expect(findStep(ag, "nope")).toBeNull());
});

describe("updateStep — patch 適用", () => {
  it("top-level step の description を更新", () => {
    const ag = makeGroup();
    updateStep(ag, "s1", { description: "改訂" });
    expect(findStep(ag, "s1")?.description).toBe("改訂");
  });
  it("ネストした step も更新", () => {
    const ag = makeGroup();
    updateStep(ag, "s3-a-1", { description: "branch 内改訂" });
    expect(findStep(ag, "s3-a-1")?.description).toBe("branch 内改訂");
  });
  it("transactionScope.steps 配下も更新 (#415)", () => {
    const ag = makeGroup();
    updateStep(ag, "s6-tx-2", { description: "TX 内改訂" });
    expect(findStep(ag, "s6-tx-2")?.description).toBe("TX 内改訂");
  });
  it("transactionScope.onCommit 配下も更新 (#415)", () => {
    const ag = makeGroup();
    updateStep(ag, "s6-c-1", { description: "commit 内改訂" });
    expect(findStep(ag, "s6-c-1")?.description).toBe("commit 内改訂");
  });
  it("transactionScope.onRollback 配下も更新 (#415)", () => {
    const ag = makeGroup();
    updateStep(ag, "s6-r-1", { description: "rollback 内改訂" });
    expect(findStep(ag, "s6-r-1")?.description).toBe("rollback 内改訂");
  });
  it("未知 id は throw", () => {
    const ag = makeGroup();
    expect(() => updateStep(ag, "nope", {})).toThrow();
  });
});

describe("removeStep", () => {
  it("top-level 削除", () => {
    const ag = makeGroup();
    removeStep(ag, "s2");
    expect(ag.actions[0].steps.length).toBe(5);
    expect(findStep(ag, "s2")).toBeNull();
  });
  it("branch 配下を削除", () => {
    const ag = makeGroup();
    removeStep(ag, "s3-a-1");
    const s3 = findStep(ag, "s3");
    expect(s3?.branches?.[0].steps.length).toBe(0);
  });
  it("transactionScope.steps 配下を削除 (#415)", () => {
    const ag = makeGroup();
    removeStep(ag, "s6-tx-1");
    const s6 = findStep(ag, "s6");
    expect(s6?.steps?.length).toBe(1);
    expect(findStep(ag, "s6-tx-1")).toBeNull();
  });
  it("transactionScope.onCommit 配下を削除 (#415)", () => {
    const ag = makeGroup();
    removeStep(ag, "s6-c-1");
    const s6 = findStep(ag, "s6");
    expect((s6?.onCommit ?? []).length).toBe(0);
  });
  it("transactionScope.onRollback 配下を削除 (#415)", () => {
    const ag = makeGroup();
    removeStep(ag, "s6-r-1");
    const s6 = findStep(ag, "s6");
    expect((s6?.onRollback ?? []).length).toBe(0);
  });
});

describe("moveStep", () => {
  it("同一配列内で並び替え", () => {
    const ag = makeGroup();
    moveStep(ag, "s1", 2);
    const ids = ag.actions[0].steps.map((s) => s.id);
    expect(ids.slice(0, 3)).toEqual(["s2", "s3", "s1"]);
  });
  it("範囲外 index は clamp", () => {
    const ag = makeGroup();
    moveStep(ag, "s1", 999);
    const ids = ag.actions[0].steps.map((s) => s.id);
    expect(ids[ids.length - 1]).toBe("s1");
  });
  it("transactionScope.steps 内で並び替え (#415)", () => {
    const ag = makeGroup();
    moveStep(ag, "s6-tx-1", 1);
    const s6 = findStep(ag, "s6");
    const ids = (s6?.steps ?? []).map((s) => s.id);
    expect(ids).toEqual(["s6-tx-2", "s6-tx-1"]);
  });
});

describe("setMaturity", () => {
  it("group レベル", () => {
    const ag = makeGroup();
    setMaturity(ag, "group", undefined, "committed");
    expect(ag.maturity).toBe("committed");
  });
  it("action レベル", () => {
    const ag = makeGroup();
    setMaturity(ag, "action", "act-1", "provisional");
    expect(ag.actions[0].maturity).toBe("provisional");
  });
  it("step レベル (ネスト対応)", () => {
    const ag = makeGroup();
    setMaturity(ag, "step", "s3-a-1", "committed");
    expect(findStep(ag, "s3-a-1")?.maturity).toBe("committed");
  });
  it("未知 targetId で throw", () => {
    const ag = makeGroup();
    expect(() => setMaturity(ag, "step", "nope", "committed")).toThrow();
  });
});

describe("addStepNote", () => {
  it("notes 配列に追加", () => {
    const ag = makeGroup();
    const { id } = addStepNote(ag, "s1", "question", "これで合ってる?");
    const s = findStep(ag, "s1");
    expect(s?.notes?.length).toBe(1);
    expect(s?.notes?.[0].id).toBe(id);
    expect(s?.notes?.[0].type).toBe("question");
  });
});

describe("addCatalogEntry / removeCatalogEntry", () => {
  it("errorCatalog に追加・削除", () => {
    const ag = makeGroup();
    addCatalogEntry(ag, "errorCatalog", "STOCK_SHORTAGE", { httpStatus: 409 });
    expect(ag.errorCatalog?.STOCK_SHORTAGE).toEqual({ httpStatus: 409 });
    removeCatalogEntry(ag, "errorCatalog", "STOCK_SHORTAGE");
    expect(ag.errorCatalog).toBeUndefined();
  });
  it("secretsCatalog を複数追加、一部削除", () => {
    const ag = makeGroup();
    addCatalogEntry(ag, "secretsCatalog", "a", { source: "env", name: "A" });
    addCatalogEntry(ag, "secretsCatalog", "b", { source: "env", name: "B" });
    removeCatalogEntry(ag, "secretsCatalog", "a");
    expect(Object.keys(ag.secretsCatalog ?? {})).toEqual(["b"]);
  });
});

describe("markers (#261)", () => {
  it("addMarker → listMarkers で取得", () => {
    const ag = makeGroup();
    const m = addMarker(ag, { kind: "chat", body: "ここ直して", author: "human" });
    expect(m.id).toMatch(/^mk-/);
    const list = listMarkers(ag);
    expect(list).toHaveLength(1);
  });

  it("listMarkers unresolvedOnly=true (既定) は解決済みを除外", () => {
    const ag = makeGroup();
    const m1 = addMarker(ag, { kind: "chat", body: "A", author: "human" });
    addMarker(ag, { kind: "todo", body: "B", author: "human" });
    resolveMarker(ag, m1.id, "対応済み");
    expect(listMarkers(ag, { unresolvedOnly: true })).toHaveLength(1);
    expect(listMarkers(ag, { unresolvedOnly: false })).toHaveLength(2);
  });

  it("listMarkers stepId で絞込", () => {
    const ag = makeGroup();
    addMarker(ag, { kind: "chat", body: "group 宛", author: "human" });
    addMarker(ag, { kind: "chat", body: "s1 宛", stepId: "s1", author: "human" });
    expect(listMarkers(ag, { stepId: "s1" })).toHaveLength(1);
    expect(listMarkers(ag, { stepId: "s2" })).toHaveLength(0);
  });

  it("resolveMarker で resolvedAt + resolution が設定", () => {
    const ag = makeGroup();
    const m = addMarker(ag, { kind: "question", body: "?", author: "human" });
    resolveMarker(ag, m.id, "回答しました");
    const found = (ag.markers ?? []).find((x) => x.id === m.id);
    expect(found?.resolvedAt).toBeDefined();
    expect(found?.resolution).toBe("回答しました");
  });

  it("removeMarker は完全削除", () => {
    const ag = makeGroup();
    const m = addMarker(ag, { kind: "chat", body: "A", author: "human" });
    removeMarker(ag, m.id);
    expect(ag.markers).toBeUndefined();
  });

  it("未知 id は throw", () => {
    const ag = makeGroup();
    expect(() => resolveMarker(ag, "nope")).toThrow();
    expect(() => removeMarker(ag, "nope")).toThrow();
  });
});

describe("findAllMarkers", () => {
  function group(id: string, name: string, markers: Array<{ kind: "chat" | "attention" | "todo" | "question"; body: string; resolved?: boolean }>): { id: string; name: string; ag: ProcessFlowDoc } {
    const ag: ProcessFlowDoc = { id, actions: [{ id: `${id}-a`, steps: [] }] };
    for (const m of markers) {
      const added = addMarker(ag, { kind: m.kind, body: m.body, author: "human" });
      if (m.resolved) resolveMarker(ag, added.id, "ok");
    }
    return { id, name, ag };
  }

  it("複数 AG を横断し processFlowId / processFlowName 付きで返す", () => {
    const groups = [
      group("ag-a", "A", [{ kind: "todo", body: "X" }, { kind: "question", body: "Y" }]),
      group("ag-b", "B", [{ kind: "chat", body: "Z" }]),
    ];
    const all = findAllMarkers(groups);
    expect(all).toHaveLength(3);
    expect(all[0].processFlowId).toBe("ag-a");
    expect(all[0].processFlowName).toBe("A");
    expect(all[2].processFlowId).toBe("ag-b");
  });

  it("unresolvedOnly=true (既定) で解決済みは除外", () => {
    const groups = [
      group("ag-a", "A", [{ kind: "todo", body: "open" }, { kind: "todo", body: "done", resolved: true }]),
    ];
    expect(findAllMarkers(groups, { unresolvedOnly: true })).toHaveLength(1);
    expect(findAllMarkers(groups, { unresolvedOnly: false })).toHaveLength(2);
  });

  it("kind フィルタで特定種別のみ抽出", () => {
    const groups = [
      group("ag-a", "A", [{ kind: "todo", body: "t" }, { kind: "question", body: "q" }]),
      group("ag-b", "B", [{ kind: "todo", body: "t2" }]),
    ];
    const onlyTodo = findAllMarkers(groups, { kind: "todo" });
    expect(onlyTodo).toHaveLength(2);
    expect(onlyTodo.every((m) => m.kind === "todo")).toBe(true);
  });

  it("マーカーなし AG は結果に含まれない (空配列を返すだけ)", () => {
    const groups = [
      group("ag-empty", "Empty", []),
      group("ag-has", "Has", [{ kind: "chat", body: "x" }]),
    ];
    const all = findAllMarkers(groups);
    expect(all).toHaveLength(1);
    expect(all[0].processFlowId).toBe("ag-has");
  });
});

describe("insertStepAt", () => {
  it("末尾に追加 (position 省略)", () => {
    const ag = makeGroup();
    insertStepAt(ag, "act-1", { id: "new", type: "other", description: "" });
    const steps = ag.actions[0].steps;
    expect(steps[steps.length - 1].id).toBe("new");
  });
  it("中間位置に挿入", () => {
    const ag = makeGroup();
    insertStepAt(ag, "act-1", { id: "new", type: "other", description: "" }, 2);
    expect(ag.actions[0].steps[2].id).toBe("new");
  });
  it("未知 actionId で throw", () => {
    const ag = makeGroup();
    expect(() => insertStepAt(ag, "nope", { id: "x", type: "other", description: "" })).toThrow();
  });
});
