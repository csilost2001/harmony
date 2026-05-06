import { describe, expect, it } from "vitest";
import type { ProcessFlow, BranchStep, OtherStep, JumpStep, LoopStep } from "../types/action";
import { migrateProcessFlow, migrateStep, PROCESS_FLOW_V3_SCHEMA_REF } from "./actionMigration";

// ─── migrateStep — BranchStep legacy → new ──────────────────────────────────

describe("migrateStep — BranchStep legacy → new", () => {
  it("旧 branchA/branchB/condition を branches[] に変換する", () => {
    const legacy = {
      id: "step-001",
      kind: "branch",
      description: "認証結果判定",
      condition: "トークンが有効か",
      branchA: { label: "有効", description: "処理を続行" },
      branchB: { label: "無効", description: "ログイン画面へリダイレクト" },
    };
    const migrated = migrateStep(legacy) as BranchStep;

    expect(migrated.kind).toBe("branch");
    expect(migrated.description).toBe("認証結果判定");
    expect(migrated.branches).toHaveLength(2);

    const a = migrated.branches[0];
    expect(a.code).toBe("A");
    expect(a.label).toBe("有効");
    // v3: condition は {kind: "expression", expression: "..."} オブジェクト
    expect(a.condition).toEqual({ kind: "expression", expression: "トークンが有効か" });
    expect(a.steps).toHaveLength(1);
    // v3: "other" → "legacy:OtherStep"
    expect((a.steps[0] as OtherStep).kind).toBe("legacy:OtherStep");
    expect((a.steps[0] as OtherStep).description).toBe("処理を続行");
    expect(a.id).toMatch(/[0-9a-f-]{36}/);

    const b = migrated.branches[1];
    expect(b.code).toBe("B");
    expect(b.label).toBe("無効");
    // branchB の condition は空文字 → {kind: "expression", expression: ""}
    expect(b.condition).toEqual({ kind: "expression", expression: "" });
    expect((b.steps[0] as OtherStep).description).toBe("ログイン画面へリダイレクト");

    // 旧フィールドが除去されている
    expect((migrated as unknown as { condition?: string }).condition).toBeUndefined();
    expect((migrated as unknown as { branchA?: unknown }).branchA).toBeUndefined();
    expect((migrated as unknown as { branchB?: unknown }).branchB).toBeUndefined();
  });

  it("branchA/B の jumpTo は jump ステップに変換される", () => {
    const legacy = {
      id: "step-jump-001",
      kind: "branch",
      description: "",
      condition: "",
      branchA: { label: "", description: "", jumpTo: "target-a" },
      branchB: { label: "", description: "処理", jumpTo: "target-b" },
    };
    const migrated = migrateStep(legacy) as BranchStep;

    expect(migrated.branches[0].steps).toHaveLength(1);
    const jumpA = migrated.branches[0].steps[0] as JumpStep;
    expect(jumpA.kind).toBe("jump");
    expect(jumpA.jumpTo).toBe("target-a");

    // B は description と jumpTo 両方あり → legacy:OtherStep + jump の 2 ステップ
    expect(migrated.branches[1].steps).toHaveLength(2);
    expect((migrated.branches[1].steps[0] as OtherStep).description).toBe("処理");
    expect((migrated.branches[1].steps[1] as JumpStep).jumpTo).toBe("target-b");
  });

  it("description も jumpTo も空なら空の steps を持つ Branch を生成", () => {
    const legacy = {
      id: "step-empty",
      kind: "branch",
      description: "",
      condition: "",
      branchA: { label: "", description: "" },
      branchB: { label: "", description: "" },
    };
    const migrated = migrateStep(legacy) as BranchStep;
    expect(migrated.branches[0].steps).toEqual([]);
    expect(migrated.branches[1].steps).toEqual([]);
    expect(migrated.branches[0].label).toBeUndefined();
  });

  it("loop ステップ内の branch.branches[].steps 内の旧 branch も再帰変換される (subSteps は v3 廃止)", () => {
    // v3 では OtherStep に subSteps は存在しない。代わりに loop.steps の中に branch を入れて検証
    const loopWithNestedBranch = {
      id: "loop-outer",
      kind: "loop",
      description: "ループ",
      loopKind: "count",
      steps: [
        {
          id: "branch-in-branch",
          kind: "branch",
          description: "",
          condition: "outer-cond",
          branchA: {
            label: "Y",
            description: "",
            jumpTo: "",
            // branchA の内側に旧 branch (steps に入れる形で渡すのは不可なので branches で持つ)
          },
          branchB: { label: "N", description: "ng" },
        },
      ],
    };
    const migrated = migrateStep(loopWithNestedBranch) as LoopStep;
    expect(migrated.kind).toBe("loop");
    const br = migrated.steps[0] as BranchStep;
    expect(br.kind).toBe("branch");
    expect(br.branches[0].condition).toEqual({ kind: "expression", expression: "outer-cond" });
    expect(br.branches[1].steps[0].kind).toBe("legacy:OtherStep");
  });

  it("既に v3 形式の BranchStep は branches の condition をそのまま保持する（冪等）", () => {
    const v3Shape = {
      id: "branch-new",
      kind: "branch",
      description: "",
      branches: [
        { id: "br1", code: "A", label: "A", condition: { kind: "expression", expression: "c1" }, steps: [] },
        { id: "br2", code: "B", condition: { kind: "expression", expression: "" }, steps: [] },
      ],
    };
    const migrated = migrateStep(v3Shape) as BranchStep;
    expect(migrated.branches).toHaveLength(2);
    expect(migrated.branches[0].id).toBe("br1");
    expect(migrated.branches[0].condition).toEqual({ kind: "expression", expression: "c1" });
    expect(migrated.branches[1].code).toBe("B");
  });

  it("v3 Branch.steps 内のネストした旧 branch も変換される", () => {
    const v3ShapeWithLegacyInner = {
      id: "outer",
      kind: "branch",
      description: "",
      branches: [
        {
          id: "br1",
          code: "A",
          condition: { kind: "expression", expression: "" },
          steps: [
            {
              id: "inner",
              kind: "branch",
              description: "",
              condition: "inner-cond",
              branchA: { label: "", description: "x" },
              branchB: { label: "", description: "y" },
            },
          ],
        },
      ],
    };
    const migrated = migrateStep(v3ShapeWithLegacyInner) as BranchStep;
    const inner = migrated.branches[0].steps[0] as BranchStep;
    expect(inner.branches).toHaveLength(2);
    expect(inner.branches[0].condition).toEqual({ kind: "expression", expression: "inner-cond" });
  });

  it("loop ステップの steps 内の旧 branch も再帰変換される", () => {
    const loopLegacy = {
      id: "loop-1",
      kind: "loop",
      description: "",
      loopKind: "count",
      steps: [
        {
          id: "branch-inside-loop",
          kind: "branch",
          description: "",
          condition: "cc",
          branchA: { label: "a", description: "" },
          branchB: { label: "b", description: "" },
        },
      ],
    };
    const migrated = migrateStep(loopLegacy) as LoopStep;
    const br = migrated.steps[0] as BranchStep;
    // v3: condition はオブジェクト
    expect(br.branches[0].condition).toEqual({ kind: "expression", expression: "cc" });
    expect(br.branches[0].label).toBe("a");
  });

  it("非 branch ステップは構造を保持しつつ maturity 既定値を追加する (#154)", () => {
    // v3: tableName → tableId に変換される
    const other = {
      id: "x",
      kind: "dbAccess",
      description: "",
      tableName: "users",
      operation: "SELECT",
    };
    const migrated = migrateStep(other);
    expect(migrated.kind).toBe("dbAccess");
    expect(migrated.tableId).toBe("users");
    expect((migrated as unknown as { tableName?: string }).tableName).toBeUndefined();
    expect(migrated.maturity).toBe("draft");
    expect(migrated).not.toBe(other); // clone されている
  });

  it("元データを破壊しない", () => {
    const legacy = {
      id: "s",
      kind: "branch",
      description: "",
      condition: "orig-condition",
      branchA: { label: "A", description: "A-desc" },
      branchB: { label: "B", description: "B-desc" },
    };
    const before = JSON.stringify(legacy);
    migrateStep(legacy);
    expect(JSON.stringify(legacy)).toBe(before);
  });
});

// ─── migrateProcessFlow — ProcessFlow 全体 ──────────────────────────────────

describe("migrateProcessFlow — ProcessFlow 全体", () => {
  it("既存サンプルの認証チェック ProcessFlow を正しく変換する", () => {
    // 旧 v1 形式サンプル相当のデータ (インライン)
    const sample = {
      id: "cccccccc-0003-4000-8000-cccccccccccc",
      name: "認証チェック",
      type: "common",
      description: "セッション・トークン検証を行う共通処理",
      actions: [
        {
          id: "act-auth-001",
          name: "認証処理",
          trigger: "other",
          steps: [
            {
              id: "step-auth-001",
              kind: "validation",
              description: "セッション有効性チェック",
              conditions: "セッションIDの存在確認・有効期限チェック",
              inlineBranch: { ok: [], ng: [] },
            },
            {
              id: "step-auth-003",
              kind: "branch",
              description: "認証結果判定",
              condition: "トークンが有効か",
              branchA: { label: "有効", description: "処理を続行" },
              branchB: { label: "無効", description: "ログイン画面へリダイレクト", jumpTo: "" },
            },
          ],
        },
      ],
      createdAt: "2026-04-14T00:00:00.000Z",
      updatedAt: "2026-04-14T00:00:00.000Z",
    };

    const migrated = migrateProcessFlow(sample) as ProcessFlow;

    // v3: id / name / type は meta に移動 (v3 vocabulary に直接アクセス)
    expect(migrated.meta.id).toBe(sample.id);
    expect(migrated.meta.kind).toBe("common");
    expect(migrated.actions).toHaveLength(1);
    const steps = migrated.actions[0].steps;
    expect(steps).toHaveLength(2);

    // validation はそのまま
    expect(steps[0].kind).toBe("validation");

    // branch は v3 形式に変換
    const branch = steps[1] as BranchStep;
    expect(branch.kind).toBe("branch");
    expect(branch.branches).toHaveLength(2);
    expect(branch.branches[0].label).toBe("有効");
    expect(branch.branches[0].condition).toEqual({ kind: "expression", expression: "トークンが有効か" });
    expect(branch.branches[1].label).toBe("無効");
    // 空文字 jumpTo は jump ステップを作らない
    expect(branch.branches[1].steps).toHaveLength(1);
    expect((branch.branches[1].steps[0] as OtherStep).kind).toBe("legacy:OtherStep");
  });

  it("冪等性: 2 回マイグレーションしても結果が同じ", () => {
    const sample = {
      id: "g",
      name: "x",
      type: "common",
      description: "",
      actions: [
        {
          id: "a",
          name: "a",
          trigger: "other",
          steps: [
            {
              id: "s",
              kind: "branch",
              description: "",
              condition: "c",
              branchA: { label: "A", description: "ad" },
              branchB: { label: "B", description: "bd" },
            },
          ],
        },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const once = migrateProcessFlow(sample);
    const twice = migrateProcessFlow(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

// ─── migrateStep — 旧 note → notes[] / maturity 既定付与 (#154) ─────────────

describe("migrateStep — 旧 note → notes[] / maturity 既定付与 (#154)", () => {
  it("旧 note: string を notes[] ({kind: 'assumption'}) に変換する", () => {
    const legacy = {
      id: "s1",
      kind: "legacy:OtherStep",
      description: "",
      note: "想定: 共通処理は後ほど設計予定",
    };
    const migrated = migrateStep(legacy);
    const s = migrated as unknown as { note?: string; notes?: Array<{ id: string; kind: string; body: string; createdAt: string }> };
    expect(s.notes).toHaveLength(1);
    // v3: kind (not type)
    expect(s.notes![0].kind).toBe("assumption");
    expect(s.notes![0].body).toBe("想定: 共通処理は後ほど設計予定");
    expect(s.notes![0].id).toMatch(/[0-9a-f-]{36}/);
    expect(s.notes![0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 旧 note フィールドは削除される
    expect(s.note).toBeUndefined();
  });

  it("note が空文字・空白のみ・未設定の場合は notes[] を作らず、note フィールドを消す", () => {
    const empty1 = migrateStep({ id: "a", kind: "legacy:OtherStep", description: "", note: "" });
    expect((empty1 as unknown as { notes?: unknown[] }).notes).toBeUndefined();
    expect((empty1 as unknown as { note?: string }).note).toBeUndefined();

    const empty2 = migrateStep({ id: "b", kind: "legacy:OtherStep", description: "", note: "   " });
    expect((empty2 as unknown as { notes?: unknown[] }).notes).toBeUndefined();
    expect((empty2 as unknown as { note?: string }).note).toBeUndefined();

    const empty3 = migrateStep({ id: "c", kind: "legacy:OtherStep", description: "" });
    expect((empty3 as unknown as { notes?: unknown[] }).notes).toBeUndefined();
  });

  it("notes[] が既にあれば note を破棄し、notes[] をそのまま維持する", () => {
    const existing = {
      id: "s",
      kind: "legacy:OtherStep",
      description: "",
      note: "これは無視される",
      notes: [{ id: "n-1", kind: "todo", body: "既存", createdAt: "2026-01-01T00:00:00.000Z" }],
    };
    const migrated = migrateStep(existing);
    const s = migrated as unknown as { note?: string; notes?: Array<{ id: string; kind: string; body: string }> };
    expect(s.notes).toHaveLength(1);
    expect(s.notes![0].id).toBe("n-1");
    expect(s.notes![0].body).toBe("既存");
    expect(s.note).toBeUndefined();
  });

  it("maturity が未設定なら 'draft' を付与する", () => {
    const legacy = { id: "s", kind: "legacy:OtherStep", description: "" };
    const migrated = migrateStep(legacy) as unknown as { maturity?: string };
    expect(migrated.maturity).toBe("draft");
  });

  it("maturity が有効値 ('provisional' / 'committed') なら保持する", () => {
    const provisional = migrateStep({ id: "s", kind: "legacy:OtherStep", description: "", maturity: "provisional" }) as unknown as { maturity?: string };
    expect(provisional.maturity).toBe("provisional");
    const committed = migrateStep({ id: "s", kind: "legacy:OtherStep", description: "", maturity: "committed" }) as unknown as { maturity?: string };
    expect(committed.maturity).toBe("committed");
  });

  it("maturity が不正値 (未知文字列 / 数値 / null) なら 'draft' に矯正する", () => {
    const invalid1 = migrateStep({ id: "s", kind: "legacy:OtherStep", description: "", maturity: "unknown" }) as unknown as { maturity?: string };
    expect(invalid1.maturity).toBe("draft");
    const invalid2 = migrateStep({ id: "s", kind: "legacy:OtherStep", description: "", maturity: 42 }) as unknown as { maturity?: string };
    expect(invalid2.maturity).toBe("draft");
    const invalid3 = migrateStep({ id: "s", kind: "legacy:OtherStep", description: "", maturity: null }) as unknown as { maturity?: string };
    expect(invalid3.maturity).toBe("draft");
  });

  it("ネスト (branch.branches[].steps / loop.steps) の note / maturity も再帰的に正規化 (v3: subSteps 廃止)", () => {
    // v3 では subSteps は廃止。loop.steps → branch.branches[].steps で再帰検証
    const legacy = {
      id: "parent-loop",
      kind: "loop",
      description: "",
      loopKind: "collection",
      note: "親の想定",
      steps: [
        {
          id: "inner-branch",
          kind: "branch",
          description: "",
          branches: [
            {
              id: "b1",
              code: "A",
              condition: { kind: "expression", expression: "" },
              steps: [
                {
                  id: "leaf",
                  kind: "dbAccess",
                  description: "",
                  tableName: "x",
                  operation: "SELECT",
                  note: "葉の想定",
                },
              ],
            },
          ],
        },
      ],
    };
    const migrated = migrateStep(legacy) as unknown as {
      maturity?: string;
      notes?: Array<{ body: string }>;
      steps: Array<{
        branches: Array<{
          steps: Array<{ notes?: Array<{ body: string }>; maturity?: string }>;
        }>;
      }>;
    };
    expect(migrated.maturity).toBe("draft");
    expect(migrated.notes?.[0].body).toBe("親の想定");
    const innerBranch = migrated.steps[0];
    const leaf = innerBranch.branches[0].steps[0];
    expect(leaf.maturity).toBe("draft");
    expect(leaf.notes?.[0].body).toBe("葉の想定");
  });
});

// ─── migrateProcessFlow — v3 root 4 セクション化 + maturity / mode (#154) ────

describe("migrateProcessFlow — v3 root 4 セクション化 + maturity / mode 既定付与 (#154)", () => {
  it("v1 root type/meta/catalog/authoring を v3 4 セクション (meta/context/actions/authoring) に移行する", () => {
    const migrated = migrateProcessFlow({
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      name: "注文登録",
      type: "screen",
      screenId: "bbbbbbbb-0000-4000-8000-000000000001",
      description: "desc",
      mode: "downstream",
      maturity: "committed",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      errorCatalog: { VALIDATION: { httpStatus: 400 } },
      externalSystemCatalog: { payment: { name: "Payment" } },
      secretsCatalog: { paymentKey: { source: "env", name: "PAYMENT_KEY" } },
      ambientVariables: [{ name: "requestId", type: "string" }],
      markers: [{ id: "aaaaaaaa-0000-4000-8000-000000000002", kind: "todo", body: "確認", author: "human", createdAt: "2026-04-01T00:00:00.000Z" }],
      actions: [],
    });

    expect(migrated.$schema).toBe(PROCESS_FLOW_V3_SCHEMA_REF);
    expect(migrated.meta).toMatchObject({
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      name: "注文登録",
      kind: "screen",
      screenId: "bbbbbbbb-0000-4000-8000-000000000001",
      mode: "downstream",
      maturity: "committed",
    });
    expect(migrated.context?.catalogs?.errors?.VALIDATION.httpStatus).toBe(400);
    expect(migrated.context?.catalogs?.externalSystems?.payment.name).toBe("Payment");
    expect(migrated.context?.catalogs?.secrets?.paymentKey.name).toBe("PAYMENT_KEY");
    expect(migrated.context?.ambientVariables?.[0].name).toBe("requestId");
    expect(migrated.authoring?.markers?.[0].body).toBe("確認");
  });

  it("group.maturity 未設定なら 'draft'、group.mode 未設定なら 'upstream' を付与する", () => {
    const raw = {
      id: "g1",
      name: "x",
      type: "screen",
      description: "",
      actions: [],
      createdAt: "",
      updatedAt: "",
    };
    const migrated = migrateProcessFlow(raw);
    // v3: meta.maturity / meta.mode に直接アクセス
    expect(migrated.meta.maturity).toBe("draft");
    expect(migrated.meta.mode).toBe("upstream");
  });

  it("group.maturity / mode の有効値は保持する", () => {
    const raw = {
      id: "g1",
      name: "x",
      type: "screen",
      description: "",
      actions: [],
      createdAt: "",
      updatedAt: "",
      maturity: "committed",
      mode: "downstream",
    };
    const migrated = migrateProcessFlow(raw);
    expect(migrated.meta.maturity).toBe("committed");
    expect(migrated.meta.mode).toBe("downstream");
  });

  it("action.maturity 未設定なら 'draft' を付与する", () => {
    const raw = {
      id: "g1",
      name: "x",
      type: "screen",
      description: "",
      actions: [
        {
          id: "a1",
          name: "a",
          trigger: "click",
          steps: [],
        },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const migrated = migrateProcessFlow(raw);
    expect(migrated.actions[0].maturity).toBe("draft");
  });

  it("冪等性: note → notes[] 変換 + maturity/mode 付与後、再度マイグレーションしても同じ JSON になる", () => {
    const raw = {
      id: "g",
      name: "x",
      type: "common",
      description: "",
      actions: [
        {
          id: "a",
          name: "a",
          trigger: "other",
          steps: [
            {
              id: "s1",
              kind: "legacy:OtherStep",
              description: "",
              note: "想定: X",
            },
          ],
        },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const once = migrateProcessFlow(raw);
    const twice = migrateProcessFlow(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    // 1 回目で note は消えて notes[] になっている
    const step = once.actions[0].steps[0] as unknown as { note?: string; notes?: Array<{ body: string }> };
    expect(step.note).toBeUndefined();
    expect(step.notes?.[0].body).toBe("想定: X");
  });

  it("v3 shape は再実行しても JSON が変化しない", () => {
    const raw = {
      $schema: PROCESS_FLOW_V3_SCHEMA_REF,
      meta: {
        id: "aaaaaaaa-0000-4000-8000-000000000003",
        name: "v3",
        kind: "common",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      actions: [{
        id: "act",
        name: "act",
        trigger: "other",
        steps: [{ id: "s1", kind: "validation", description: "", rules: [{ field: "x", type: "required", severity: "error" }] }],
      }],
    };
    const once = migrateProcessFlow(raw);
    const twice = migrateProcessFlow(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("step type/rule kind/branch condition/outputBinding を v3 に変換する", () => {
    const migrated = migrateStep({
      id: "b1",
      kind: "branch",
      description: "分岐",
      condition: "@ok",
      outputBinding: "branchResult",
      branchA: {
        label: "OK",
        description: "続行",
      },
      branchB: {
        label: "NG",
        jumpTo: "end",
      },
    });

    expect(migrated.kind).toBe("branch");
    expect(migrated.outputBinding).toEqual({ name: "branchResult" });
    if (migrated.kind !== "branch") throw new Error("not branch");
    expect(migrated.branches[0].condition).toEqual({ kind: "expression", expression: "@ok" });
    expect(migrated.branches[0].steps[0].kind).toBe("legacy:OtherStep");
    expect(migrated.branches[1].steps[0].kind).toBe("jump");
  });
});

// ─── migrateStep — 22 variant 全カバー ──────────────────────────────────────

describe("migrateStep — 22 variant 全カバー (v1 type → v3 kind 変換)", () => {
  it("v1 externalSystem step を v3 kind=externalSystem に変換", () => {
    const v1: any = { id: "s1", type: "externalSystem", description: "外部決済", systemName: "stripe" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("externalSystem");
    // v1 systemName → v3 systemRef
    expect((v3 as any).systemRef).toBe("stripe");
    expect((v3 as any).systemName).toBeUndefined();
  });

  it("v1 commonProcess step を v3 kind=commonProcess に変換", () => {
    const v1: any = { id: "s2", type: "commonProcess", description: "共通処理呼出", refId: "cccccccc-0001-4000-8000-000000000001" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("commonProcess");
    expect((v3 as any).refId).toBe("cccccccc-0001-4000-8000-000000000001");
  });

  it("v1 screenTransition step を v3 kind=screenTransition に変換", () => {
    const v1: any = { id: "s3", type: "screenTransition", description: "画面遷移", targetScreenName: "ログイン画面" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("screenTransition");
    // v1 targetScreenName → v3 targetScreenId (値はそのまま格納)
    expect((v3 as any).targetScreenId).toBe("ログイン画面");
    expect((v3 as any).targetScreenName).toBeUndefined();
  });

  it("v1 displayUpdate step を v3 kind=displayUpdate に変換", () => {
    const v1: any = { id: "s4", type: "displayUpdate", description: "表示更新", target: "orderList" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("displayUpdate");
    expect((v3 as any).target).toBe("orderList");
  });

  it("v1 loopBreak step を v3 kind=loopBreak に変換", () => {
    const v1: any = { id: "s5", type: "loopBreak", description: "ループ中断" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("loopBreak");
  });

  it("v1 loopContinue step を v3 kind=loopContinue に変換", () => {
    const v1: any = { id: "s6", type: "loopContinue", description: "ループ継続" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("loopContinue");
  });

  it("v1 compute step を v3 kind=compute に変換", () => {
    const v1: any = { id: "s7", type: "compute", description: "計算", expression: "price * 1.1" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("compute");
    expect((v3 as any).expression).toBe("price * 1.1");
  });

  it("v1 return step を v3 kind=return に変換", () => {
    const v1: any = { id: "s8", type: "return", description: "返却" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("return");
  });

  it("v1 log step を v3 kind=log に変換", () => {
    const v1: any = { id: "s9", type: "log", description: "ログ出力", level: "info", message: "処理完了" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("log");
    expect((v3 as any).level).toBe("info");
    expect((v3 as any).message).toBe("処理完了");
  });

  it("v1 audit step を v3 kind=audit に変換", () => {
    const v1: any = { id: "s10", type: "audit", description: "監査", action: "ORDER_CREATE" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("audit");
    expect((v3 as any).action).toBe("ORDER_CREATE");
  });

  it("v1 workflow step を v3 kind=workflow に変換", () => {
    const v1: any = {
      id: "s11",
      type: "workflow",
      description: "承認",
      pattern: "approval-sequential",
      approvers: ["manager"],
      quorum: { type: "any" },
    };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("workflow");
    expect((v3 as any).pattern).toBe("approval-sequential");
    expect((v3 as any).approvers).toEqual(["manager"]);
  });

  it("v1 transactionScope step を v3 kind=transactionScope に変換 (子 steps も再帰)", () => {
    const v1: any = {
      id: "s12",
      type: "transactionScope",
      description: "TX",
      isolationLevel: "READ_COMMITTED",
      propagation: "REQUIRED",
      steps: [{ id: "inner", type: "log", description: "TX内ログ", level: "info", message: "x" }],
    };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("transactionScope");
    expect((v3 as any).steps[0].kind).toBe("log");
  });

  it("v1 eventPublish step を v3 kind=eventPublish に変換", () => {
    const v1: any = { id: "s13", type: "eventPublish", description: "イベント発行", topic: "order.created" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("eventPublish");
    expect((v3 as any).topic).toBe("order.created");
  });

  it("v1 eventSubscribe step を v3 kind=eventSubscribe に変換", () => {
    const v1: any = { id: "s14", type: "eventSubscribe", description: "イベント受信", topic: "payment.completed" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("eventSubscribe");
    expect((v3 as any).topic).toBe("payment.completed");
  });

  it("v1 closing step を v3 kind=closing に変換", () => {
    const v1: any = { id: "s15", type: "closing", description: "月次締め", period: "monthly" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("closing");
    expect((v3 as any).period).toBe("monthly");
  });

  it("v1 cdc step を v3 kind=cdc に変換 (tables → tableIds、destination.type → kind)", () => {
    const v1: any = {
      id: "s16",
      type: "cdc",
      description: "CDC",
      tables: ["tbl-001"],
      captureMode: "incremental",
      destination: { type: "auditLog", auditAction: "insert" },
    };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("cdc");
    // v1 tables → v3 tableIds
    expect((v3 as any).tableIds).toEqual(["tbl-001"]);
    expect((v3 as any).tables).toBeUndefined();
    // v1 destination.type → v3 destination.kind
    expect((v3 as any).destination.kind).toBe("auditLog");
    expect((v3 as any).destination.type).toBeUndefined();
  });

  it("v1 extension (other) step を v3 kind=legacy:OtherStep に変換", () => {
    const v1: any = { id: "s17", type: "other", description: "その他処理" };
    const v3 = migrateStep(v1);
    expect(v3.kind).toBe("legacy:OtherStep");
  });

  it("全 variant で v1 type → v3 kind に変換され step.kind が正しく設定される (#570 shim 削除後)", () => {
    const kinds = [
      "validation", "dbAccess", "externalSystem", "commonProcess",
      "screenTransition", "displayUpdate", "branch", "loop",
      "loopBreak", "loopContinue", "jump", "compute", "return",
      "log", "audit", "workflow", "transactionScope",
      "eventPublish", "eventSubscribe", "closing", "cdc",
    ] as const;
    for (const kind of kinds) {
      const v1: any = { id: "sx", type: kind, description: "" };
      // branch は必須フィールドを追加
      if (kind === "branch") {
        v1.branches = [
          { id: "b1", code: "A", condition: { kind: "expression", expression: "" }, steps: [] },
        ];
      }
      if (kind === "dbAccess") v1.tableId = "";
      if (kind === "externalSystem") v1.systemRef = "";
      if (kind === "commonProcess") v1.refId = "";
      if (kind === "screenTransition") v1.targetScreenId = "";
      if (kind === "loop") { v1.loopKind = "count"; v1.steps = []; }
      if (kind === "jump") v1.jumpTo = "";
      if (kind === "compute") v1.expression = "";
      if (kind === "log") { v1.level = "info"; v1.message = ""; }
      if (kind === "audit") v1.action = "";
      if (kind === "workflow") { v1.pattern = "approval-sequential"; v1.approvers = []; v1.quorum = { type: "any" }; }
      if (kind === "transactionScope") { v1.isolationLevel = "READ_COMMITTED"; v1.propagation = "REQUIRED"; v1.steps = []; }
      if (kind === "closing") v1.period = "monthly";
      if (kind === "cdc") { v1.tableIds = []; v1.captureMode = "incremental"; v1.destination = { kind: "auditLog", auditAction: "" }; }
      const v3 = migrateStep(v1) as any;
      // v3 vocabulary: step.kind に変換、step.type は削除される
      expect(v3.kind).toBe(kind);
      expect(v3.type).toBeUndefined();
    }
  });
});
