#!/usr/bin/env node
// Extract required fields for nested $defs referenced from Step variants.
// Source-of-truth for docs/spec/conversion-guideline-for-ai.md §3.3 cheatsheet
// (lower table + Step base common fields).
//
// Usage: node scripts/spec-check/extract-nested-required.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "../../schemas/v3/process-flow.v3.schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const $defs = schema.$defs;

const nestedDefs = [
  // Branch step nested
  "Branch", "ElseBranch", "BranchCondition",
  // validation step nested
  "ValidationRule", "ValidationInlineBranch",
  // workflow step nested
  "WorkflowApprover", "WorkflowQuorum",
  // aiCall / aiAgent
  "AiMessage", "AiMessageItem", "AiTool", "AiToolRef", "AiToolChoice", "AiResponseFormat",
  // dbAccess nested
  "AffectedRowsCheck",
  // cdc nested
  "CdcDestination",
  // step base
  "OutputBinding",
];

console.log("Nested object required fields:");
console.log();
for (const name of nestedDefs) {
  const def = $defs[name];
  if (!def) {
    console.log(`- ${name}: (not found in $defs — schema 側になし)`);
    continue;
  }
  if (def.oneOf) {
    console.log(`- ${name} (oneOf, ${def.oneOf.length} variants):`);
    def.oneOf.forEach((variant, i) => {
      const req = variant.required || [];
      console.log(`    variant ${i}: required = [${req.join(", ")}]`);
    });
  } else {
    const req = def.required || [];
    console.log(`- ${name}: required = [${req.join(", ")}]`);
  }
}
