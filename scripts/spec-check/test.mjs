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
import { readSpecDoc, extractFences, stripJsoncComments, parseStepCheatsheet, SPEC_DOC_PATH } from "./lib/spec-doc.mjs";

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
// 3b. generic-definition.v3.schema.json AJV strict gate (#1063)
//     section 3 の soft lint (5 field 存在 + kind enum + path-kind) を超える
//     strict 検証: name pattern / responsibilities minItems / relations[].kind enum /
//     unevaluatedProperties: false 等。soft lint は path-kind 物理配置と AJV gate
//     起動前の最低限 sanity check として保持し、本 strict gate が正となる。
// =============================================================================
console.log("\n## generic-definition.v3.schema.json (AJV strict)");
{
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const commonSchema = JSON.parse(readFileSync(join(ROOT, "schemas/v3/common.v3.schema.json"), "utf8"));
  const gdSchema = JSON.parse(readFileSync(join(ROOT, "schemas/v3/generic-definition.v3.schema.json"), "utf8"));
  ajv.addSchema(commonSchema);
  const validate = ajv.compile(gdSchema);

  const cases = [
    {
      name: "minimum required fields",
      valid: true,
      data: {
        kind: "data-contract",
        name: "OrderForm",
        purpose: "注文入力フォーム",
        responsibilities: ["注文入力値保持"],
        targets: ["backend", "frontend"],
      },
    },
    {
      name: "full fields with operations / relations / mappingHints",
      valid: true,
      data: {
        kind: "component-definition",
        name: "OrderValidator",
        purpose: "注文入力の業務バリデーション",
        responsibilities: ["在庫確認", "与信チェック"],
        targets: ["backend"],
        fields: [{ name: "rules", type: "ValidationRule[]" }],
        operations: [
          {
            name: "validate",
            inputs: [{ name: "order", type: "OrderForm" }],
            outputs: [{ name: "result", type: "ValidationResult" }],
          },
        ],
        relations: [
          { kind: "uses", ref: "generic-definitions/data-contract/OrderForm" },
        ],
        constraints: ["validate は副作用を持たないこと"],
        mappingHints: {
          "backend.spring": { layer: "service" },
        },
      },
    },
    {
      name: "kind enum violation rejected",
      valid: false,
      data: {
        kind: "unknown-kind",
        name: "Bad",
        purpose: "x",
        responsibilities: ["y"],
        targets: ["backend"],
      },
    },
    {
      name: "name pattern violation (starts with digit) rejected",
      valid: false,
      data: {
        kind: "data-contract",
        name: "1Bad",
        purpose: "x",
        responsibilities: ["y"],
        targets: ["backend"],
      },
    },
    {
      name: "name pattern violation (hyphen) rejected",
      valid: false,
      data: {
        kind: "data-contract",
        name: "Bad-Name",
        purpose: "x",
        responsibilities: ["y"],
        targets: ["backend"],
      },
    },
    {
      name: "responsibilities empty array rejected (minItems: 1)",
      valid: false,
      data: {
        kind: "data-contract",
        name: "Empty",
        purpose: "x",
        responsibilities: [],
        targets: ["backend"],
      },
    },
    {
      name: "targets invalid enum rejected",
      valid: false,
      data: {
        kind: "data-contract",
        name: "BadTarget",
        purpose: "x",
        responsibilities: ["y"],
        targets: ["mobile"],
      },
    },
    {
      name: "unknown top-level property rejected (unevaluatedProperties: false)",
      valid: false,
      data: {
        kind: "data-contract",
        name: "Extra",
        purpose: "x",
        responsibilities: ["y"],
        targets: ["backend"],
        unknownProp: "stale",
      },
    },
    {
      name: "relations[].kind invalid enum rejected",
      valid: false,
      data: {
        kind: "component-definition",
        name: "BadRelation",
        purpose: "x",
        responsibilities: ["y"],
        targets: ["backend"],
        relations: [{ kind: "weird-relation", ref: "x" }],
      },
    },
    {
      name: "purpose missing rejected",
      valid: false,
      data: {
        kind: "data-contract",
        name: "NoPurpose",
        responsibilities: ["y"],
        targets: ["backend"],
      },
    },
    {
      name: "kind missing rejected",
      valid: false,
      data: {
        name: "NoKind",
        purpose: "x",
        responsibilities: ["y"],
        targets: ["backend"],
      },
    },
    {
      name: "name missing rejected",
      valid: false,
      data: {
        kind: "data-contract",
        purpose: "x",
        responsibilities: ["y"],
        targets: ["backend"],
      },
    },
    {
      name: "targets missing rejected",
      valid: false,
      data: {
        kind: "data-contract",
        name: "NoTargets",
        purpose: "x",
        responsibilities: ["y"],
      },
    },
    {
      name: "responsibilities missing rejected",
      valid: false,
      data: {
        kind: "data-contract",
        name: "NoResp",
        purpose: "x",
        targets: ["backend"],
      },
    },
  ];

  for (const c of cases) {
    const ok = validate(c.data);
    if (c.valid) {
      const detail = ok
        ? ""
        : (validate.errors || []).slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
      assert(`✓ valid: ${c.name}`, ok, detail);
    } else {
      assert(`✗ invalid rejected: ${c.name}`, !ok);
    }
  }

  // examples/retail の sample 1 件以上が AJV pass することを確認 (回帰検出)
  const retailGdRoot = join(ROOT, "examples/retail/harmony/generic-definitions");
  if (existsSync(retailGdRoot)) {
    const { readdirSync } = await import("node:fs");
    function walk(dir) {
      const out = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.isFile() && full.endsWith(".json")) out.push(full);
      }
      return out;
    }
    const sampleFiles = walk(retailGdRoot);
    assert("examples/retail に generic-definition sample 1 件以上", sampleFiles.length >= 1, `actual=${sampleFiles.length}`);
    for (const f of sampleFiles) {
      const data = JSON.parse(readFileSync(f, "utf8"));
      const ok = validate(data);
      const detail = ok
        ? ""
        : (validate.errors || []).slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
      assert(`examples sample AJV pass: ${f.split("generic-definitions/")[1]}`, ok, detail);
    }
  }
}

// =============================================================================
// 3c. kind 別固有 schema AJV strict gate (#1064)
//     data-contract.v3.schema.json / domain-type.v3.schema.json の strict 検証。
//     各 kind-specific schema は親 schema を allOf 継承し kind を const に固定。
//     retail walk を kind 別 dispatch に改修して silent pass を防ぐ。
// =============================================================================
console.log("\n## kind-specific schema AJV strict gate (data-contract / domain-type, #1064)");
{
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);

  const commonSchema = JSON.parse(readFileSync(join(ROOT, "schemas/v3/common.v3.schema.json"), "utf8"));
  const gdSchema = JSON.parse(readFileSync(join(ROOT, "schemas/v3/generic-definition.v3.schema.json"), "utf8"));

  ajv.addSchema(commonSchema);
  // 子 schema 内の $ref: "../generic-definition.v3.schema.json" と一致する key で登録
  ajv.addSchema(gdSchema, "../generic-definition.v3.schema.json");

  const dcSchema = JSON.parse(readFileSync(join(ROOT, "schemas/v3/generic-definitions/data-contract.v3.schema.json"), "utf8"));
  const dtSchema = JSON.parse(readFileSync(join(ROOT, "schemas/v3/generic-definitions/domain-type.v3.schema.json"), "utf8"));

  const validateDataContract = ajv.compile(dcSchema);
  const validateDomainType = ajv.compile(dtSchema);

  // --- data-contract cases ---
  const dcCases = [
    {
      name: "data-contract: minimum valid",
      valid: true,
      data: {
        kind: "data-contract",
        name: "OrderForm",
        purpose: "注文入力フォームの層間契約",
        responsibilities: ["注文入力値保持"],
        targets: ["backend", "frontend"],
      },
    },
    {
      name: "data-contract: kind 不一致 (domain-type) rejected",
      valid: false,
      data: {
        kind: "domain-type",
        name: "Order",
        purpose: "注文エンティティ",
        responsibilities: ["注文永続化"],
        targets: ["backend"],
      },
    },
    {
      name: "data-contract: purpose 欠落 rejected",
      valid: false,
      data: {
        kind: "data-contract",
        name: "NoPurpose",
        responsibilities: ["y"],
        targets: ["backend"],
      },
    },
    {
      name: "data-contract: name pattern violation (starts with digit) rejected",
      valid: false,
      data: {
        kind: "data-contract",
        name: "1Bad",
        purpose: "x",
        responsibilities: ["y"],
        targets: ["backend"],
      },
    },
  ];

  for (const c of dcCases) {
    const ok = validateDataContract(c.data);
    if (c.valid) {
      const detail = ok
        ? ""
        : (validateDataContract.errors || []).slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
      assert(`✓ dc valid: ${c.name}`, ok, detail);
    } else {
      assert(`✗ dc invalid rejected: ${c.name}`, !ok);
    }
  }

  // --- domain-type cases ---
  const dtCases = [
    {
      name: "domain-type: minimum valid",
      valid: true,
      data: {
        kind: "domain-type",
        name: "Order",
        purpose: "注文ドメインの永続化エンティティ",
        responsibilities: ["注文の最終状態を永続化する"],
        targets: ["backend", "shared"],
      },
    },
    {
      name: "domain-type: kind 不一致 (data-contract) rejected",
      valid: false,
      data: {
        kind: "data-contract",
        name: "OrderForm",
        purpose: "注文フォーム DTO",
        responsibilities: ["入力保持"],
        targets: ["backend"],
      },
    },
    {
      name: "domain-type: purpose 欠落 rejected",
      valid: false,
      data: {
        kind: "domain-type",
        name: "NoPurpose",
        responsibilities: ["y"],
        targets: ["backend"],
      },
    },
    {
      name: "domain-type: name pattern violation (hyphen) rejected",
      valid: false,
      data: {
        kind: "domain-type",
        name: "Bad-Name",
        purpose: "x",
        responsibilities: ["y"],
        targets: ["backend"],
      },
    },
  ];

  for (const c of dtCases) {
    const ok = validateDomainType(c.data);
    if (c.valid) {
      const detail = ok
        ? ""
        : (validateDomainType.errors || []).slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
      assert(`✓ dt valid: ${c.name}`, ok, detail);
    } else {
      assert(`✗ dt invalid rejected: ${c.name}`, !ok);
    }
  }

  // --- retail walk: kind 別 dispatch ---
  // ファイル path から kind を抽出して kind 別 schema で validate する。
  // 未知の kind は silent pass を防ぐため fail させる。
  const retailGdRoot2 = join(ROOT, "examples/retail/harmony/generic-definitions");
  if (existsSync(retailGdRoot2)) {
    const { readdirSync } = await import("node:fs");
    function walk2(dir) {
      const out = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk2(full));
        else if (entry.isFile() && full.endsWith(".json")) out.push(full);
      }
      return out;
    }

    // kind → validator map (本 PR 対象の 2 kind)
    const kindValidators = {
      "data-contract": validateDataContract,
      "domain-type": validateDomainType,
    };

    const sampleFiles2 = walk2(retailGdRoot2);
    assert("examples/retail に generic-definition sample 1 件以上 (kind dispatch用)", sampleFiles2.length >= 1, `actual=${sampleFiles2.length}`);

    for (const f of sampleFiles2) {
      // path から kind を抽出: generic-definitions/<kind>/<Name>.json
      const rel = f.split("generic-definitions/")[1]; // e.g. "data-contract/OrderForm.json"
      const kindFromPath = rel ? rel.split("/")[0] : null;

      const kindValidator = kindFromPath ? kindValidators[kindFromPath] : null;

      if (kindValidator) {
        // kind 別 schema で validate
        const data = JSON.parse(readFileSync(f, "utf8"));
        const ok = kindValidator(data);
        const detail = ok
          ? ""
          : (kindValidator.errors || []).slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
        assert(`examples kind-dispatch AJV pass: ${rel}`, ok, detail);
      } else {
        // 未知の kind (他の kind は親 schema のみで validate — silent pass 防止のため親 schema で最低限検証)
        const gdAjv = new Ajv2020({ strict: false, allErrors: true });
        addFormats(gdAjv);
        gdAjv.addSchema(commonSchema);
        const gdValidate = gdAjv.compile(gdSchema);
        const data = JSON.parse(readFileSync(f, "utf8"));
        const ok = gdValidate(data);
        const detail = ok
          ? ""
          : (gdValidate.errors || []).slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
        assert(`examples kind-dispatch (parent schema fallback): ${rel}`, ok, detail);
      }
    }
  }
}

// =============================================================================
// 3d. screen-item.v3.schema.json binding / effects strict gate (#1065)
//     ScreenItem.binding (5 field) + ScreenItemEvent.effects[] (7 kind) の
//     positive / negative / bidirectional sabotage cases。
// =============================================================================
console.log("\n## screen-item.v3.schema.json binding / effects strict (#1065)");
{
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const commonSchema = JSON.parse(readFileSync(join(ROOT, "schemas/v3/common.v3.schema.json"), "utf8"));
  const siSchema = JSON.parse(readFileSync(join(ROOT, "schemas/v3/screen-item.v3.schema.json"), "utf8"));
  ajv.addSchema(commonSchema);
  const validateItem = ajv.compile(siSchema);

  function assertItem(name, data, expectValid) {
    const ok = validateItem(data);
    if (expectValid) {
      const detail = ok
        ? ""
        : (validateItem.errors || []).slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
      assert(`✓ binding/effects valid: ${name}`, ok, detail);
    } else {
      assert(`✗ binding/effects invalid rejected: ${name}`, !ok);
    }
  }

  // ── ScreenItem.binding cases (5 件) ──────────────────────────────────
  // positive minimum: binding.kind のみ
  assertItem("binding minimum (kind only)", {
    id: "productCode",
    label: "商品コード",
    type: "string",
    binding: { kind: "formField" },
  }, true);

  // positive full: 5 field すべて有り
  assertItem("binding full (5 fields)", {
    id: "productCode",
    label: "商品コード",
    type: "string",
    binding: {
      kind: "viewModel",
      path: "viewModel.productCode",
      role: "display",
      formatHint: "0.00%",
      sourceNote: "spec_SC000001.md#mapping",
    },
  }, true);

  // negative: kind unknown enum
  assertItem("binding kind=unknown rejected", {
    id: "x",
    label: "X",
    type: "string",
    binding: { kind: "unknown" },
  }, false);

  // negative: role unknown enum
  assertItem("binding role=weird rejected", {
    id: "x",
    label: "X",
    type: "string",
    binding: { kind: "formField", role: "weird" },
  }, false);

  // negative: additionalProperty on binding
  assertItem("binding bogus additionalProperty rejected", {
    id: "x",
    label: "X",
    type: "string",
    binding: { kind: "formField", bogus: "x" },
  }, false);

  // ── ScreenItemEvent.effects[] cases ──────────────────────────────────
  // positive: all 7 kinds in one item
  assertItem("effects all 7 kinds positive", {
    id: "regionCode",
    label: "地域コード",
    type: "string",
    events: [
      {
        id: "change",
        handlerFlowId: "aaaaaaaa-0001-4000-8000-000000000001",
        effects: [
          { kind: "clear", target: "cityCode" },
          { kind: "setReadonly", target: "cityCode", value: true },
          { kind: "setEnabled", target: "submitBtn", value: "form.regionCode !== ''" },
          { kind: "setVisible", target: "helpText", value: false },
          { kind: "setOptions", target: "citySelect", value: "catalog.cities" },
          { kind: "showDialog", target: "confirmDialog" },
          { kind: "setMessage", target: "msgArea" },
          { kind: "refreshList", target: "cityList" },
          {
            kind: "applyAjaxResult",
            mapping: { "data.cities": "cityCode" },
          },
        ],
      },
    ],
  }, true);

  // negative: clear with extra value field
  assertItem("effects clear with extra value rejected (additionalProperties)", {
    id: "x",
    label: "X",
    type: "string",
    events: [
      {
        id: "click",
        handlerFlowId: "aaaaaaaa-0001-4000-8000-000000000001",
        effects: [{ kind: "clear", target: "someField", value: "extra" }],
      },
    ],
  }, false);

  // negative: setReadonly missing value
  assertItem("effects setReadonly missing value rejected", {
    id: "x",
    label: "X",
    type: "string",
    events: [
      {
        id: "click",
        handlerFlowId: "aaaaaaaa-0001-4000-8000-000000000001",
        effects: [{ kind: "setReadonly", target: "someField" }],
      },
    ],
  }, false);

  // negative: setReadonly value=42 (not boolean or ExpressionString)
  // Note: ExpressionString is just a string, so 42 (number) should be rejected
  assertItem("effects setReadonly value=42 (number) rejected", {
    id: "x",
    label: "X",
    type: "string",
    events: [
      {
        id: "click",
        handlerFlowId: "aaaaaaaa-0001-4000-8000-000000000001",
        effects: [{ kind: "setReadonly", target: "someField", value: 42 }],
      },
    ],
  }, false);

  // negative: setOptions missing value
  assertItem("effects setOptions missing value rejected", {
    id: "x",
    label: "X",
    type: "string",
    events: [
      {
        id: "click",
        handlerFlowId: "aaaaaaaa-0001-4000-8000-000000000001",
        effects: [{ kind: "setOptions", target: "someField" }],
      },
    ],
  }, false);

  // negative: applyAjaxResult missing mapping
  assertItem("effects applyAjaxResult missing mapping rejected", {
    id: "x",
    label: "X",
    type: "string",
    events: [
      {
        id: "click",
        handlerFlowId: "aaaaaaaa-0001-4000-8000-000000000001",
        effects: [{ kind: "applyAjaxResult" }],
      },
    ],
  }, false);

  // negative: unknown kind "weird"
  assertItem("effects kind=weird rejected (oneOf all fail)", {
    id: "x",
    label: "X",
    type: "string",
    events: [
      {
        id: "click",
        handlerFlowId: "aaaaaaaa-0001-4000-8000-000000000001",
        effects: [{ kind: "weird", target: "someField" }],
      },
    ],
  }, false);

  // negative: applyAjaxResult.mapping value = "with-hyphen" (Identifier violation)
  assertItem("effects applyAjaxResult mapping value Identifier violation rejected", {
    id: "x",
    label: "X",
    type: "string",
    events: [
      {
        id: "click",
        handlerFlowId: "aaaaaaaa-0001-4000-8000-000000000001",
        effects: [{ kind: "applyAjaxResult", mapping: { "data.field": "with-hyphen" } }],
      },
    ],
  }, false);
}

// =============================================================================
// 3e. migration script の fixture test (#1065)
//     .tmp/spec-check-fixtures/migration-binding-v1/ 配下に synthetic project を作成し
//     migrate-binding-v1-to-structured.mjs を spawn して fixture 検証。
// =============================================================================
console.log("\n## migrate-binding-v1-to-structured.mjs fixture test (#1065)");
{
  const MIGRATION_FIXTURE_ROOT = join(ROOT, ".tmp/spec-check-fixtures/migration-binding-v1");
  const scriptPath = join(ROOT, "scripts/migrate-binding-v1-to-structured.mjs");

  // fixture project 初期化
  try {
    rmSync(MIGRATION_FIXTURE_ROOT, { recursive: true, force: true });
  } catch { /* ignore */ }
  mkdirSync(join(MIGRATION_FIXTURE_ROOT, "harmony/screens"), { recursive: true });

  writeFileSync(
    join(MIGRATION_FIXTURE_ROOT, "harmony.json"),
    JSON.stringify({
      schemaVersion: "v3",
      dataDir: "harmony",
      meta: {
        id: "ffffffff-0001-4000-8000-000000000001",
        name: "migration-fixture",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    }, null, 2) + "\n"
  );

  // fixture screen JSON
  const screenData = {
    id: "screen-fixture-001",
    name: "テスト画面",
    kind: "form",
    path: "/fixture",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    items: [
      // fixture 1: sentinel あり → migration される
      {
        id: "productCode",
        label: "商品コード",
        type: "string",
        direction: "input",
        description: "[binding.v1] binding.attr=th:field; binding.path=form.productCode; source=spec.md#sec",
      },
      // fixture 2: viewModel kind
      {
        id: "totalPrice",
        label: "合計金額",
        type: "number",
        direction: "output",
        description: "[binding.v1] binding.attr=th:text; binding.path=viewModel.total",
      },
      // fixture 3: 既に binding あり → idempotent skip
      {
        id: "existingBound",
        label: "既存バインド",
        type: "string",
        binding: { kind: "viewModel" },
        description: "[binding.v1] binding.attr=th:text; binding.path=viewModel.foo",
      },
      // fixture 4: sentinel なし → 無変更
      {
        id: "normalField",
        label: "通常フィールド",
        type: "string",
        description: "sentinel なしの通常 description",
      },
    ],
  };

  const screenFilePath = join(MIGRATION_FIXTURE_ROOT, "harmony/screens/screen-fixture-001.json");
  writeFileSync(screenFilePath, JSON.stringify(screenData, null, 2) + "\n");

  // ── dry-run テスト ────────────────────────────────────────────────────
  const dryRunResult = spawnSync("node", [scriptPath, "--project", MIGRATION_FIXTURE_ROOT], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert("dry-run exits 0", dryRunResult.status === 0, dryRunResult.stderr?.slice(0, 200));
  assert("dry-run does not modify file", (() => {
    const after = JSON.parse(readFileSync(screenFilePath, "utf8"));
    return JSON.stringify(after) === JSON.stringify(screenData);
  })(), "file was modified during dry-run");

  // ── apply テスト ──────────────────────────────────────────────────────
  const applyResult = spawnSync("node", [scriptPath, "--project", MIGRATION_FIXTURE_ROOT, "--apply"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert("apply exits 0", applyResult.status === 0, applyResult.stderr?.slice(0, 200));

  const afterApply = JSON.parse(readFileSync(screenFilePath, "utf8"));

  // fixture 1: productCode → formField
  const item1 = afterApply.items.find((i) => i.id === "productCode");
  assert("fixture 1: binding.kind=formField", item1?.binding?.kind === "formField", JSON.stringify(item1?.binding));
  assert("fixture 1: binding.path=form.productCode", item1?.binding?.path === "form.productCode");
  assert("fixture 1: binding.sourceNote contains spec.md#sec", item1?.binding?.sourceNote?.includes("spec.md#sec"));
  assert("fixture 1: description removed (free text empty)", item1?.description === undefined);

  // fixture 2: totalPrice → viewModel
  const item2 = afterApply.items.find((i) => i.id === "totalPrice");
  assert("fixture 2: binding.kind=viewModel", item2?.binding?.kind === "viewModel", JSON.stringify(item2?.binding));
  assert("fixture 2: binding.path=viewModel.total", item2?.binding?.path === "viewModel.total");

  // fixture 3: existingBound → idempotent (no change)
  const item3 = afterApply.items.find((i) => i.id === "existingBound");
  assert("fixture 3: idempotent (binding unchanged)", item3?.binding?.kind === "viewModel");
  assert("fixture 3: description still present (not migrated)", typeof item3?.description === "string");

  // fixture 4: normalField → unchanged
  const item4 = afterApply.items.find((i) => i.id === "normalField");
  assert("fixture 4: no binding added (no sentinel)", item4?.binding === undefined);
  assert("fixture 4: description unchanged", item4?.description === "sentinel なしの通常 description");

  // ── 2 回目 apply (冪等性) ───────────────────────────────────────────
  const apply2Result = spawnSync("node", [scriptPath, "--project", MIGRATION_FIXTURE_ROOT, "--apply"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert("2nd apply exits 0", apply2Result.status === 0, apply2Result.stderr?.slice(0, 200));
  const afterApply2 = JSON.parse(readFileSync(screenFilePath, "utf8"));
  assert("2nd apply idempotent (no change)", JSON.stringify(afterApply2) === JSON.stringify(afterApply));

  // cleanup
  try {
    rmSync(MIGRATION_FIXTURE_ROOT, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// =============================================================================
// 4. spec doc 本体を input にした gate (Round 11 review M-1/M-2/M-3 対応)
//    Round 11 で指摘された「test.mjs が spec doc を一切読まない → cheatsheet /
//    jsonc fence / ✅ JSON 例の drift が CI gate を素通り」を解消する。
// =============================================================================
const specDoc = readSpecDoc();
const jsoncFences = extractFences(specDoc, "jsonc");

// -----------------------------------------------------------------------------
// 4-A. jsonc fence parseability (Round 11 M-2)
//      §0.5 で AI に「// 行を全削除してから AJV / JSON.parse / loader に渡す」と
//      契約しているため、各 fence は stripJsoncComments 後に必ず JSON.parse 可能。
// -----------------------------------------------------------------------------
console.log("\n## jsonc fence parseability (spec doc §0.5 contract)");
{
  assert("jsonc fence count >= 14", jsoncFences.length >= 14, `actual=${jsoncFences.length}`);
  for (const f of jsoncFences) {
    const stripped = stripJsoncComments(f.body);
    let ok = true;
    let err = "";
    try {
      JSON.parse(stripped);
    } catch (e) {
      ok = false;
      err = e.message;
    }
    assert(`L${f.line}: parse OK after stripping \`//\` lines`, ok, err);
  }
}

// -----------------------------------------------------------------------------
// 4-B. ✅ 現行 schema 例 AJV gate (Round 11 M-3)
//      `$schema` field を持つ jsonc fence は現行 schema 適合の ✅ 例。
//      schemas/v3/ に対する AJV validate を gate に組み込む。
//      ✨ RFC 将来案 (`$schema` なし) は対象外 (§10 B の soft gate)。
// -----------------------------------------------------------------------------
console.log("\n## ✅ 例 AJV validation against schemas/v3/");
{
  // ajv の dynamic import (root devDep にしてある)
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);

  const schemaFiles = [
    "schemas/v3/common.v3.schema.json",
    "schemas/v3/screen-item.v3.schema.json",
    "schemas/v3/screen.v3.schema.json",
    "schemas/v3/process-flow.v3.schema.json",
    "schemas/v3/generic-definition.v3.schema.json",
  ];
  for (const f of schemaFiles) {
    const s = JSON.parse(readFileSync(join(ROOT, f), "utf8"));
    ajv.addSchema(s);
  }

  let validated = 0;
  for (const f of jsoncFences) {
    let parsed;
    try {
      parsed = JSON.parse(stripJsoncComments(f.body));
    } catch {
      continue; // M-2 で既に detect 済
    }
    const schemaRef = parsed?.$schema;
    if (typeof schemaRef !== "string") continue;
    const filename = schemaRef.split("/").pop();
    if (!/^[a-z-]+\.v3\.schema\.json$/.test(filename)) continue;
    const $id = `https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/${filename}`;
    const validate = ajv.getSchema($id);
    if (!validate) {
      assert(`L${f.line}: schema registered (${filename})`, false, `$id not found: ${$id}`);
      continue;
    }
    const valid = validate(parsed);
    const detail = valid
      ? ""
      : (validate.errors || []).slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    assert(`L${f.line}: AJV valid against ${filename}`, valid, detail);
    validated++;
  }
  // Round 11 で reviewer が確認した 4 例 (L171/L293/L340/L468) は必ず検出される
  assert("✅ examples validated against schemas/v3/ (>= 4)", validated >= 4, `validated=${validated}`);
}

// -----------------------------------------------------------------------------
// 4-C. cheatsheet drift gate (Round 11 M-1)
//      §3.3 Step kind cheatsheet の各行が
//      `schemas/v3/process-flow.v3.schema.json` の required と整合するか検証。
//      行ごとの required field が cell に backtick で出現することを assert。
//      ExtensionStep だけは `kind` が pattern (const なし) のため特殊扱い。
// -----------------------------------------------------------------------------
console.log("\n## §3.3 cheatsheet rows vs schema required (drift gate)");
{
  const cheatsheet = parseStepCheatsheet(specDoc);
  assert("cheatsheet has 24 step kind rows", cheatsheet.size === 24, `actual=${cheatsheet.size}`);

  const BASE = new Set(["id", "kind", "description"]);
  const stepUnion = $defs.Step.oneOf.map((r) => r.$ref.replace("#/$defs/", ""));
  for (const stepName of stepUnion) {
    const def = $defs[stepName];
    if (!def?.allOf || def.allOf.length < 2) continue;
    const variant = def.allOf[1];
    const required = (variant.required || []).filter((r) => !BASE.has(r));
    const kindConst = variant.properties?.kind?.const
      ?? (stepName === "ExtensionStep" ? "extension" : null);
    if (!kindConst) continue;
    const cell = cheatsheet.get(kindConst);
    assert(`cheatsheet row exists: \`${kindConst}\``, cell !== undefined);
    if (cell === undefined) continue;

    if (stepName === "ExtensionStep") {
      // ExtensionStep は `kind` が pattern (namespace:name)、required は base のみ。
      // cell が `kind` パターン or "namespace:name" / "variant" / "pattern" に
      // 言及していることを drift 検出として要求する。
      const ok = /pattern|namespace:name|variant/i.test(cell);
      assert(`extension row mentions pattern/variant`, ok, `cell=${cell.slice(0, 100)}`);
      continue;
    }

    if (required.length === 0) {
      // 表現の揺れを許容するため、`(なし` を含むか確認
      assert(`\`${kindConst}\` row has "(なし" marker`, /\(なし/.test(cell), `cell=${cell.slice(0, 100)}`);
    } else {
      // P2-A (Round 13): cell の step-level backtick field 集合と schema required の
      // 集合一致を assert。旧実装は「required field が cell に含まれる」subset check
      // のみで、cell に stale field が混入しても catch できなかった (Codex 厳格レビュー)。
      //
      // cheatsheet 表現の convention: step-level required は cell の先頭から最初の "("
      // までに backtick 列挙、ネストレベル required は "(各 X: `subfield`...)" の括弧内
      // 説明として記載される。step-level だけを集合一致対象とする。
      const headPart = cell.split("(")[0];
      const cellFields = new Set(
        [...headPart.matchAll(/`([^`]+)`/g)].map((m) => m[1])
      );
      const requiredSet = new Set(required);
      const missing = required.filter((f) => !cellFields.has(f));
      const extra = [...cellFields].filter((f) => !requiredSet.has(f));
      assert(
        `\`${kindConst}\` row step-level backtick fields exactly match schema required`,
        missing.length === 0 && extra.length === 0,
        `missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}, headPart=${headPart.slice(0, 120)}`
      );
    }
  }
}

// -----------------------------------------------------------------------------
// 4-D. import-project-profile schema 14 セクションが spec §7.3 に列挙されているか
//      (Round 11 S-1 — TS scaffold tsc gate の代替に近い軽量 drift gate)
//      schema の top-level property を spec §7.3 enumeration と突合し、抜けが
//      無いか確認。schema 側に section が増えても spec が追従していなければ fail。
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// 4-E. §7.2 TS scaffold fence syntax gate (Round 13 P2-B)
//      Round 11 S-1 で「軽量版」と説明して TS scaffold は型チェックも syntax check
//      も無かった。typescript は devDeps 済なので、最小 syntax-only gate を入れる。
//      semantic な型解決はしない (parser-only)、import 未解決等は許容。
// -----------------------------------------------------------------------------
console.log("\n## §7.2 ts fence syntax gate (typescript parser-only)");
{
  const ts = (await import("typescript")).default;
  // topLevelOnly: 列 0 で始まる primary scaffold fence のみを対象。リスト項目内に
  // ある indented fence (参考スニペット) は対象外。
  const tsFences = extractFences(specDoc, "ts", { topLevelOnly: true });
  assert("§7.2 top-level ts fence count >= 5", tsFences.length >= 5, `actual=${tsFences.length}`);
  for (const f of tsFences) {
    const r = ts.transpileModule(f.body, {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    });
    // category 1 = Error。code < 2000 はおおむね syntactic、>= 2000 は semantic 寄り。
    // import / type 解決系 (2300-2999 等) は許容、syntactic だけを gate する。
    const syntaxErrors = (r.diagnostics || []).filter(
      (d) => d.category === 1 && d.code < 2000,
    );
    const summary = syntaxErrors
      .slice(0, 3)
      .map((d) => (typeof d.messageText === "string" ? d.messageText : d.messageText.messageText))
      .join("; ");
    assert(`L${f.line}: ts fence parses (syntax-only)`, syntaxErrors.length === 0, summary);
  }
}

console.log("\n## profile schema sections vs spec §7.3 enumeration (bidirectional)");
{
  const profileSchema = JSON.parse(readFileSync(join(ROOT, "schemas/import-project-profile.v1.schema.json"), "utf8"));
  const skipKeys = new Set(["$schema", "profileVersion", "name", "description"]);
  const schemaSections = new Set(
    Object.keys(profileSchema.properties || {}).filter((k) => !skipKeys.has(k))
  );
  // spec §7.3 から enumerated section 名を抽出 (`N. \`<name>\` — ...` 行)
  const specSections = new Set(
    [...specDoc.matchAll(/^\d+\.\s+`([a-zA-Z][a-zA-Z0-9]*)`\s+—/gm)]
      .map((m) => m[1])
      .filter((name) => !skipKeys.has(name))
  );
  assert(
    "profile schema declares >= 14 sections",
    schemaSections.size >= 14,
    `actual=${schemaSections.size}`,
  );
  // schema → spec 方向: 新 section が spec に未反映でないこと
  for (const s of schemaSections) {
    assert(`schema section \`${s}\` enumerated in spec §7.3`, specSections.has(s));
  }
  // spec → schema 方向: spec の row が stale (schema に存在しない) でないこと
  for (const s of specSections) {
    assert(`spec §7.3 entry \`${s}\` exists in schema`, schemaSections.has(s));
  }
}

// =============================================================================
// Summary
// =============================================================================
console.log();
console.log(`Pass: ${pass}, Fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
