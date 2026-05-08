/**
 * v3 Conventions builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - version: "1.0.0" (SemVer required)
 */

import type {
  Conventions,
  SemVer,
  Timestamp,
} from "../../../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildConventionsOpts {
  version?: string;
  msg?: Conventions["msg"];
  regex?: Conventions["regex"];
  numbering?: Conventions["numbering"];
  [key: string]: unknown;
}

export function buildConventions(opts: BuildConventionsOpts = {}): Conventions {
  return {
    $schema: "../../schemas/v3/conventions.v3.schema.json",
    version: (opts.version ?? "1.0.0") as unknown as SemVer,
    updatedAt: FIXED_TS,
    msg: opts.msg,
    regex: opts.regex,
    numbering: opts.numbering,
  };
}
