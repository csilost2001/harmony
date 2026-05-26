/**
 * Top-level entity の id 形式判定 utility (RFC #1284 / メタ #1292 / ISSUE #1296)
 *
 * 用途: frontend 側で URL param / localStorage に残った旧 UUID 形式 id を検出し、
 * 明示エラーへ誘導する。backend `idValidator.ts` の同名関数の frontend mirror。
 *
 * 注意:
 * - `isValidUuid` は schemas/v3/common.v3.schema.json#Uuid の pattern と完全一致させる
 *   (RFC 4122 v4 厳密形式)。backend の loose UUID とは異なり、誤検出を減らすため strict。
 *   schemas/v3/common.v3.schema.json#UuidLoose (g-z 許容、test / sample 専用、deprecated)
 *   は本 utility では検出対象外。production data に流入しない前提。
 * - `isValidEntityId` は schemas/v3/common.v3.schema.json#EntityId の pattern +
 *   minLength: 1 / maxLength: 64 と一致。本 file 単独では production 未使用だが、
 *   I-5 (UI 創成ダイアログ) / I-6 (rename refactor) で backend `isValidEntityId` と
 *   pair として利用予定のため事前 export しておく (RFC #1284 シリーズ整合)。
 */

// schemas/v3/common.v3.schema.json#Uuid と完全一致 (RFC 4122 v4 厳密)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// EntityId 排除用の loose UUID regex (a-f 始まりを含む RFC 4122 v? 形式全般を捕捉)
// backend `idValidator.ts` の UUID_RE と一致させる。strict v4 ではなく loose にする理由:
// EntityId として誤って受理してしまう可能性のある UUID 形式を網羅的に除外するため。
const UUID_LOOSE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// schemas/v3/common.v3.schema.json#EntityId と完全一致 (kebab-case 英単語)
const ENTITY_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ENTITY_ID_MAX_LENGTH = 64;

export function isValidUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

/**
 * EntityId 形式判定 (RFC #1284 / I-7 Round 2 #1299)。
 *
 * 仕様: schemas/v3/common.v3.schema.json#EntityId の pattern + minLength/maxLength と一致。
 * かつ、UUID 形式 (`f81dd9e0-794c-4539-...` 等、a-f 始まりは ENTITY_ID_RE に偶然合致するため)
 * を明示的に除外する。これは backend `idValidator.ts:isValidEntityId` と完全に対称な実装。
 *
 * Codex review (#1299 M-1) で指摘された alpha-leading UUID の誤受理 bug fix。
 */
export function isValidEntityId(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length >= 1 &&
    s.length <= ENTITY_ID_MAX_LENGTH &&
    ENTITY_ID_RE.test(s) &&
    !UUID_LOOSE_RE.test(s)
  );
}
