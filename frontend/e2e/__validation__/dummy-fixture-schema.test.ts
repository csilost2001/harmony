/**
 * #964 δ — dummy fixture v1 残骸検出 (二重ガード)。
 *
 * builder pattern を使えば構造的に v1 違反は発生しないが、人手で literal を書き戻したり
 * 新規 spec で誤って v1 形式を使うリスクへの保険として、spec / helper の TS files を
 * 静的に grep する vitest test。
 *
 * 違反検出時:
 *   1. builder 利用に書き換え (推奨)
 *   2. やむを得ず literal を残すなら known-violations.ts に明示的に追加 (デフォルト空)
 *
 * 検出対象 patterns:
 *   - `version: 1` — v1 dummyProject root marker (v3 では `schemaVersion: "v3"`)
 *   - `step.type` — step の種別キー名違い (v3 では `step.kind`)
 *   - `condition: "..."` — runIf 等の condition 短縮 (v3 では object)
 *   - `as unknown as { id: string }` — v1→v3 cast helper (γ で全削除済)
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { knownViolations } from "./known-violations";

const e2eDir = resolve(__dirname, "..");

interface Pattern {
  key: string;
  regex: RegExp;
  description: string;
}

const PATTERNS: Pattern[] = [
  {
    key: "v1-version-marker",
    regex: /\bversion:\s*1\b/,
    description: "v1 dummyProject root marker (use schemaVersion: 'v3')",
  },
  {
    key: "v1-step-type-key",
    regex: /\bstep\.type\b/,
    description: "v1 step.type key (use step.kind)",
  },
  {
    key: "v1-condition-short",
    regex: /\bcondition:\s*"[^"\n]+"/,
    description: "v1 condition string short form (use object form)",
  },
  {
    key: "v1-cast-id-string",
    regex: /as unknown as \{\s*id:\s*string\s*\}/,
    description: "v1 to v3 cast helper (removed in γ phase)",
  },
];

const SCAN_DIRS = ["", "edit-session", "helpers", "collab"];
const SCAN_EXTENSIONS = [".spec.ts", ".ts"];
const EXCLUDE_DIR_PREFIXES = ["__validation__", "__fixtures__"];

function collectFiles(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) {
    const full = dir ? join(e2eDir, dir) : e2eDir;
    const stat = statSync(full, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) continue;
    for (const f of readdirSync(full, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      if (!SCAN_EXTENSIONS.some((ext) => f.name.endsWith(ext))) continue;
      const fullPath = join(full, f.name);
      const rel = relative(e2eDir, fullPath);
      if (
        EXCLUDE_DIR_PREFIXES.some(
          (ex) => rel.startsWith(ex + "/") || rel.startsWith(ex),
        )
      )
        continue;
      out.push(fullPath);
    }
  }
  return out;
}

describe("dummy fixture v1 残骸検出 (二重ガード)", () => {
  const files = collectFiles();

  for (const pattern of PATTERNS) {
    it(`${pattern.key}: ${pattern.description}`, () => {
      const violations: string[] = [];
      for (const file of files) {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          if (pattern.regex.test(line)) {
            violations.push(`${relative(e2eDir, file)}:${idx + 1}`);
          }
        });
      }
      const allowed = new Set(knownViolations[pattern.key] ?? []);
      const unexpected = violations.filter((v) => !allowed.has(v));
      expect(
        unexpected,
        `unexpected v1 fixture pattern detected (use builder pattern from __fixtures__/builders):\n  ${unexpected.join("\n  ")}`,
      ).toEqual([]);
    });
  }

  it("known-violations entries are still violations (no stale allowlist)", () => {
    for (const [key, paths] of Object.entries(knownViolations)) {
      const pattern = PATTERNS.find((p) => p.key === key);
      if (!pattern) {
        throw new Error(`known-violations key '${key}' is not in PATTERNS`);
      }
      for (const entry of paths) {
        const colonIdx = entry.lastIndexOf(":");
        const relPath = entry.slice(0, colonIdx);
        const lineNum = Number(entry.slice(colonIdx + 1));
        const fullPath = join(e2eDir, relPath);
        const lines = readFileSync(fullPath, "utf-8").split("\n");
        const targetLine = lines[lineNum - 1] ?? "";
        expect(
          pattern.regex.test(targetLine),
          `stale known-violation: ${entry} no longer matches pattern ${key}`,
        ).toBe(true);
      }
    }
  });
});
