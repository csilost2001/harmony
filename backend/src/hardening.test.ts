/**
 * 安全性・データの堅牢性 (第 1 弾) の単体テスト:
 * 保存前の版・書き込みエラーの案内・ワークスペースの健全性・外部変更の検知・複数ファイル操作の復旧・認証・要求の上限・MCP の権限。
 * 実 fs (os.tmpdir() 配下のワークスペース) を使う。
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { IncomingMessage } from "node:http";
import { ensureDataDir, harmonyFile, writeTable, writePageLayout, writeProcessFlow, readProject, readScreen, readScreenEntity, writeScreenEntity } from "./projectStorage.js";
import { BACKUP_KEEP, backupBeforeOverwrite, listBackupVersions, assertRelPath } from "./fileBackup.js";
import { listEntityVersions, locateEntityFile, readEntityVersion, restoreEntityVersionToFile, versionedRelPath } from "./fileVersions.js";
import { explainWriteError } from "./writeErrors.js";
import { describeJsonError, findJsonErrorOffset, MAX_JSON_BYTES, persistDerivedUuids, repairRegistry, scanWorkspaceHealth } from "./workspaceHealth.js";
import { collectExtraIssues } from "./schemaIssues.js";
import { ExternalChangeWatcher, RETRY_AFTER_MS, SELF_WINDOW_MS, classifyChangedPath, installSelfWriteTracking, isSelfWritePath, markSelfWrite } from "./externalChanges.js";
import { openJournal, planFromAbsolute, recoverJournals, isOwnerAlive, ensureRecovered, _resetRecoveredForTest, FOREIGN_STALE_MS, JOURNAL_DIR } from "./operationJournal.js";
import { renameEntityId } from "./renameEntity.js";
import { FAILURE_WINDOW_MS, FREE_FAILURES, MAX_DELAY_MS, _resetAuthThrottleForTest, authFailureDelayMs, checkAuthToken } from "./security/authToken.js";
import { BodyTooLargeError, RateLimiter, checkContentLength, maxHttpBodyBytes, maxWsPayloadBytes, readLimitedBody } from "./security/requestLimits.js";
import { assertToolAllowed, filterTools, isReadOnlyTool, isToolAllowed } from "./security/mcpAccess.js";
import { tools } from "./tools.js";
import { chainFrom, changedKeys, migrateWorkspace, MIGRATIONS, type SchemaMigration } from "./schemaMigration.js";

const TMP = path.join(os.tmpdir(), `hardening-${process.pid}-${Date.now()}`);
let n = 0;
async function makeWs(): Promise<string> {
  const root = path.join(TMP, `ws-${++n}`);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(harmonyFile(root), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "hardening-ws", name: "t", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    extensionsApplied: [], entities: {},
  }, null, 2));
  await ensureDataDir(root, "harmony");
  return root;
}
const table = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, columns: [], ...extra });
const read = async (p: string) => JSON.parse(await fs.readFile(p, "utf-8"));

beforeAll(async () => { await fs.mkdir(TMP, { recursive: true }); });
afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

describe("保存前の版 (fileBackup / fileVersions)", () => {
  it("上書きの直前の内容が、新しい順に残る。同じ内容の保存では増えない", async () => {
    const root = await makeWs();
    await writeTable("orders", table("orders", "注文 v1"), root);
    expect(await listEntityVersions(root, "table", "orders")).toHaveLength(0); // 初回は上書きではない
    await writeTable("orders", table("orders", "注文 v2"), root);
    await writeTable("orders", table("orders", "注文 v3"), root);
    const versions = await listEntityVersions(root, "table", "orders");
    expect(versions).toHaveLength(2);
    expect((await readEntityVersion(root, "table", "orders", versions[0].id) as { name: string }).name).toBe("注文 v2");
    expect((await readEntityVersion(root, "table", "orders", versions[1].id) as { name: string }).name).toBe("注文 v1");
    // 同じ内容の保存 (updatedAt だけ変わる場合は別の内容なので、ファイルそのものの再書き込みで確かめる)
    const file = path.join(root, "harmony", "tables", "orders.json");
    await backupBeforeOverwrite(file, await fs.readFile(file, "utf-8"));
    expect(await listEntityVersions(root, "table", "orders")).toHaveLength(2);
  });

  it("世代数は BACKUP_KEEP まで。古いものから消える", async () => {
    const root = await makeWs();
    for (let i = 0; i < BACKUP_KEEP + 5; i++) await writeTable("many", table("many", `v${i}`), root);
    const versions = await listEntityVersions(root, "table", "many");
    expect(versions).toHaveLength(BACKUP_KEEP);
    expect((await readEntityVersion(root, "table", "many", versions[0].id) as { name: string }).name).toBe(`v${BACKUP_KEEP + 3}`);
  });

  it("版へ書き戻せる。書き戻す前の内容も版として残る (取り消せる)。uuid は、いまの設計のものを保つ", async () => {
    const root = await makeWs();
    await writeTable("t1", table("t1", "最初"), root);
    const uuid = (await read(path.join(root, "harmony", "tables", "t1.json"))).uuid;
    await writeTable("t1", table("t1", "変更後"), root);
    // 別の uuid を持つ古い版 (削除 → 作り直しの前の版など) を、版の置き場へ置く
    const [prev] = await listEntityVersions(root, "table", "t1");
    const vf = path.join(root, ".harmony-backups", "harmony", "tables", "t1.json", `${prev.id}.json`);
    await fs.writeFile(vf, JSON.stringify({ ...(await read(vf)), uuid: "99999999-9999-4999-8999-999999999999" }));
    await restoreEntityVersionToFile(root, "table", "t1", prev.id);
    expect((await read(path.join(root, "harmony", "tables", "t1.json"))).name).toBe("最初");
    expect((await read(path.join(root, "harmony", "tables", "t1.json"))).uuid).toBe(uuid);
    const after = await listEntityVersions(root, "table", "t1");
    const names = await Promise.all(after.map(async (v) => (await readEntityVersion(root, "table", "t1", v.id) as { name: string }).name));
    expect(names).toContain("変更後");
  });

  it("ページレイアウトの版も、引けて・書き戻せる (続編 第 9 弾 #161)", async () => {
    const root = await makeWs();
    const pl = (name: string) => ({ id: "pl1", name, regions: [] });
    await writePageLayout("pl1", pl("最初"), root);
    await writePageLayout("pl1", pl("変更後"), root);
    expect(await versionedRelPath(root, "page-layout", "pl1")).toBe("harmony/page-layouts/pl1.json");
    const [prev] = await listEntityVersions(root, "page-layout", "pl1");
    expect((await readEntityVersion(root, "page-layout", "pl1", prev.id) as { name: string }).name).toBe("最初");
    await restoreEntityVersionToFile(root, "page-layout", "pl1", prev.id);
    expect((await read(path.join(root, "harmony", "page-layouts", "pl1.json"))).name).toBe("最初");
    expect((await listEntityVersions(root, "page-layout", "pl1")).length).toBeGreaterThan(0); // 書き戻す前の内容も版に残る
  });

  it("設計の原本ファイルの場所を引ける (画面も。無ければ exists は false。不正な id は拒む)", async () => {
    const root = await makeWs();
    await writeTable("orders", table("orders", "注文"), root);
    const t = await locateEntityFile(root, "table", "orders");
    expect(t).toMatchObject({ relPath: "harmony/tables/orders.json", exists: true });
    expect(t.absPath).toBe(path.join(root, "harmony", "tables", "orders.json"));
    expect(await locateEntityFile(root, "screen", "cart")).toMatchObject({ relPath: "harmony/screens/cart.json", exists: false });
    await expect(locateEntityFile(root, "table", "../x")).rejects.toThrow();
    await expect(locateEntityFile(root, "generic-definition", "x")).rejects.toThrow();
  });

  it("書き戻すと、一覧 (harmony.json) の要約 (名前・列数) も、書き戻した内容に合わせる。一覧に載っていなければ足さない", async () => {
    const root = await makeWs();
    const proj = (await readProject(root)) as Record<string, unknown>;
    await fs.writeFile(harmonyFile(root), JSON.stringify({ ...proj, entities: { tables: [{ id: "reg", no: 7, name: "旧名", physicalName: "reg", columnCount: 5, updatedAt: "2026-01-01T00:00:00.000Z" }] } }, null, 2));
    await writeTable("reg", { id: "reg", name: "最初の名前", columns: [{ id: "c1", no: 1, physicalName: "c1", name: "C1", dataType: "INTEGER" }] }, root);
    await writeTable("reg", { id: "reg", name: "あとの名前", columns: [] }, root);
    const [prev] = await listEntityVersions(root, "table", "reg");
    await restoreEntityVersionToFile(root, "table", "reg", prev.id);
    const entry = ((await readProject(root)) as { entities: { tables: Array<Record<string, unknown>> } }).entities.tables[0];
    expect(entry).toMatchObject({ id: "reg", no: 7, name: "最初の名前", columnCount: 1 });
    // 一覧に載っていない設計は、足さない (一覧の読み出しが補う)
    await writeTable("unreg", table("unreg", "a"), root);
    await writeTable("unreg", table("unreg", "b"), root);
    const [pv] = await listEntityVersions(root, "table", "unreg");
    await restoreEntityVersionToFile(root, "table", "unreg", pv.id);
    expect(((await readProject(root)) as { entities: { tables: Array<{ id: string }> } }).entities.tables.map((t) => t.id)).toEqual(["reg"]);
  });

  it("id が違う版・存在しない版・対応しない種類は戻せない / .gitignore を置く / 隠しフォルダは対象外", async () => {
    const root = await makeWs();
    await writeTable("a1", table("a1", "A"), root);
    await writeTable("a1", table("a1", "A2"), root);
    const [v] = await listEntityVersions(root, "table", "a1");
    // 別の id のファイルに紛れ込ませても、id が合わなければ拒否
    const dir = path.join(root, ".harmony-backups", "harmony", "tables", "b1.json");
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(path.join(root, ".harmony-backups", "harmony", "tables", "a1.json", `${v.id}.json`), path.join(dir, `${v.id}.json`));
    await expect(readEntityVersion(root, "table", "b1", v.id)).rejects.toThrow(/id/);
    await expect(readEntityVersion(root, "table", "a1", "2020-01-01T00-00-00.000Z-999")).rejects.toThrow(/見つかりません/);
    await expect(versionedRelPath(root, "screen-item", "x")).rejects.toThrow(/対応していません/);
    expect(await fs.readFile(path.join(root, ".harmony-backups", ".gitignore"), "utf-8")).toBe("*\n");
    // 隠しフォルダの中のファイルは、版にしない
    await fs.mkdir(path.join(root, ".hidden"), { recursive: true });
    await fs.writeFile(path.join(root, ".hidden", "x.json"), "{}");
    await backupBeforeOverwrite(path.join(root, ".hidden", "x.json"), "{\"a\":1}");
    await expect(fs.access(path.join(root, ".harmony-backups", ".hidden"))).rejects.toThrow();
  });

  it("相対パスの検査: 外へ出る・隠し・.json 以外は拒否", () => {
    for (const bad of ["../x.json", "/etc/passwd.json", "a/../b.json", ".git/config.json", "a/b.txt", "", "a//b.json"]) {
      expect(() => assertRelPath(bad), bad).toThrow();
    }
    expect(assertRelPath("harmony/tables/x.json")).toBe("harmony/tables/x.json");
  });

  it("バックアップができなくても保存は通る (ワークスペース外のファイル)", async () => {
    const outside = path.join(TMP, "outside.json");
    await fs.writeFile(outside, "{}");
    await expect(backupBeforeOverwrite(outside, "{\"a\":1}")).resolves.toBeUndefined();
    expect(await listBackupVersions(TMP, "outside.json")).toEqual([]);
  });
});

describe("書き込みエラーの案内 (writeErrors)", () => {
  it("原因が分かるエラーは、対処つきの日本語になる (元のエラーは cause に残る)", () => {
    for (const code of ["ENOSPC", "EACCES", "EROFS", "EPERM", "ENAMETOOLONG", "EBUSY"]) {
      const orig = Object.assign(new Error("raw"), { code });
      const e = explainWriteError(orig, "/x/orders.json") as Error & { code?: string };
      expect(e.message).toContain("「orders.json」を保存できませんでした");
      expect(e.message).toContain(code);
      expect(e.code).toBe(code);
      expect(e.cause).toBe(orig);
    }
  });
  it("原因が分からないエラーは、そのまま返す", () => {
    const orig = new Error("other");
    expect(explainWriteError(orig, "/x/a.json")).toBe(orig);
  });
  it("保存の失敗が、日本語の案内で返る (書き込み先がファイルで塞がれている)", async () => {
    const root = await makeWs();
    // tables/blocked.json を「フォルダ」にして、書き込み (rename) を失敗させる
    await fs.mkdir(path.join(root, "harmony", "tables", "blocked.json"), { recursive: true });
    await expect(writeTable("blocked", table("blocked", "x"), root)).rejects.toThrow();
    // 一時ファイルが残らない
    const left = (await fs.readdir(path.join(root, "harmony", "tables"))).filter((f) => f.endsWith(".tmp"));
    expect(left).toEqual([]);
  });
});

describe("ワークスペースの健全性 (workspaceHealth)", () => {
  it("壊れた JSON は、場所つきの error で知らせる (一覧からは黙って消えない)", async () => {
    const root = await makeWs();
    await writeTable("good", table("good", "良い"), root);
    await fs.writeFile(path.join(root, "harmony", "tables", "broken.json"), '{\n  "id": "broken",\n  "name": \n}');
    const issues = await scanWorkspaceHealth(root);
    const hit = issues.find((i) => i.section.includes("broken.json"));
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toMatch(/JSON として読めません \(\d+ 行目 \d+ 桁目付近\)/);
    expect(issues.some((i) => i.section.includes("good.json") && i.severity === "error")).toBe(false);
  });

  it("describeJsonError は、誤りの行・桁を出す (正しい JSON は null)", () => {
    expect(describeJsonError('{\n  "a": 1,\n  "b": }')).toBe("JSON として読めません (3 行目 8 桁目付近)");
    expect(describeJsonError('{"a": [1, 2,]}')).toMatch(/1 行目 13 桁目/);
    expect(describeJsonError('{"a": 1} x')).toMatch(/1 行目 10 桁目/);
    expect(describeJsonError('{"a": "未終了')).toMatch(/行目/);
    for (const ok of ['{"a":[1,2.5e3,-0,true,false,null,"\\u00e9\\n"],"b":{}}', "[]", '"x"', "0", " \n{ } "]) expect(findJsonErrorOffset(ok), ok).toBeNull();
    for (const bad of ["", "{", '{"a"}', "[1,]", "01", '{"a":1,}', "tru", "'x'", '"\\q"', "{a:1}"]) {
      expect(findJsonErrorOffset(bad) !== null, bad).toBe(true);
      expect(() => JSON.parse(bad), bad).toThrow(); // JSON.parse と判定が一致する
    }
  });

  it("大きすぎるファイルは、読まずに warning で知らせる", async () => {
    const root = await makeWs();
    const big = path.join(root, "harmony", "tables", "huge.json");
    await fs.writeFile(big, "{}");
    await fs.truncate(big, MAX_JSON_BYTES + 1024);
    const issues = await scanWorkspaceHealth(root);
    expect(issues.find((i) => i.section.includes("huge.json"))?.message).toContain("大きすぎます");
  });

  it("ファイル名と id の食い違い・一覧にあるのにファイルが無い項目を warning にする", async () => {
    const root = await makeWs();
    await writeTable("real", table("real", "実在"), root);
    await fs.writeFile(path.join(root, "harmony", "tables", "named-a.json"), JSON.stringify({ id: "named-b", name: "食い違い", columns: [] }));
    const project = (await readProject(root)) as Record<string, unknown>;
    await fs.writeFile(harmonyFile(root), JSON.stringify({ ...project, entities: { tables: [{ id: "real", no: 1, name: "実在" }, { id: "ghost", no: 2, name: "幽霊" }] } }, null, 2));
    const issues = await scanWorkspaceHealth(root);
    expect(issues.some((i) => i.severity === "warning" && i.section.includes("named-a.json") && i.message.includes("named-b"))).toBe(true);
    expect(issues.some((i) => i.severity === "warning" && i.section.includes("幽霊") && i.message.includes("見つかりません"))).toBe(true);
  });

  it("一覧に載っていない設計ファイルは、info で知らせる (読み出しでは補っている)", async () => {
    const root = await makeWs();
    await writeTable("loose-one", table("loose-one", "手で置いた"), root);
    const issues = await scanWorkspaceHealth(root);
    const hit = issues.find((i) => i.code === "registry-unregistered");
    expect(hit?.severity).toBe("info");
    expect(hit?.message).toContain("table:loose-one");
  });

  it("設計書・check_design の要確認には、保守の案内 (uuid 未保存・一覧に載っていない) を出さない。壊れた JSON は出す", async () => {
    const root = await makeWs();
    await fs.writeFile(path.join(root, "harmony", "tables", "nouuid2.json"), JSON.stringify({ id: "nouuid2", name: "x", columns: [] }));
    await fs.writeFile(path.join(root, "harmony", "tables", "broken2.json"), "{ not json");
    const all = await scanWorkspaceHealth(root);
    expect(all.some((i) => i.maintenance && i.code === "uuid-unsaved")).toBe(true);
    expect(all.some((i) => i.maintenance && i.code === "registry-unregistered")).toBe(true);
    const extra = await collectExtraIssues(root);
    expect(extra.some((i) => i.section === "uuid" || i.section === "一覧")).toBe(false);
    expect(extra.some((i) => i.section.includes("broken2.json") && i.severity === "error")).toBe(true);
    expect(extra.every((i) => !("maintenance" in i) && !("code" in i))).toBe(true);
  });

  it("repairRegistry: 予行は書かず、apply で足す・外す。もう一度やると何も起きない", async () => {
    const root = await makeWs();
    await writeTable("loose", table("loose", "手で置いた"), root);
    const project = (await readProject(root)) as Record<string, unknown>;
    await fs.writeFile(harmonyFile(root), JSON.stringify({ ...project, entities: { tables: [{ id: "ghost", no: 1, name: "幽霊" }] } }, null, 2));
    const before = await fs.readFile(harmonyFile(root), "utf-8");
    const dry = await repairRegistry(root, false);
    expect(dry).toMatchObject({ applied: false, add: [{ kind: "table", id: "loose" }], remove: [{ kind: "table", id: "ghost" }] });
    expect(await fs.readFile(harmonyFile(root), "utf-8")).toBe(before);
    const done = await repairRegistry(root, true);
    expect(done.applied).toBe(true);
    const tablesAfter = ((await readProject(root)) as { entities: { tables: Array<{ id: string }> } }).entities.tables.map((t) => t.id);
    expect(tablesAfter).toEqual(["loose"]);
    expect(await repairRegistry(root, true)).toMatchObject({ applied: false, add: [], remove: [] });
  });

  it("persistDerivedUuids: 予行は書かない。apply で uuid が id の直後に入り、読み出しの値と一致し、2 回目は対象なし", async () => {
    const root = await makeWs();
    const tf = path.join(root, "harmony", "tables", "nouuid.json");
    await fs.writeFile(tf, JSON.stringify({ id: "nouuid", name: "uuid なし", columns: [] }, null, 2));
    await writeProcessFlow("flow-nouuid", { meta: { id: "flow-nouuid", name: "f", flowType: "common", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, actions: [] }, root);
    // 処理フローは writeX が uuid を付けるので、消して「未保存」にする
    const pf = path.join(root, "harmony", "process-flows", "flow-nouuid.json");
    const pfData = await read(pf);
    delete pfData.meta.uuid;
    await fs.writeFile(pf, JSON.stringify(pfData, null, 2));

    const issuesBefore = await scanWorkspaceHealth(root);
    expect(issuesBefore.some((i) => i.severity === "info" && i.section === "uuid")).toBe(true);

    const raw = await fs.readFile(tf, "utf-8");
    const dry = await persistDerivedUuids(root, false);
    expect(dry.files.sort()).toEqual(["process-flows/flow-nouuid.json", "tables/nouuid.json"]);
    expect(await fs.readFile(tf, "utf-8")).toBe(raw);

    const done = await persistDerivedUuids(root, true);
    expect(done.applied).toBe(true);
    const t = await read(tf);
    expect(Object.keys(t).slice(0, 2)).toEqual(["id", "uuid"]);
    expect((await read(pf)).meta.uuid).toMatch(/^[0-9a-f]{8}-/);
    expect(await persistDerivedUuids(root, true)).toEqual({ files: [], applied: false });
    // 固定した値は、固定前に読み出しで補っていた値と同じ (読み出しの結果が変わらない)
    const { readTable } = await import("./projectStorage.js");
    expect(((await readTable("nouuid", root)) as { uuid: string }).uuid).toBe(t.uuid);
  });
});

describe("外部変更の検知 (externalChanges)", () => {
  it("classifyChangedPath: 設計ファイルだけを、既存の通知名と id の項目に対応づける", () => {
    expect(classifyChangedPath("tables/orders.json")).toEqual({ event: "tableChanged", data: { tableId: "orders" } });
    expect(classifyChangedPath("process-flows/p-1.json")).toEqual({ event: "processFlowChanged", data: { processFlowId: "p-1" } });
    expect(classifyChangedPath("actions/legacy.json")?.event).toBe("processFlowChanged");
    expect(classifyChangedPath("screens/s1.design.json")).toEqual({ event: "screenChanged", data: { screenId: "s1" } });
    expect(classifyChangedPath("business-flows/f.json")).toEqual({ event: "businessFlowChanged", data: { flowId: "f" } });
    expect(classifyChangedPath("generic-definitions/message/m1.json")).toEqual({ event: "genericDefinitionChanged", data: { kind: "message", name: "m1" } });
    expect(classifyChangedPath("layout-components.json")?.event).toBe("layoutComponentsChanged");
    for (const ignored of [".harmony-backups/tables/x.json", "tables/.orders.json.123.tmp", "tables/orders.json.broken-1", "tables/readme.md", "unknown/x.json", "tables"]) {
      expect(classifyChangedPath(ignored), ignored).toBeNull();
    }
  });

  it("自分の書き込みの記録: 書き終えた状態と同じ間は「自分」(通知が遅れても)。外で書き換えられたら (書いた直後でも) 外部", async () => {
    installSelfWriteTracking();
    const dir = path.join(TMP, "marks");
    await fs.mkdir(dir, { recursive: true });
    const p = path.join(dir, "marked.json");
    expect(isSelfWritePath(p)).toBe(false);
    await fs.writeFile(p, "AB"); // 包み (installSelfWriteTracking) を通る書き込み
    // 書いてから 2 秒たって (backend が重い処理で塞がっていて通知が遅れた) 届いても、自分の書き込み
    expect(isSelfWritePath(p, Date.now() + 2_000)).toBe(true);
    // 別のプロセスが書き換えた (状態が変わった) ら、書いた直後でも外部
    const { execFileSync } = await import("node:child_process");
    execFileSync("node", ["-e", `require("fs").writeFileSync(${JSON.stringify(p)}, "外で書き換え")`]);
    expect(isSelfWritePath(p)).toBe(false);
    // 書く途中 (状態がまだ決まっていない) は、短い間だけ「自分」
    const q = path.join(dir, "writing.json");
    markSelfWrite(q, false, 1_000);
    expect(isSelfWritePath(q, 1_000 + SELF_WINDOW_MS - 1)).toBe(true);
    expect(isSelfWritePath(q, 1_000 + SELF_WINDOW_MS + 1)).toBe(false);
    markSelfWrite(undefined); markSelfWrite(42 as unknown); // パスでないものは無視
  });

  it("自分が消したフォルダの下のファイルの削除通知は、自分のものとして除く", async () => {
    installSelfWriteTracking();
    const dir = path.join(TMP, "rmdir-case");
    await fs.mkdir(path.join(dir, "sub"), { recursive: true });
    await fs.writeFile(path.join(dir, "sub", "a.json"), "{}");
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    expect(isSelfWritePath(path.join(dir, "sub", "a.json"))).toBe(true);
    expect(isSelfWritePath(path.join(TMP, "other-dir", "a.json"))).toBe(false);
  });

  it("fs の書き込み系を包んでも、動作 (戻り値・エラー・同期版) は変わらず、書いたパスが記録される", async () => {
    installSelfWriteTracking();
    installSelfWriteTracking(); // 2 回呼んでも二重に包まない
    const dir = path.join(TMP, "tracked");
    await fs.mkdir(dir, { recursive: true });
    const a = path.join(dir, "a.json"), b = path.join(dir, "b.json"), c = path.join(dir, "c.json");
    await fs.writeFile(a, "A");
    expect(isSelfWritePath(a)).toBe(true);
    await fs.rename(a, b);
    expect(isSelfWritePath(b)).toBe(true);
    expect(await fs.readFile(b, "utf-8")).toBe("A");
    await expect(fs.unlink(path.join(dir, "missing.json"))).rejects.toMatchObject({ code: "ENOENT" }); // エラーもそのまま
    expect(isSelfWritePath(path.join(dir, "missing.json"))).toBe(true); // 失敗しても記録 (安全側)
    const fsSync = await import("node:fs");
    fsSync.writeFileSync(c, "C");
    expect(fsSync.readFileSync(c, "utf-8")).toBe("C");
    expect(isSelfWritePath(c)).toBe(true);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const waitFor = async (cond: () => boolean, ms = 5_000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 25)); }
    return cond();
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("外でファイルを書き換えると通知が出る (書いた直後でも)。backend 自身の書き込みは、通知が遅れても通知しない", async () => {
    installSelfWriteTracking();
    const root = await makeWs();
    await writeTable("watched", table("watched", "監視"), root);
    const file = path.join(root, "harmony", "tables", "watched.json");
    const got: Array<{ evs: string[]; paths: string[] }> = [];
    const w = new ExternalChangeWatcher((_r, evs, paths) => got.push({ evs: evs.map((e) => `${e.event}:${JSON.stringify(e.data)}`), paths }));
    const { execFileSync } = await import("node:child_process");
    const externalWrite = (name: string) => execFileSync("node", ["-e", `require("fs").writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(JSON.stringify(table("watched", name)))})`]);
    try {
      await w.ensure(root);
      // 外部の書き込み (別プロセス)。直前に backend が書いた (writeTable) 直後でも、状態が違うので検知する
      externalWrite("外で編集");
      expect(await waitFor(() => got.length === 1)).toBe(true);
      expect(got[0].evs).toEqual(['tableChanged:{"tableId":"watched"}']);

      // backend 自身の保存は通知しない。保存の直後に backend が 2 秒塞がって、通知が遅れて届いても
      got.length = 0;
      await writeTable("watched", table("watched", "自分で保存"), root);
      const t = Date.now(); while (Date.now() - t < 2_000) { /* イベントループを塞ぐ */ }
      await sleep(900);
      expect(got).toEqual([]);

      // 自分が保存したあとの、外部の書き換えも検知する
      externalWrite("また外で編集");
      expect(await waitFor(() => got.length === 1)).toBe(true);
    } finally {
      w.closeAll();
    }
  }, 30_000);

  it("あとから作られたフォルダ (generic-definitions/<種類>) も監視する。使われなくなったワークスペースの監視は止める", async () => {
    installSelfWriteTracking();
    const root = await makeWs();
    const got: string[] = [];
    const w = new ExternalChangeWatcher((_r, evs) => got.push(...evs.map((e) => e.event)));
    try {
      await w.ensure(root);
      const kindDir = path.join(root, "harmony", "generic-definitions", "message");
      const { execFileSync } = await import("node:child_process");
      execFileSync("node", ["-e", `const fs=require("fs");fs.mkdirSync(${JSON.stringify(kindDir)},{recursive:true})`]);
      await sleep(300);
      execFileSync("node", ["-e", `require("fs").writeFileSync(${JSON.stringify(path.join(kindDir, "m1.json"))}, "{}")`]);
      expect(await waitFor(() => got.includes("genericDefinitionChanged"))).toBe(true);
      w.prune(() => false);
      expect((w as unknown as { watching: Map<string, unknown> }).watching.size).toBe(0);
    } finally {
      w.closeAll();
    }
  }, 30_000);

  it("監視しているフォルダが消えて作り直されても、作り直されたフォルダの外部の書き換えを検知する", async () => {
    installSelfWriteTracking();
    const root = await makeWs();
    await writeTable("re-made", table("re-made", "x"), root);
    const got: string[] = [];
    const w = new ExternalChangeWatcher((_r, evs) => got.push(...evs.map((e) => e.event)));
    try {
      await w.ensure(root);
      const dir = path.join(root, "harmony", "tables");
      const { execFileSync } = await import("node:child_process");
      // git checkout などで、フォルダごと入れ替わる (別プロセスの操作)
      execFileSync("node", ["-e", `const fs=require("fs");fs.rmSync(${JSON.stringify(dir)},{recursive:true});fs.mkdirSync(${JSON.stringify(dir)})`]);
      await sleep(400);
      got.length = 0;
      execFileSync("node", ["-e", `require("fs").writeFileSync(${JSON.stringify(path.join(dir, "new-one.json"))}, "{}")`]);
      expect(await waitFor(() => got.includes("tableChanged"))).toBe(true);
    } finally {
      w.closeAll();
    }
  }, 30_000);

  it("フォルダが作り直され、続けてファイルが書かれても、監視を張り直す前に書かれた分を取りこぼさない (git checkout のような入れ替え)", async () => {
    installSelfWriteTracking();
    const root = await makeWs();
    await writeTable("keep", table("keep", "x"), root);
    const got: Array<{ evs: string[]; paths: string[] }> = [];
    const w = new ExternalChangeWatcher((_r, evs, paths) => got.push({ evs: evs.map((e) => `${e.event}:${JSON.stringify(e.data)}`), paths }));
    try {
      await w.ensure(root);
      const dir = path.join(root, "harmony", "tables");
      const { execFileSync } = await import("node:child_process");
      // 同じプロセスが、フォルダを消す → 作る → 中のファイルを続けて書く
      execFileSync("node", ["-e", `const fs=require("fs");const d=${JSON.stringify(dir)};fs.rmSync(d,{recursive:true});fs.mkdirSync(d);for(let i=0;i<3;i++)fs.writeFileSync(d+"/c"+i+".json","{}")`]);
      expect(await waitFor(() => got.flatMap((g) => g.evs).filter((e) => e.startsWith("tableChanged")).length >= 3)).toBe(true);
      const ids = got.flatMap((g) => g.evs).sort();
      expect(ids).toEqual(expect.arrayContaining(['tableChanged:{"tableId":"c0"}', 'tableChanged:{"tableId":"c1"}', 'tableChanged:{"tableId":"c2"}']));
    } finally {
      w.closeAll();
    }
  }, 30_000);

  it("自分が消したあと、外部が作り直して消しても、削除を検知する (「無し」の記録が外部の変化を隠さない)", async () => {
    installSelfWriteTracking();
    const root = await makeWs();
    const file = path.join(root, "harmony", "tables", "c.json");
    await fs.writeFile(file, "{}");
    await fs.unlink(file); // 自分が消した (状態 = 無し)
    const { execFileSync } = await import("node:child_process");
    execFileSync("node", ["-e", `require("fs").writeFileSync(${JSON.stringify(file)}, "{}")`]);
    expect(isSelfWritePath(file)).toBe(false); // 外部の作り直し
    execFileSync("node", ["-e", `require("fs").unlinkSync(${JSON.stringify(file)})`]);
    expect(isSelfWritePath(file)).toBe(false); // 続く外部の削除も、隠さない
  });

  it("自分が消して作り直したファイルを、外で消したら検知する (「自分が消した」記録が残らない)", async () => {
    installSelfWriteTracking();
    const root = await makeWs();
    const file = path.join(root, "harmony", "tables", "b.json");
    await fs.writeFile(file, "{}");
    await fs.unlink(file);
    await fs.writeFile(file, "{}"); // 同じ名前で作り直す
    expect(isSelfWritePath(file)).toBe(true); // 自分が書いた直後は、自分
    const { execFileSync } = await import("node:child_process");
    execFileSync("node", ["-e", `require("fs").unlinkSync(${JSON.stringify(file)})`]);
    expect(isSelfWritePath(file)).toBe(false); // 外で消された: 状態 ("-") が、覚えている状態 (ファイルあり) と違う
    // フォルダの再帰削除は配下を「自分」にするが、作り直して書けば、外すので、外部の削除を取りこぼさない
    const dir = path.join(root, "harmony", "tables", "d");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "x.json"), "{}");
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    expect(isSelfWritePath(path.join(dir, "x.json"))).toBe(true);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "x.json"), "{}");
    execFileSync("node", ["-e", `require("fs").unlinkSync(${JSON.stringify(path.join(dir, "x.json"))})`]);
    expect(isSelfWritePath(path.join(dir, "x.json"))).toBe(false);
  });

  it("監視を始められなかったワークスペースは、しばらく試し直さない (要求のたびに警告ログを出さない)", async () => {
    const root = path.join(TMP, "no-harmony-json");
    await fs.mkdir(root, { recursive: true });
    const w = new ExternalChangeWatcher(() => undefined);
    const watching = (w as unknown as { watching: Map<string, unknown>; failedAt: Map<string, number> });
    await w.ensure(root, 1_000);
    expect(watching.failedAt.get(root)).toBe(1_000);
    // ワークスペースが整ったあとでも、待ちの間は試さない。待ちが過ぎれば始める
    await fs.writeFile(harmonyFile(root), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "x", name: "x", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, entities: {} }));
    await ensureDataDir(root, "harmony");
    await w.ensure(root, 1_000 + RETRY_AFTER_MS - 1);
    expect(watching.watching.size).toBe(0);
    await w.ensure(root, 1_000 + RETRY_AFTER_MS + 1);
    expect(watching.watching.size).toBe(1);
    w.closeAll();
  });
});

describe("複数ファイル操作の復旧 (operationJournal)", () => {
  /** 持ち主のプロセスが終わった記録にする (強制終了のあとの残骸。生きているプロセスの記録は、進行中の操作として復旧しない) */
  async function orphan(root: string): Promise<void> {
    const { spawnSync } = await import("node:child_process");
    const deadPid = spawnSync("node", ["-e", "process.exit(0)"]).pid!;
    const dir = path.join(root, JOURNAL_DIR);
    for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith(".json"))) {
      const j = JSON.parse(await fs.readFile(path.join(dir, f), "utf-8"));
      await fs.writeFile(path.join(dir, f), JSON.stringify({ ...j, instanceId: "previous-run", pid: deadPid }));
    }
  }

  it("途中で止まった記録は、元の内容に戻し、新しく作ったファイルを消す", async () => {
    const root = await makeWs();
    const a = path.join(root, "harmony", "tables", "a.json");
    const created = path.join(root, "harmony", "tables", "created.json");
    await fs.writeFile(a, "ORIGINAL");
    await openJournal(root, planFromAbsolute(root, "test", [{ absPath: a, content: "ORIGINAL" }], [created])); // commit しない = 途中で止まった
    await fs.writeFile(a, "HALF-WRITTEN");
    await fs.writeFile(created, "NEW");
    await orphan(root);
    const res = await recoverJournals(root);
    expect(res).toEqual({ journals: 1, restored: 1, skipped: 0 });
    expect(await fs.readFile(a, "utf-8")).toBe("ORIGINAL");
    await expect(fs.access(created)).rejects.toThrow();
    expect(await fs.readdir(path.join(root, JOURNAL_DIR))).toEqual([".gitignore"]);
    expect(await recoverJournals(root)).toEqual({ journals: 0, restored: 0, skipped: 0 });
  });

  it("持ち主のプロセスが生きている記録は、進行中の操作なので巻き戻さない", async () => {
    const root = await makeWs();
    const a = path.join(root, "harmony", "tables", "live.json");
    await fs.writeFile(a, "ORIGINAL");
    await openJournal(root, planFromAbsolute(root, "live", [{ absPath: a, content: "ORIGINAL" }], []));
    await fs.writeFile(a, "IN-PROGRESS");
    expect(await recoverJournals(root)).toEqual({ journals: 1, restored: 0, skipped: 1 });
    expect(await fs.readFile(a, "utf-8")).toBe("IN-PROGRESS");
    expect((await fs.readdir(path.join(root, JOURNAL_DIR))).filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("配布の Docker のように、再起動のたびに pid が同じ (1) でも、前の起動の記録は復旧する (pid の一致を「自分」とみなさない)", async () => {
    const root = await makeWs();
    const a = path.join(root, "harmony", "tables", "restarted.json");
    await fs.writeFile(a, "ORIGINAL");
    await openJournal(root, planFromAbsolute(root, "before-crash", [{ absPath: a, content: "ORIGINAL" }], []));
    await fs.writeFile(a, "HALF");
    // 前の起動 (強制終了した) の記録に見せる: 起動の識別子だけが違い、pid・ホストは同じ
    const dir = path.join(root, JOURNAL_DIR);
    for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith(".json"))) {
      const j = JSON.parse(await fs.readFile(path.join(dir, f), "utf-8"));
      await fs.writeFile(path.join(dir, f), JSON.stringify({ ...j, instanceId: "previous-run" }));
    }
    expect(await recoverJournals(root)).toEqual({ journals: 1, restored: 1, skipped: 0 });
    expect(await fs.readFile(a, "utf-8")).toBe("ORIGINAL");
  });

  it("isOwnerAlive: 自分の起動中・別のプロセスが生きている・別のホストの新しい記録は進行中。再起動した自分・死んだ pid・古い別ホスト・持ち主不明は残骸", async () => {
    const os = await import("node:os");
    const { INSTANCE_ID } = await import("./operationJournal.js");
    const base = { label: "x", restore: [], remove: [] };
    const now = 10_000_000;
    expect(isOwnerAlive({ ...base, instanceId: INSTANCE_ID, pid: process.pid, host: os.hostname() }, now, now)).toBe(true);
    expect(isOwnerAlive({ ...base, instanceId: "old", pid: process.pid, host: os.hostname() }, now, now)).toBe(false);
    expect(isOwnerAlive({ ...base, instanceId: "other", pid: process.ppid, host: os.hostname() }, now, now)).toBe(true); // 親プロセス = 別の生きているプロセス
    expect(isOwnerAlive({ ...base, instanceId: "other", pid: 2_000_000_000, host: os.hostname() }, now, now)).toBe(false);
    expect(isOwnerAlive({ ...base, instanceId: "other", pid: 1, host: "another-container" }, now - 1_000, now)).toBe(true);
    expect(isOwnerAlive({ ...base, instanceId: "other", pid: 1, host: "another-container" }, now - FOREIGN_STALE_MS - 1, now)).toBe(false);
    expect(isOwnerAlive(base, now, now)).toBe(false);
  });

  it("「戻す」と「消す」が同じパスにあっても、戻したファイルは消さない (旧配置の重複の削除の計画)", async () => {
    const root = await makeWs();
    const legacy = path.join(root, "harmony", "actions", "dup.json");
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, "LEGACY");
    await openJournal(root, planFromAbsolute(root, "dup", [{ absPath: legacy, content: "LEGACY" }], [legacy]));
    await fs.rm(legacy);
    await orphan(root);
    await recoverJournals(root);
    expect(await fs.readFile(legacy, "utf-8")).toBe("LEGACY");
  });

  it("別ホストの新しい記録を飛ばしたときは、その記録が残骸になる時間のあと、最初の要求で 1 回だけ試し直す", async () => {
    const root = await makeWs();
    const a = path.join(root, "harmony", "tables", "foreign.json");
    await fs.writeFile(a, "ORIGINAL");
    await openJournal(root, planFromAbsolute(root, "foreign", [{ absPath: a, content: "ORIGINAL" }], []));
    await fs.writeFile(a, "HALF");
    const dir = path.join(root, JOURNAL_DIR);
    for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith(".json"))) {
      const j = JSON.parse(await fs.readFile(path.join(dir, f), "utf-8"));
      await fs.writeFile(path.join(dir, f), JSON.stringify({ ...j, instanceId: "other-container-run", host: "another-container" }));
    }
    _resetRecoveredForTest();
    const t0 = Date.now();
    await ensureRecovered(root, t0);
    expect(await fs.readFile(a, "utf-8")).toBe("HALF"); // 別ホストの新しい記録は、進行中とみなして飛ばす
    await ensureRecovered(root, t0 + 1_000); // 待ちの間は、試し直さない
    expect(await fs.readFile(a, "utf-8")).toBe("HALF");
    // 記録を、残骸になる時間より古くする
    for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith(".json"))) {
      const old = new Date(Date.now() - FOREIGN_STALE_MS - 5_000);
      await fs.utimes(path.join(dir, f), old, old);
    }
    await ensureRecovered(root, t0 + FOREIGN_STALE_MS + 2_000);
    expect(await fs.readFile(a, "utf-8")).toBe("ORIGINAL");
    expect((await fs.readdir(dir)).filter((x) => x.endsWith(".json"))).toEqual([]);
  });

  it("終わった (commit した) 記録は残らず、復旧しても何も戻らない", async () => {
    const root = await makeWs();
    const a = path.join(root, "harmony", "tables", "a.json");
    await fs.writeFile(a, "X");
    const commit = await openJournal(root, planFromAbsolute(root, "done", [{ absPath: a, content: "X" }], []));
    await fs.writeFile(a, "Y");
    await commit();
    expect(await recoverJournals(root)).toEqual({ journals: 0, restored: 0, skipped: 0 });
    expect(await fs.readFile(a, "utf-8")).toBe("Y");
  });

  it("外を指す記録は書けない / 不正な記録は戻さずに残す", async () => {
    const root = await makeWs();
    expect(() => planFromAbsolute(root, "bad", [{ absPath: path.join(TMP, "outside.json"), content: "" }], [])).toThrow();
    const dir = path.join(root, JOURNAL_DIR);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "1-evil.json"), JSON.stringify({ label: "evil", restore: [{ rel: "../escape.json", content: "pwn" }], remove: [] }));
    const res = await recoverJournals(root);
    expect(res.restored).toBe(0);
    await expect(fs.access(path.join(root, "..", "escape.json"))).rejects.toThrow();
    expect((await fs.readdir(dir)).includes("1-evil.json")).toBe(true);
  });

  it("改名が成功したら、記録は残らない。参照元の書き換え前の内容は、保存前の版に残る", async () => {
    const root = await makeWs();
    await writeTable("before-name", table("before-name", "表"), root);
    await writeProcessFlow("ref-flow", {
      meta: { id: "ref-flow", name: "参照元", flowType: "common", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      actions: [{ id: "a1", name: "a", steps: [{ id: "s1", kind: "dbAccess", description: "d", tableId: "before-name", operation: "SELECT" }] }],
    }, root);
    await renameEntityId("table", "before-name", "after-name", root);
    const left = await fs.readdir(path.join(root, JOURNAL_DIR)).catch(() => [] as string[]);
    expect(left.filter((f) => f.endsWith(".json"))).toEqual([]);
    await expect(fs.access(path.join(root, "harmony", "tables", "after-name.json"))).resolves.toBeUndefined();
    const versions = await listEntityVersions(root, "process-flow", "ref-flow");
    expect(versions.length).toBeGreaterThan(0);
    expect(JSON.stringify(await readEntityVersion(root, "process-flow", "ref-flow", versions[0].id))).toContain("before-name");
  });
});

const req = (headers: Record<string, string> = {}, url = "/mcp"): IncomingMessage => ({ headers, url } as unknown as IncomingMessage);

describe("接続トークン (authToken)", () => {
  beforeEach(() => _resetAuthThrottleForTest());

  it("HARMONY_AUTH_TOKEN が未設定なら、何も要求しない", () => {
    expect(checkAuthToken(req(), {})).toBeNull();
    expect(checkAuthToken(req(), { HARMONY_AUTH_TOKEN: "  " })).toBeNull();
  });
  it("設定されていれば、Bearer ヘッダーが合うときだけ通す。?token= は WebSocket (allowQuery) だけ", () => {
    const env = { HARMONY_AUTH_TOKEN: "s3cret" };
    expect(checkAuthToken(req(), env)).toMatch(/ありません/);
    expect(checkAuthToken(req({ authorization: "Bearer wrong" }), env)).toMatch(/違います/);
    expect(checkAuthToken(req({ authorization: "Bearer s3cret" }), env)).toBeNull();
    expect(checkAuthToken(req({ authorization: "bearer   s3cret " }), env)).toBeNull();
    expect(checkAuthToken(req({}, "/?token=s3cret"), env)).toMatch(/ありません/); // HTTP は ?token= を受けない
    expect(checkAuthToken(req({}, "/?token=s3cret"), env, true)).toBeNull();
    expect(checkAuthToken(req({}, "/?token=nope"), env, true)).toMatch(/違います/);
    expect(checkAuthToken(req({ authorization: "Basic s3cret" }), env)).toMatch(/ありません/);
  });
  it("違うトークンが続く送信元への失敗の応答は、だんだん遅くなる。正しいトークンは、遅くならず通る (締め出さない)。トークンなしは数えない。窓が過ぎれば戻る", () => {
    const env = { HARMONY_AUTH_TOKEN: "s3cret" };
    const bad = (i: number) => req({ authorization: `Bearer bad${i}` });
    const probe = req();
    for (let i = 0; i < 50; i++) checkAuthToken(req(), env, false, 1_000); // トークンなし (画面を開いただけ)
    expect(authFailureDelayMs(probe, 1_000)).toBe(0);
    for (let i = 0; i < FREE_FAILURES; i++) checkAuthToken(bad(i), env, false, 2_000);
    expect(authFailureDelayMs(probe, 2_000)).toBe(0);
    checkAuthToken(bad(99), env, false, 2_000);
    expect(authFailureDelayMs(probe, 2_000)).toBe(250);
    checkAuthToken(bad(100), env, false, 2_000);
    expect(authFailureDelayMs(probe, 2_000)).toBe(500);
    for (let i = 0; i < 30; i++) checkAuthToken(bad(200 + i), env, false, 2_000);
    expect(authFailureDelayMs(probe, 2_000)).toBe(MAX_DELAY_MS);
    // 正しいトークンは、失敗が続いていても通る
    expect(checkAuthToken(req({ authorization: "Bearer s3cret" }), env, false, 2_001)).toBeNull();
    // 窓を過ぎたら戻る
    expect(authFailureDelayMs(probe, 2_000 + FAILURE_WINDOW_MS + 1)).toBe(0);
  });
});

describe("要求の上限 (requestLimits)", () => {
  it("RateLimiter: 窓の中で max を超えたら断り、窓が過ぎれば戻る。接続ごとに別", () => {
    const rl = new RateLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => rl.allow("a", 0))).toEqual([true, true, true, false]);
    expect(rl.allow("b", 0)).toBe(true);
    expect(rl.allow("a", 1001)).toBe(true);
    rl.forget("a");
    expect(rl.allow("a", 1002)).toBe(true);
  });
  it("Content-Length が上限を超えたら、本文を読む前に断る", () => {
    expect(checkContentLength(req({ "content-length": "100" }), 1000)).toBeNull();
    expect(checkContentLength(req({ "content-length": "5000" }), 1000)).toMatch(/大きすぎます/);
    expect(checkContentLength(req(), 1000)).toBeNull();
  });
  it("readLimitedBody: Content-Length の無い (chunked の) 本文も、読みながら数えて、上限を超えたら打ち切る", async () => {
    const { Readable } = await import("node:stream");
    const chunked = (parts: string[]) => Readable.from(parts.map((p) => Buffer.from(p))) as unknown as IncomingMessage;
    expect(await readLimitedBody(chunked(["abc", "def"]), 10)).toBe("abcdef");
    await expect(readLimitedBody(chunked(["12345", "67890", "x"]), 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(await readLimitedBody(chunked([]), 10)).toBe("");
  });
  it("上限は環境変数で変えられ、不正な値は既定に戻る", () => {
    expect(maxWsPayloadBytes({})).toBe(32 * 1024 * 1024);
    expect(maxWsPayloadBytes({ HARMONY_MAX_WS_PAYLOAD_BYTES: "1024" })).toBe(1024);
    expect(maxWsPayloadBytes({ HARMONY_MAX_WS_PAYLOAD_BYTES: "-5" })).toBe(32 * 1024 * 1024);
    expect(maxHttpBodyBytes({ HARMONY_MAX_HTTP_BODY_BYTES: "abc" })).toBe(8 * 1024 * 1024);
  });
});

describe("MCP の権限 (mcpAccess)", () => {
  const allTools = tools.map((t) => t.name);
  it("未設定なら、すべて使える", () => {
    for (const name of allTools) expect(isToolAllowed(name, {}), name).toBe(true);
    expect(filterTools(tools, {})).toHaveLength(tools.length);
  });
  it("readonly: 読み取りの tool だけが残り、書き込みは拒否される", () => {
    const env = { HARMONY_MCP_MODE: "readonly" };
    for (const w of ["designer__remove_table", "designer__rename_entity", "designer__replace_references", "designer__undo_replace_references", "designer__save_all", "designer__update_step", "designer__restore_version", "designer__repair_registry", "designer__persist_uuids", "designer__solution_pack", "editSession__save", "editSession__create"]) {
      expect(isToolAllowed(w, env), w).toBe(false);
      expect(() => assertToolAllowed(w, env)).toThrow(/読み取り専用/);
    }
    for (const r of ["designer__list_tables", "designer__get_table", "designer__check_design", "designer__find_references", "designer__list_versions", "designer__generate_ddl", "editSession__list"]) {
      expect(isToolAllowed(r, env), r).toBe(true);
    }
  });
  it("readonly で残る tool の一覧 (新しい tool が読み取り扱いになるときは、中身を確かめてここを更新する)", () => {
    const listed = filterTools(tools, { HARMONY_MCP_MODE: "readonly" }).map((t) => t.name).sort();
    expect(listed).toEqual([
      "designer__analyze_branches", "designer__analyze_design", "designer__check_design", "designer__check_generation_drift", "designer__check_harmony_update", "designer__check_screen_item_refs",
      "designer__check_test_coverage", "designer__close_tab", "designer__compare_workspaces", "designer__export_arazzo", "designer__export_openapi",
      "designer__export_spec", "designer__find_all_markers", "designer__find_references", "designer__generate_ddl", "designer__generate_er_mermaid",
      "designer__generate_test_data", "designer__get_business_flow", "designer__get_changes_since", "designer__get_conventions", "designer__get_design",
      "designer__get_design_document", "designer__get_er_diagram", "designer__get_extension_package", "designer__get_flow", "designer__get_flow_story",
      "designer__get_generation_brief", "designer__get_page_layout", "designer__get_process_flow", "designer__get_project_context", "designer__get_regeneration_diff",
      "designer__get_rename_context", "designer__get_report", "designer__get_response_type_extension", "designer__get_screen_layout", "designer__get_step",
      "designer__get_table", "designer__get_tech_stack", "designer__get_test_viewpoints", "designer__get_tool_guide", "designer__list_business_flows",
      "designer__list_designs", "designer__list_extension_packages", "designer__list_extensions", "designer__list_layout_components", "designer__list_markers",
      "designer__list_page_layouts", "designer__list_process_flows", "designer__list_reports", "designer__list_response_type_extensions", "designer__list_review_comments",
      "designer__list_screens", "designer__list_steps", "designer__list_tables", "designer__list_tabs", "designer__list_versions",
      "designer__navigate_screen", "designer__open_tab", "designer__search_design", "designer__switch_tab", "designer__validate_design",
      "designer__walk_flow", "designer__workspace_close", "designer__workspace_inspect", "designer__workspace_list", "designer__workspace_open",
      "designer__workspace_status", "editSession__fetch_payload", "editSession__list",
    ]);
  });
  it("readonly でも、ワークスペースを開くのは通るが、新規作成 (init: true) は拒否", () => {
    const env = { HARMONY_MCP_MODE: "readonly" };
    expect(isToolAllowed("designer__workspace_open", env, { path: "/x" })).toBe(true);
    expect(isToolAllowed("designer__workspace_open", env, { path: "/x", init: true })).toBe(false);
  });
  it("HARMONY_MCP_DENY: 名前 (designer__ は省略可) で拒否できる", () => {
    const env = { HARMONY_MCP_DENY: "remove_table, designer__rename_entity" };
    expect(isToolAllowed("designer__remove_table", env)).toBe(false);
    expect(isToolAllowed("designer__rename_entity", env)).toBe(false);
    expect(isToolAllowed("designer__add_table", env)).toBe(true);
    expect(() => assertToolAllowed("designer__remove_table", env)).toThrow(/HARMONY_MCP_DENY/);
    expect(filterTools(tools, env).some((t) => t.name === "designer__remove_table")).toBe(false);
  });
});

describe("旧形式 (GrapesJS) の画面は、読んだだけでは書き換えない", () => {
  const legacy = { pages: [{ frames: [{ component: { type: "wrapper" } }] }], styles: [], assets: [] };

  it("読み出しはメモリ上で変換するだけ (ファイルは変わらない)。保存のとき初めて旧形式を .design.json へ退避する", async () => {
    const root = await makeWs();
    const dir = path.join(root, "harmony", "screens");
    const entityPath = path.join(dir, "old-screen.json");
    await fs.writeFile(entityPath, JSON.stringify(legacy));
    const before = await fs.readdir(dir);

    const entity = await readScreenEntity("old-screen", root) as { id: string; kind: string; uuid: string };
    expect(entity.id).toBe("old-screen");
    // 書かないので、何度読んでも同じ uuid (種類 + id から決めた値)。保存したあとも変わらない
    expect(((await readScreenEntity("old-screen", root)) as { uuid: string }).uuid).toBe(entity.uuid);
    // 日時も、読むたびに変わらない (旧ファイルの更新時刻)
    await new Promise((r) => setTimeout(r, 20));
    const again = await readScreenEntity("old-screen", root) as { createdAt?: string; updatedAt?: string };
    const first = entity as unknown as { createdAt?: string; updatedAt?: string };
    expect(again.updatedAt).toBe(first.updatedAt);
    expect(again.createdAt).toBe(first.createdAt);
    const design = await readScreen("old-screen", root);
    expect(design).toMatchObject({ pages: expect.any(Array) }); // 旧形式の中身は、そのまま読める

    expect(await fs.readdir(dir)).toEqual(before);
    expect(JSON.parse(await fs.readFile(entityPath, "utf-8"))).toEqual(legacy);

    // 保存 (明示的な書き込み): 旧形式は .design.json に残り、実体は新しい形になる
    await writeScreenEntity("old-screen", { ...entity, name: "旧画面" }, root);
    expect(JSON.parse(await fs.readFile(path.join(dir, "old-screen.design.json"), "utf-8"))).toEqual(legacy);
    const saved = JSON.parse(await fs.readFile(entityPath, "utf-8"));
    expect(saved.pages).toBeUndefined();
    expect(saved.name).toBe("旧画面");
    expect(saved.uuid).toBe(entity.uuid);
  });
});

describe("スキーマの版の移行の枠組み (schemaMigration)", () => {
  const m1: SchemaMigration = { id: "v3-to-v4/rename-name", from: "v3", to: "v4", description: "name → title", targets: ["table"], migrate: (d) => { const { name, ...rest } = d; return name === undefined ? d : { ...rest, title: name }; } };
  const m2: SchemaMigration = { id: "v4-to-v5/add-flag", from: "v4", to: "v5", description: "flag", migrate: (d, ctx) => (ctx.target === "project" ? d : { ...d, flag: true }) };

  it("登録された移行は、いまは空 (最新の版 v3 では、移行は不要)", async () => {
    expect(MIGRATIONS).toEqual([]);
    const root = await makeWs();
    expect(await migrateWorkspace(root)).toMatchObject({ fromVersion: "v3", toVersion: "v3", migrations: [], files: [], applied: false });
  });

  it("chainFrom: 版を順にたどる。欠けていれば例外", () => {
    expect(chainFrom("v3", [m1, m2], "v5").map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(chainFrom("v5", [m1, m2], "v5")).toEqual([]);
    expect(() => chainFrom("v3", [m2], "v5")).toThrow(/登録されていません/);
  });

  it("changedKeys は、変わった項目だけを返す", () => {
    expect(changedKeys({ a: 1, b: { c: 1 } }, { a: 1, b: { c: 2 }, d: 0 })).toEqual(["b", "d"]);
  });

  it("予行は書かない。apply で書き換え、書き換える前の内容は版に残り、harmony.json の版が上がる。2 回目は不要", async () => {
    const root = await makeWs();
    await writeTable("mig", table("mig", "旧名"), root);
    const file = path.join(root, "harmony", "tables", "mig.json");
    const raw = await fs.readFile(file, "utf-8");

    const dry = await migrateWorkspace(root, { migrations: [m1, m2], latest: "v5" });
    expect(dry.applied).toBe(false);
    expect(dry.files.find((f) => f.id === "mig")).toMatchObject({ target: "table", changedKeys: expect.arrayContaining(["name", "title", "flag"]) });
    expect(await fs.readFile(file, "utf-8")).toBe(raw);

    const done = await migrateWorkspace(root, { migrations: [m1, m2], latest: "v5", apply: true });
    expect(done.applied).toBe(true);
    const after = await read(file);
    expect(after).toMatchObject({ title: "旧名", flag: true });
    expect(after.name).toBeUndefined();
    expect(((await readProject(root)) as { schemaVersion: string }).schemaVersion).toBe("v5");
    // 書き換える前の内容は、版に残っている
    const versions = await listEntityVersions(root, "table", "mig");
    expect((await readEntityVersion(root, "table", "mig", versions[0].id) as { name: string }).name).toBe("旧名");
    // 設計の実体のほか、業務フロー・規約なども対象 (版だけ上がって、旧版のまま残らない)
    // 版が最新になったので、もう一度実行しても何も起きない
    expect(await migrateWorkspace(root, { migrations: [m1, m2], latest: "v5", apply: true })).toMatchObject({ migrations: [], files: [], applied: false });
  });

  it("読めないファイルがあるときは、apply を拒否する (版を上げると、そのファイルは移行されないまま残るため)。予行は、飛ばしたファイルを知らせる", async () => {
    const root = await makeWs();
    await writeTable("ok-one", table("ok-one", "良い"), root);
    await fs.writeFile(path.join(root, "harmony", "tables", "bad-one.json"), "{ not json");
    const dry = await migrateWorkspace(root, { migrations: [m1, m2], latest: "v5" });
    expect(dry.skipped).toEqual(["tables/bad-one.json"]);
    await expect(migrateWorkspace(root, { migrations: [m1, m2], latest: "v5", apply: true })).rejects.toThrow(/読めないファイル/);
    expect(((await readProject(root)) as { schemaVersion: string }).schemaVersion).toBe("v3");
  });

  it("業務フロー・帳票・規約・独自部品・汎用定義・画面項目も、移行の対象", async () => {
    const root = await makeWs();
    const d = path.join(root, "harmony");
    await fs.mkdir(path.join(d, "business-flows"), { recursive: true });
    await fs.mkdir(path.join(d, "reports"), { recursive: true });
    await fs.mkdir(path.join(d, "generic-definitions", "message"), { recursive: true });
    await fs.writeFile(path.join(d, "business-flows", "bf.json"), JSON.stringify({ id: "bf", lanes: [], steps: [] }));
    await fs.writeFile(path.join(d, "reports", "rp.json"), JSON.stringify({ id: "rp", sections: [] }));
    await fs.writeFile(path.join(d, "generic-definitions", "message", "m1.json"), JSON.stringify({ name: "m1" }));
    await fs.writeFile(path.join(d, "layout-components.json"), JSON.stringify({ version: 1, components: [] }));
    await fs.writeFile(path.join(d, "er-layout.json"), JSON.stringify({ positions: {} }));
    await fs.mkdir(path.join(d, "extensions"), { recursive: true });
    await fs.writeFile(path.join(d, "extensions", "steps.json"), JSON.stringify({ steps: [] }));
    const flag: SchemaMigration = { id: "v3-to-v4/flag", from: "v3", to: "v4", description: "flag", migrate: (data) => ({ ...data, flag: true }) };
    const rep = await migrateWorkspace(root, { migrations: [flag], latest: "v4" });
    const byTarget = Object.fromEntries(rep.files.map((f) => [f.target, f.file]));
    expect(byTarget).toMatchObject({ businessFlow: "business-flows/bf.json", report: "reports/rp.json", genericDefinition: "generic-definitions/message/m1.json", layoutComponents: "layout-components.json", project: "harmony.json" });
    expect(rep.files.filter((f) => f.target === "other").map((f) => f.file).sort()).toEqual(["er-layout.json", "extensions/steps.json"]);
  });
});
