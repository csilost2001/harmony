import { describe, it, expect } from "vitest";
import { validateScreenRefs } from "./screenRefValidation";
import type { Screen } from "../types/v3/screen";

function makeScreen(partial: Partial<Screen>): Screen {
  return {
    id: "s1",
    name: "test",
    purpose: "page",
    kind: "form",
    path: "/test",
    items: [],
    ...partial,
  } as unknown as Screen;
}

describe("validateScreenRefs (#1090 Phase 2)", () => {
  it("fragmentRef が catalog 内 → no issue", () => {
    const issues = validateScreenRefs(
      makeScreen({
        fragments: [
          { fragmentRef: "generic-definitions/ui-fragment/messageArea", instanceId: "errorArea" },
        ],
      } as Partial<Screen>),
      { genericDefinitionNames: { "ui-fragment": new Set(["messageArea"]) } },
    );
    expect(issues).toHaveLength(0);
  });

  it("fragmentRef が catalog 外 → UNKNOWN_FRAGMENT_REF (severity warning)", () => {
    const issues = validateScreenRefs(
      makeScreen({
        fragments: [
          { fragmentRef: "generic-definitions/ui-fragment/NonExistentFragment" },
        ],
      } as Partial<Screen>),
      { genericDefinitionNames: { "ui-fragment": new Set(["messageArea"]) } },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_FRAGMENT_REF");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].field).toBe("fragments[0].fragmentRef");
    expect(issues[0].message).toContain("NonExistentFragment");
  });

  it("複数 fragmentRef (一部切れ) → 切れた数だけ issue", () => {
    const issues = validateScreenRefs(
      makeScreen({
        fragments: [
          { fragmentRef: "generic-definitions/ui-fragment/messageArea", instanceId: "errorArea" },
          { fragmentRef: "generic-definitions/ui-fragment/Missing1" },
          { fragmentRef: "generic-definitions/ui-fragment/messageArea", instanceId: "infoArea" },
          { fragmentRef: "generic-definitions/ui-fragment/Missing2" },
        ],
      } as Partial<Screen>),
      { genericDefinitionNames: { "ui-fragment": new Set(["messageArea"]) } },
    );
    expect(issues).toHaveLength(2);
    expect(issues[0].field).toBe("fragments[1].fragmentRef");
    expect(issues[1].field).toBe("fragments[3].fragmentRef");
  });

  it("genericDefinitionNames['ui-fragment'] 未指定 → silent pass", () => {
    // catalog ロード失敗時の互換性維持: 検査しない (誤検出を避ける)
    const issues = validateScreenRefs(
      makeScreen({
        fragments: [
          { fragmentRef: "generic-definitions/ui-fragment/Whatever" },
        ],
      } as Partial<Screen>),
    );
    expect(issues).toHaveLength(0);

    // options 自体が undefined の場合も silent
    const issues2 = validateScreenRefs(
      makeScreen({
        fragments: [
          { fragmentRef: "generic-definitions/ui-fragment/Whatever" },
        ],
      } as Partial<Screen>),
      undefined,
    );
    expect(issues2).toHaveLength(0);
  });

  it("空 Set → 全 ref が UNKNOWN_FRAGMENT_REF (catalog 0 件 = 全部 catalog 外)", () => {
    const issues = validateScreenRefs(
      makeScreen({
        fragments: [
          { fragmentRef: "generic-definitions/ui-fragment/messageArea" },
        ],
      } as Partial<Screen>),
      { genericDefinitionNames: { "ui-fragment": new Set() } },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_FRAGMENT_REF");
  });

  it("screen.fragments undefined / 空配列 → no issue", () => {
    const issuesUndef = validateScreenRefs(
      makeScreen({}),
      { genericDefinitionNames: { "ui-fragment": new Set(["messageArea"]) } },
    );
    expect(issuesUndef).toHaveLength(0);

    const issuesEmpty = validateScreenRefs(
      makeScreen({ fragments: [] } as Partial<Screen>),
      { genericDefinitionNames: { "ui-fragment": new Set(["messageArea"]) } },
    );
    expect(issuesEmpty).toHaveLength(0);
  });

  it("AJV pattern 不一致 (形式違反) → silent pass (AJV 側で error 報告される領域)", () => {
    const issues = validateScreenRefs(
      makeScreen({
        fragments: [
          // pattern にマッチしない (kind 部不正)
          { fragmentRef: "generic-definitions/wrong-kind/Whatever" },
          // pattern にマッチしない (prefix 不正)
          { fragmentRef: "ui-fragment/Whatever" },
        ],
      } as Partial<Screen>),
      { genericDefinitionNames: { "ui-fragment": new Set(["messageArea"]) } },
    );
    expect(issues).toHaveLength(0);
  });
});

// ─── #1318: dialog / messageArea / options prefix 参照整合性 ────────────────────
//
// ScreenItem.events[].effects[] 内の `@dialog.<n>` / `@messageArea.<n>` / `@options.<n>` 参照を
// 対応 catalog (kind: dialog / message-area / options) と突合する。
// prefix と kind は分離設計 (#1318): kind は kebab-case 統一 (`message-area`)、prefix は
// camelCase 維持 (`messageArea`、log-event/logEvent 前例と同じパターン)。
function makeScreenWithEffect(effect: Record<string, unknown>): Screen {
  return {
    id: "s1",
    name: "test",
    purpose: "page",
    kind: "form",
    path: "/test",
    items: [
      {
        id: "btn1",
        kind: "button",
        label: "click me",
        events: [
          {
            id: "click",
            handlerFlowId: "flow1",
            effects: [effect],
          },
        ],
      },
    ],
  } as unknown as Screen;
}

describe("validateScreenRefs effects[] dialog/messageArea/options (#1318)", () => {
  it("@dialog.<n> が catalog 内 → no issue", () => {
    const issues = validateScreenRefs(
      makeScreenWithEffect({ kind: "showDialog", target: "@dialog.ConfirmDelete" }),
      { genericDefinitionNames: { dialog: new Set(["ConfirmDelete", "AlertWarning"]) } },
    );
    expect(issues).toHaveLength(0);
  });

  it("@dialog.<n> が catalog 外 → UNKNOWN_DIALOG_REF (severity warning)", () => {
    const issues = validateScreenRefs(
      makeScreenWithEffect({ kind: "showDialog", target: "@dialog.NonExistent" }),
      { genericDefinitionNames: { dialog: new Set(["ConfirmDelete"]) } },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_DIALOG_REF");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].field).toBe("items[0].events[0].effects[0].target");
    expect(issues[0].message).toContain("@dialog.NonExistent");
  });

  it("@messageArea.<n> が catalog 内 → no issue", () => {
    const issues = validateScreenRefs(
      makeScreenWithEffect({ kind: "setMessage", target: "@messageArea.ErrorArea" }),
      { genericDefinitionNames: { "message-area": new Set(["ErrorArea", "InfoArea"]) } },
    );
    expect(issues).toHaveLength(0);
  });

  it("@messageArea.<n> が catalog 外 → UNKNOWN_MESSAGE_AREA_REF", () => {
    const issues = validateScreenRefs(
      makeScreenWithEffect({ kind: "setMessage", target: "@messageArea.GhostArea" }),
      { genericDefinitionNames: { "message-area": new Set(["ErrorArea"]) } },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_MESSAGE_AREA_REF");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].field).toBe("items[0].events[0].effects[0].target");
    expect(issues[0].message).toContain("@messageArea.GhostArea");
    expect(issues[0].message).toContain("generic-definitions/message-area");
  });

  it("@options.<n> が catalog 内 → no issue", () => {
    const issues = validateScreenRefs(
      makeScreenWithEffect({ kind: "setOptions", target: "list1", value: "@options.StatusList" }),
      { genericDefinitionNames: { options: new Set(["StatusList", "PrefectureList"]) } },
    );
    expect(issues).toHaveLength(0);
  });

  it("@options.<n> が catalog 外 → UNKNOWN_OPTIONS_REF", () => {
    const issues = validateScreenRefs(
      makeScreenWithEffect({ kind: "setOptions", target: "list1", value: "@options.MissingOpts" }),
      { genericDefinitionNames: { options: new Set(["StatusList"]) } },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_OPTIONS_REF");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].field).toBe("items[0].events[0].effects[0].value");
    expect(issues[0].message).toContain("@options.MissingOpts");
  });

  it("Set 未指定 (silent pass) — 各 prefix で個別判定", () => {
    // dialog のみ指定 → setMessage / setOptions は silent pass
    const issues = validateScreenRefs(
      {
        ...makeScreenWithEffect({ kind: "showDialog", target: "@dialog.ConfirmDelete" }),
        items: [
          {
            id: "btn1",
            kind: "button",
            label: "x",
            events: [
              {
                id: "click",
                handlerFlowId: "flow1",
                effects: [
                  { kind: "showDialog", target: "@dialog.ConfirmDelete" },
                  { kind: "setMessage", target: "@messageArea.Whatever" },
                  { kind: "setOptions", target: "list1", value: "@options.Whatever" },
                ],
              },
            ],
          },
        ],
      } as unknown as Screen,
      { genericDefinitionNames: { dialog: new Set(["ConfirmDelete"]) } },
    );
    expect(issues).toHaveLength(0);
  });

  it("plain identifier (no @ prefix) → silent pass (prefix 形式のみ検証)", () => {
    // target に @dialog. が無い場合 (catalog name 直書き) は本 validator では検査しない
    // (catalog 直書きの semantic は schema description のみで、形式上 TemplateString として扱う)
    const issues = validateScreenRefs(
      makeScreenWithEffect({ kind: "showDialog", target: "ConfirmDelete" }),
      { genericDefinitionNames: { dialog: new Set([]) } },
    );
    expect(issues).toHaveLength(0);
  });

  it("複数 effect の混在 → 該当する prefix のみ broken-ref 検出", () => {
    const screen = {
      id: "s1",
      name: "test",
      purpose: "page",
      kind: "form",
      path: "/test",
      items: [
        {
          id: "btn1",
          kind: "button",
          label: "x",
          events: [
            {
              id: "click",
              handlerFlowId: "flow1",
              effects: [
                { kind: "showDialog", target: "@dialog.ConfirmDelete" }, // OK
                { kind: "showDialog", target: "@dialog.MissingDialog" }, // broken
                { kind: "setMessage", target: "@messageArea.ErrorArea" }, // OK
                { kind: "setMessage", target: "@messageArea.MissingArea" }, // broken
                { kind: "setOptions", target: "list1", value: "@options.StatusList" }, // OK
                { kind: "setOptions", target: "list1", value: "@options.MissingOpts" }, // broken
              ],
            },
          ],
        },
      ],
    } as unknown as Screen;
    const issues = validateScreenRefs(screen, {
      genericDefinitionNames: {
        dialog: new Set(["ConfirmDelete"]),
        "message-area": new Set(["ErrorArea"]),
        options: new Set(["StatusList"]),
      },
    });
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.code).sort()).toEqual([
      "UNKNOWN_DIALOG_REF",
      "UNKNOWN_MESSAGE_AREA_REF",
      "UNKNOWN_OPTIONS_REF",
    ]);
  });
});
