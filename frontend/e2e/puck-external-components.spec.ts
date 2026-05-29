import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

import type { Data } from "@measured/puck";
import type { CustomPuckComponentDef } from "../src/store/puckComponentsStore";
import type { HarmonyEntities, ScreenEntry, Timestamp } from "../src/types/v3";
import { buildProject } from "./__fixtures__/builders";
import {
  dragPaletteItemToCanvas,
  getPuckContainer,
  makeScreenEntity,
  puckRootDropzone,
  seedExternalPuckComponentFixture,
  writePuckDataFile,
} from "./helpers/puck";
import {
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  repoPath,
  setupTestWorkspace,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { startNewDraft } from "./helpers/editSessionDropdown";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;
const FIXTURE_MANIFEST = repoPath(
  "frontend",
  "src",
  "puck",
  "__tests__",
  "fixtures",
  "external-dogfood",
  "manifest.json",
);

const touchedKeys = new Set<string>();

function approvalData(props: {
  id: string;
  title?: string;
  status?: "pending" | "approved" | "rejected";
  slotText?: string;
}): Data {
  return {
    root: { props: {} },
    content: [
      {
        type: "approval-status-bar",
        props: {
          id: props.id,
          title: props.title ?? "申請ステータス",
          status: props.status ?? "pending",
          content: props.slotText
            ? [
                {
                  type: "Heading",
                  props: {
                    id: `${props.id}-slot-heading`,
                    text: props.slotText,
                    level: "h3",
                    align: "left",
                    padding: "none",
                    marginBottom: "sm",
                    colorAccent: "default",
                  },
                },
              ]
            : [],
        },
      },
    ],
  };
}

async function createWorkspace(
  key: string,
  puckData: Data,
  opts: { manifest?: object; customComponents?: CustomPuckComponentDef[] } = {},
): Promise<{ ws: OpenedWorkspace; screenId: string }> {
  touchedKeys.add(key);
  const screenId = normalizeId(`${key}-screen`);
  const screen: ScreenEntry = {
    id: screenId as ScreenEntry["id"],
    no: 1,
    name: "外部部品 E2E 画面",
    kind: "other",
    path: `/${screenId}`,
    hasDesign: true,
    updatedAt: FIXED_TS,
  };
  const screenEntity = makeScreenEntity(
    screenId,
    screen.name,
    "other",
    screen.path ?? `/${screenId}`,
    "puck",
    "bootstrap",
  );
  const ws = await setupTestWorkspace({
    key,
    project: buildProject({
      name: "外部部品 E2E",
      techStack: { designer: { editorKind: "puck", cssFramework: "bootstrap" } },
      entities: { screens: [screen] } as HarmonyEntities,
    }),
    screenEntities: [screenEntity],
    puckComponents: opts.customComponents,
  });
  await seedExternalPuckComponentFixture(ws, { manifest: opts.manifest });
  await writePuckDataFile(ws, screenId, puckData);
  return { ws, screenId };
}

async function openPuckScreen(page: Page, ws: OpenedWorkspace, screenId: string): Promise<void> {
  await ws.gotoActive(page, `/screen/design/${screenId}`);
  await expect(getPuckContainer(page).last()).toBeVisible({ timeout: 20000 });
}

async function startEditing(page: Page): Promise<void> {
  // esd-* ボタンは helper 経由で click する (#980-A: locator.click() は .esd-root を拾って 180s timeout)
  await startNewDraft(page);
  await expect(page.locator("[data-testid='edit-session-dropdown']")).toContainText("編集中", { timeout: 10000 });
}

function canvas(page: Page) {
  return page.locator("iframe#preview-frame").last().contentFrame();
}

async function selectApprovalComponent(page: Page): Promise<void> {
  // Puck の実 canvas は iframe 内だが、選択状態は親 DOM の outline から安定して切り替える。
  await page.getByRole("button", { name: /Expand \(外部\) 承認ステータス帯/ }).click();
  await expect(page.locator("label").filter({ hasText: /見出し|title/ })).toBeVisible({ timeout: 10000 });
}

async function readBrokenManifest(): Promise<object> {
  const manifest = JSON.parse(await fs.readFile(FIXTURE_MANIFEST, "utf-8")) as {
    components: Array<{ engine?: { react?: string; puck?: string } }>;
  };
  return {
    ...manifest,
    components: manifest.components.map((component, index) =>
      index === 0
        ? { ...component, engine: { ...(component.engine ?? {}), react: "18" } }
        : component,
    ),
  };
}

test.describe("Puck 外部部品 E2E", { tag: ["@regression"] }, () => {
  test.beforeEach(async () => {
    test.skip(!(await isMcpRunning()), "backend is required for realWorkspace Puck E2E");
  });

  test.afterAll(async () => {
    await cleanupRealWorkspaces([...touchedKeys]);
  });

  test("1. パレットに外部部品カテゴリと承認ステータス帯が表示される", async ({ page }) => {
    const { ws, screenId } = await createWorkspace(
      "issue-1420-external-palette",
      { root: { props: {} }, content: [] },
    );
    await openPuckScreen(page, ws, screenId);

    await expect(page.getByText("プロジェクト部品 (外部)")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: "(外部) 承認ステータス帯", exact: true })).toBeVisible();
  });

  test("2. seed 配置済み外部部品が canvas に描画され、GrapesJS pages 欠落 error を出さない", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const { ws, screenId } = await createWorkspace(
      "issue-1420-external-render",
      approvalData({ id: "approval-render", title: "稟議ステータス" }),
    );
    await openPuckScreen(page, ws, screenId);

    await expect(canvas(page).locator('[data-external-component="ApprovalStatusBar"]')).toBeVisible({ timeout: 20000 });
    await expect(canvas(page).getByText("稟議ステータス")).toBeVisible();
    const errText = consoleErrors.join("\n");
    expect(errText).not.toContain("pages が欠落");
    expect(errText).not.toContain("Invalid hook call");
    expect(errText).not.toContain("version-mismatch");
  });

  test("3. props は title text / status select 編集で描画に反映される", async ({ page }) => {
    const { ws, screenId } = await createWorkspace(
      "issue-1420-external-props",
      approvalData({ id: "approval-props", title: "変更前", status: "pending" }),
    );
    await openPuckScreen(page, ws, screenId);
    await startEditing(page);

    await selectApprovalComponent(page);
    await page.locator("input[title='見出し']").fill("承認済みの申請");
    await page.locator("select[title='承認状態']").selectOption({ label: "承認済み" });

    await expect(canvas(page).getByText("承認済みの申請")).toBeVisible({ timeout: 10000 });
    await expect(canvas(page).locator('[data-testid="approval-status-badge"]')).toHaveText("承認済み");
    await expect(canvas(page).locator('[data-external-component="ApprovalStatusBar"]')).toHaveAttribute("data-status", "approved");
  });

  test("4. slot content に built-in Heading を seed で入れ子でき、内部が描画される", async ({ page }) => {
    const { ws, screenId } = await createWorkspace(
      "issue-1420-external-slot",
      approvalData({
        id: "approval-slot",
        title: "承認詳細",
        status: "pending",
        slotText: "スロット内見出し",
      }),
    );
    await openPuckScreen(page, ws, screenId);

    await expect(canvas(page).locator('[data-external-component="ApprovalStatusBar"]')).toBeVisible({ timeout: 20000 });
    await expect(canvas(page).locator('[data-testid="puck-primitive-heading"]').filter({ hasText: "スロット内見出し" })).toBeVisible();
  });

  test("5. 選択を複合部品化で保存し、保存済み subtree を seed 再配置データとして描画できる", async ({ page }) => {
    const { ws, screenId } = await createWorkspace(
      "issue-1420-external-composite",
      approvalData({ id: "approval-composite", title: "複合化対象", status: "approved" }),
    );
    await openPuckScreen(page, ws, screenId);
    await startEditing(page);

    await selectApprovalComponent(page);
    await expect(page.locator("[data-testid='save-composite-button']")).toBeEnabled({ timeout: 10000 });
    await page.locator("[data-testid='save-composite-button']").click();
    await expect(page.locator("[data-testid='save-composite-dialog']")).toBeVisible({ timeout: 5000 });
    await page.locator("[data-testid='save-composite-dialog'] input").fill("承認帯複合");
    await page.locator("[data-testid='save-composite-dialog']").getByRole("button", { name: "保存" }).click();
    await expect(page.locator("[data-testid='save-composite-dialog']")).toBeHidden({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "複合部品: 承認帯複合", exact: true })).toBeVisible({ timeout: 10000 });

    const savedPath = path.join(ws.workspacePath, "harmony", "puck-components.json");
    const saved = JSON.parse(await fs.readFile(savedPath, "utf-8")) as CustomPuckComponentDef[];
    const composite = saved.find((component) => component.kind === "composite" && component.label === "承認帯複合");
    expect(composite).toBeDefined();
    expect(composite?.dependencies).toContain("approval-status-bar");

    const replay = await createWorkspace(
      "issue-1420-external-composite-replay",
      { root: { props: {} }, content: composite?.tree.content ?? [] },
      { customComponents: composite ? [composite] : [] },
    );
    await openPuckScreen(page, replay.ws, replay.screenId);
    await expect(canvas(page).locator('[data-external-component="ApprovalStatusBar"]')).toBeVisible({ timeout: 20000 });
    await expect(canvas(page).getByText("複合化対象")).toBeVisible();
  });

  test("6. engine mismatch の壊れた manifest は外部部品エラーカードとして描画される", async ({ page }) => {
    const { ws, screenId } = await createWorkspace(
      "issue-1420-external-error",
      approvalData({ id: "approval-error", title: "壊れた外部部品" }),
      { manifest: await readBrokenManifest() },
    );
    await openPuckScreen(page, ws, screenId);

    await expect(page.getByRole("button", { name: "(外部·エラー) 承認ステータス帯", exact: true })).toBeVisible({ timeout: 20000 });
    await expect(canvas(page).locator("[data-testid='external-component-error-card']")).toBeVisible();
    await expect(canvas(page).locator("[data-testid='external-component-error-card']")).toHaveAttribute("data-error-kind", "version-mismatch");
  });

  // #1421: palette → iframe canvas への実 drag/drop。seed ではなく実操作で配置を検証する。
  test("7. 外部部品を palette から実 drag で canvas に配置できる", async ({ page }) => {
    const { ws, screenId } = await createWorkspace(
      "issue-1420-external-drag",
      { root: { props: {} }, content: [] },
    );
    await openPuckScreen(page, ws, screenId);
    await startEditing(page);

    // 配置前は外部部品ノードなし
    await expect(puckRootDropzone(page).locator('[data-external-component="ApprovalStatusBar"]')).toHaveCount(0);

    await dragPaletteItemToCanvas(page, "(外部) 承認ステータス帯");

    // 実 drag 後に canvas へ外部部品が配置・描画される
    await expect(
      puckRootDropzone(page).locator('[data-external-component="ApprovalStatusBar"]'),
    ).toHaveCount(1, { timeout: 10000 });
    await expect(
      canvas(page).locator('[data-puck-component^="approval-status-bar"]'),
    ).toBeVisible();
  });
});
