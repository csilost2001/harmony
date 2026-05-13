#!/usr/bin/env node
// scripts/spec-check/ 内 script の自動テスト。schema 更新による drift / spec 表との
// 一致を CI で gate する。
//
// Usage: node scripts/spec-check/test.mjs
// Exit code: 0 = pass, 1 = fail

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

let pass = 0;
let fail = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}${detail ? `: ${detail}` : ""}`);
    fail++;
  }
}

function runScript(scriptName, args = [], opts = {}) {
  const result = spawnSync("node", [join(__dirname, scriptName), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000, // 30s timeout — extract / lint は秒未満で終わる前提、hang は immediate fail
    ...opts,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
    signal: result.signal, // SIGTERM 等 (timeout 時)
    error: result.error, // spawn 失敗時の Error
  };
}

// =============================================================================
// Schema 読み込み (full snapshot test 用)
// =============================================================================
const schemaJson = JSON.parse(readFileSync(join(ROOT, "schemas/v3/process-flow.v3.schema.json"), "utf8"));
const $defs = schemaJson.$defs;

// =============================================================================
// 1. extract-step-required.mjs FULL snapshot test (24 row 全件 exact compare)
// =============================================================================
console.log("\n## extract-step-required.mjs (full snapshot)");
{
  const { stdout, status, signal, error } = runScript("extract-step-required.mjs");
  if (error) console.log(`  (spawn error: ${error.message})`);
  if (signal) console.log(`  (signal: ${signal})`);
  assert("exits 0", status === 0);
  assert("Total: 24 step kinds output", /Total: 24 step kinds/.test(stdout));
  assert("no `?` placeholder", !/^- `\?`/m.test(stdout), "kind 未解決の variant が残存");

  // schema から動的に 24 step variant の (kind, required - [id,kind,description]) を抽出
  const stepUnion = $defs.Step.oneOf.map((r) => r.$ref.replace("#/$defs/", ""));
  for (const stepName of stepUnion) {
    const def = $defs[stepName];
    if (!def?.allOf || def.allOf.length < 2) continue;
    const variant = def.allOf[1];
    const required = variant.required || [];
    const kindConst = variant.properties?.kind?.const
      ?? (stepName === "ExtensionStep" ? "extension" : "?");
    const extra = required.filter((r) => !["id", "kind", "description"].includes(r));
    const expected = extra.length > 0 ? extra.join(", ") : "(なし)";
    // 行末まで含めた逐字一致
    const lineRegex = new RegExp(`^- \`${kindConst}\` → ${expected.replace(/[()]/g, "\\$&")}$`, "m");
    assert(`row exact match: \`${kindConst}\` → ${expected}`, lineRegex.test(stdout));
  }
}

// =============================================================================
// 2. extract-nested-required.mjs FULL snapshot test (全 nested $defs 動的検証)
// =============================================================================
console.log("\n## extract-nested-required.mjs (full snapshot)");
{
  const { stdout, status, signal, error } = runScript("extract-nested-required.mjs");
  if (error) console.log(`  (spawn error: ${error.message})`);
  if (signal) console.log(`  (signal: ${signal})`);
  assert("exits 0", status === 0);

  // script が列挙している全 nested def を実 schema から検証
  const nestedDefs = [
    "Branch", "ElseBranch", "BranchCondition",
    "ValidationRule", "ValidationInlineBranch",
    "WorkflowApprover", "WorkflowQuorum",
    "AiMessage", "AiMessageItem", "AiTool", "AiToolRef", "AiToolChoice", "AiResponseFormat",
    "AffectedRowsCheck", "DataLineage",
    "CdcDestination",
    "OutputBinding", "TxBoundary",
  ];
  for (const name of nestedDefs) {
    const def = $defs[name];
    if (!def) {
      // script が「not found in $defs」と出力するはず
      assert(`${name}: marked as "not found"`, new RegExp(`${name}: \\(not found`).test(stdout));
      continue;
    }
    if (def.oneOf) {
      // oneOf variant ごとに required を確認
      def.oneOf.forEach((variant, i) => {
        const req = (variant.required || []).join(", ");
        const expected = `    variant ${i}: required = [${req}]`;
        assert(
          `${name} variant ${i}: required = [${req}]`,
          stdout.includes(expected)
        );
      });
    } else {
      const req = (def.required || []).join(", ");
      const expected = `- ${name}: required = [${req}]`;
      assert(`${name}: required = [${req}]`, stdout.includes(expected));
    }
  }
}

// =============================================================================
// 3. lint-generic-definitions.mjs fixture test (正例 + 負例)
// =============================================================================
console.log("\n## lint-generic-definitions.mjs (fixture)");
const FIXTURE_ROOT = join(ROOT, ".tmp/spec-check-fixtures");
try {
  // 既存があれば削除して clean state
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });

  // (A) Valid project
  const validRoot = join(FIXTURE_ROOT, "valid-project");
  mkdirSync(join(validRoot, "harmony/generic-definitions/data-contract"), { recursive: true });
  writeFileSync(
    join(validRoot, "harmony.json"),
    JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-000000000001", name: "test", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } }, null, 2)
  );
  writeFileSync(
    join(validRoot, "harmony/generic-definitions/data-contract/OrderForm.json"),
    JSON.stringify({
      kind: "data-contract",
      name: "OrderForm",
      purpose: "注文フォーム",
      responsibilities: ["注文入力値保持"],
      targets: ["backend", "frontend"],
    }, null, 2)
  );
  {
    const { status } = runScript("lint-generic-definitions.mjs", [validRoot]);
    assert("valid project exits 0", status === 0);
  }

  // (B) Invalid: kind enum 違反
  const invalidKindRoot = join(FIXTURE_ROOT, "invalid-kind");
  mkdirSync(join(invalidKindRoot, "harmony/generic-definitions/data-contract"), { recursive: true });
  writeFileSync(
    join(invalidKindRoot, "harmony.json"),
    JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-000000000002", name: "test", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } })
  );
  writeFileSync(
    join(invalidKindRoot, "harmony/generic-definitions/data-contract/Bad.json"),
    JSON.stringify({ kind: "unknown-kind", name: "Bad", purpose: "x", responsibilities: [], targets: ["backend"] })
  );
  {
    const { status, stdout } = runScript("lint-generic-definitions.mjs", [invalidKindRoot]);
    assert("invalid-kind exits 1", status === 1);
    assert("error mentions kind", /invalid kind/.test(stdout));
  }

  // (C) Invalid: path/kind mismatch
  const mismatchRoot = join(FIXTURE_ROOT, "path-mismatch");
  mkdirSync(join(mismatchRoot, "harmony/generic-definitions/domain-type"), { recursive: true });
  writeFileSync(
    join(mismatchRoot, "harmony.json"),
    JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-000000000003", name: "test", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } })
  );
  writeFileSync(
    join(mismatchRoot, "harmony/generic-definitions/domain-type/Foo.json"),
    JSON.stringify({ kind: "data-contract", name: "Foo", purpose: "x", responsibilities: [], targets: ["backend"] })
  );
  {
    const { status, stdout } = runScript("lint-generic-definitions.mjs", [mismatchRoot]);
    assert("path/kind mismatch exits 1", status === 1);
    assert("error mentions path/kind mismatch", /path\/kind mismatch/.test(stdout));
  }

  // (D) Invalid: 必須 field 欠落
  const missingRoot = join(FIXTURE_ROOT, "missing-field");
  mkdirSync(join(missingRoot, "harmony/generic-definitions/data-contract"), { recursive: true });
  writeFileSync(
    join(missingRoot, "harmony.json"),
    JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-000000000004", name: "test", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } })
  );
  writeFileSync(
    join(missingRoot, "harmony/generic-definitions/data-contract/Missing.json"),
    JSON.stringify({ kind: "data-contract", name: "Missing" })
  );
  {
    const { status, stdout } = runScript("lint-generic-definitions.mjs", [missingRoot]);
    assert("missing-field exits 1", status === 1);
    assert("error mentions missing required", /missing required field/.test(stdout));
  }

  // (D2) 空 generic-definitions/ → nothing to lint (exit 2、S-1/round5 fix)
  const emptyRoot = join(FIXTURE_ROOT, "empty-gd");
  mkdirSync(join(emptyRoot, "harmony/generic-definitions"), { recursive: true });
  writeFileSync(
    join(emptyRoot, "harmony.json"),
    JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-000000000005", name: "test", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } })
  );
  {
    const { status, stdout } = runScript("lint-generic-definitions.mjs", [emptyRoot]);
    assert("空 generic-definitions/ は exit 2 (silent pass 禁止)", status === 2, `status=${status}`);
    assert("error message: nothing to lint", /nothing to lint/.test(stdout));
  }

  // (E) harmony.json 不在 → error (S-4 fix)
  const noHarmonyRoot = join(FIXTURE_ROOT, "no-harmony");
  mkdirSync(join(noHarmonyRoot, "harmony/generic-definitions/data-contract"), { recursive: true });
  writeFileSync(
    join(noHarmonyRoot, "harmony/generic-definitions/data-contract/Ok.json"),
    JSON.stringify({ kind: "data-contract", name: "Ok", purpose: "x", responsibilities: [], targets: ["backend"] })
  );
  {
    const { status, stdout, stderr } = runScript("lint-generic-definitions.mjs", [noHarmonyRoot]);
    assert("harmony.json 不在は exit 1 (silent fallback 禁止)", status === 1, `status=${status}`);
    assert("error mentions harmony.json", /harmony\.json/.test(stdout + stderr));
  }
} finally {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
}

// =============================================================================
// Summary
// =============================================================================
console.log();
console.log(`Pass: ${pass}, Fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
