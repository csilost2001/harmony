import { describe, it, expect } from "vitest";
import { validateScreenRefs } from "./screenRefValidation";
import type { Screen } from "../types/v3/screen";

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
