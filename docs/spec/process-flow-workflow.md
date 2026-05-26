# Process Flow Workflow Step

`WorkflowStep` は承認、レビュー、確認、協議など、人の判断を含む業務ワークフローを表す。
一次成果物は `schemas/v3/process-flow.v3.schema.json` であり、本仕様と TypeScript 型は同じ構造を保つ。

## フィールド

| field | required | type | description |
|---|---:|---|---|
| `id` | yes | `LocalId` | Step ID |
| `kind` | yes | `"workflow"` | Step kind 識別子 (#525 R3 fix で `type` から rename) |
| `description` | yes | string | 人間向け説明 |
| `pattern` | yes | `WorkflowPattern` | 標準 11 パターンのいずれか |
| `approvers` | yes | `WorkflowApprover[]` | RBAC role key と表示名、順序 |
| `quorum` | conditional | `{ type, n? }` | 承認成立条件。`type` の値で必須プロパティが変わる (詳細は [quorum 節](#quorum)) |
| `onApproved` | no | `Step[]` | 承認成立時に実行するサブステップ |
| `onRejected` | no | `Step[]` | 却下、拒否、差戻し時に実行するサブステップ |
| `onTimeout` | no | `Step[]` | 期限切れ時に実行するサブステップ |
| `deadlineExpression` | no | `TemplateString` | 期限式 (詳細は [process-flow-expression-language.md](process-flow-expression-language.md) §datetime 算術) |
| `escalateAfter` | conditional | string | エスカレーションまでの ISO 8601 期間。`approval-escalation` では必須 |
| `escalateTo` | conditional | `{ role?, userExpression? }` | エスカレーション先。`approval-escalation` では必須 |

`escalateTo.role` は RBAC catalog の role key (`@conv.role.<key>`) を参照する。`escalateTo.userExpression` は実行時の担当者を解決する式を保持する。

## WorkflowPattern

標準パターンは次の 11 種とする。値は JSON / TypeScript とも kebab-case で固定する。

| value | name | required fields | optional fields |
|---|---|---|---|
| `approval-sequential` | 順次承認 | `pattern`, `approvers` | `quorum`, `onApproved`, `onRejected`, `onTimeout`, `deadlineExpression`, `escalateAfter`, `escalateTo` |
| `approval-parallel` | 並列承認 | `pattern`, `approvers` | `quorum`, `onApproved`, `onRejected`, `onTimeout`, `deadlineExpression` |
| `approval-veto` | 拒否権付き承認 | `pattern`, `approvers` | `quorum`, `onApproved`, `onRejected`, `onTimeout`, `deadlineExpression` |
| `approval-quorum` | 定足数承認 | `pattern`, `approvers`, `quorum` | `onApproved`, `onRejected`, `onTimeout`, `deadlineExpression` |
| `approval-escalation` | エスカレーション承認 | `pattern`, `approvers`, `escalateAfter`, `escalateTo` | `quorum`, `onApproved`, `onRejected`, `onTimeout`, `deadlineExpression` |
| `review` | レビュー | `pattern`, `approvers` | `quorum`, `onApproved`, `onRejected`, `deadlineExpression` |
| `sign-off` | サインオフ | `pattern`, `approvers` | `onApproved`, `onRejected`, `deadlineExpression` |
| `acknowledge` | 確認 | `pattern`, `approvers` | `onApproved`, `onTimeout`, `deadlineExpression` |
| `branch-merge` | 分岐マージ | `pattern`, `approvers` | `quorum`, `onApproved`, `onRejected`, `deadlineExpression` |
| `discussion` | 協議 | `pattern`, `approvers` | `quorum`, `onApproved`, `onRejected`, `onTimeout`, `deadlineExpression` |
| `ad-hoc` | アドホック | `pattern`, `approvers`, `description` | `quorum`, `onApproved`, `onRejected`, `onTimeout`, `deadlineExpression`, `escalateAfter`, `escalateTo` |

## WorkflowApprover

```ts
interface WorkflowApprover {
  role: string;       // 必須、@conv.role.<key> 推奨
  label?: string;     // 表示名
  order?: number;     // pattern により semantics が異なる (下記参照)
}
```

### approver の `order` semantics (pattern ごと)  *#539 R5-2 で明文化*

`order` の解釈は pattern によって異なる:

| pattern | `order` の解釈 | 推奨記述 |
|---|---|---|
| `approval-sequential` | **承認の実行順序** (1, 2, 3 = 担当→課長→部長 のように昇順実行) | 1 から連番、欠番不可 |
| `approval-parallel` | **無視** (実装は全員に同時通知し並行受付) | 規約として全員 `order: 1` で揃える (意味なし、可読性のため) |
| `branch-merge` | **無視** (3 タスク並行実行 → 完了時 merge) | 同上、全員 `order: 1` 推奨 |
| `approval-quorum` | **無視** (quorum.type で成立判定) | 同上、全員 `order: 1` 推奨 |
| `approval-veto` | 通常無視 (順序関係なく拒否権発動)。実装が「先着 1 reject で打ち切り」を採用するなら順序が意味を持つが、本 spec では順序非依存とする | 全員 `order: 1` 推奨 |
| `review` / `sign-off` / `acknowledge` | 通常 1 名で構成、order は意味なし | `order: 1` 固定 |
| `approval-escalation` | エスカレーション**段階の順序** (1 = 通常承認者、2 以降は escalateTo 経由) | 通常 1 で escalateTo 側で次層を表現 |
| `discussion` | 無視 (議論順序を spec で固定しない) | 全員 `order: 1` |
| `ad-hoc` | 自由解釈 (運用が決める) | 任意 |

**実装層への影響**: TS 型 / zod refinement では、上記 semantics を JSDoc / refine() で明示する。AJV schema レベルでは `order` は `integer minimum: 1` のみで、pattern 別の意味は実装側で解釈する。

## quorum

```json
{
  "type": "all | any | majority | nOfM",
  "n": 2
}
```

`type` の意味:

- `all`: 全員の承認で成立
- `any`: いずれか 1 名の承認で成立
- `majority`: 過半数で成立
- `nOfM`: `approvers` のうち `n` 名の承認で成立 *(#525 R3 fix で `n-of-m` から rename、lowerCamelCase 統一)*

`n` は `type === "nOfM"` の場合のみ必須。

`quorum` フィールド自体は `pattern: "approval-quorum"` でのみ必須、他 pattern では optional。

## escalateTo

```json
{
  "role": "@conv.role.financeManager",
  "userExpression": "@managerOf(@employeeId)"
}
```

`role` と `userExpression` はどちらか一方だけでもよい。静的な RBAC role へ送る場合は `role`、申請内容から実行時に担当者を決める場合は `userExpression` を使う。

## Examples

### approval-sequential

```json
{
  "id": "step-manager-approval",
  "kind": "workflow",
  "description": "直属上長と部門長による順次承認",
  "pattern": "approval-sequential",
  "approvers": [
    { "role": "@conv.role.manager", "label": "直属上長", "order": 1 },
    { "role": "@conv.role.departmentHead", "label": "部門長", "order": 2 }
  ],
  "quorum": { "type": "all" },
  "deadlineExpression": "@submittedAt + duration('P2D')",
  "onApproved": [
    {
      "id": "step-approved",
      "kind": "dbAccess",
      "description": "承認済みに更新",
      "tableId": "11111111-1111-4111-8111-111111111111",
      "operation": "UPDATE",
      "sql": "UPDATE expense_requests SET status = 'approved' WHERE id = @requestId"
    }
  ],
  "onRejected": [
    {
      "id": "step-rejected",
      "kind": "dbAccess",
      "description": "却下に更新",
      "tableId": "11111111-1111-4111-8111-111111111111",
      "operation": "UPDATE",
      "sql": "UPDATE expense_requests SET status = 'rejected' WHERE id = @requestId"
    }
  ]
}
```

### approval-parallel (3 名並行承認、order は無視)

3 倉庫マネージャー (転送元 / 転送先 / コーディネーター) を全員 `order: 1` で並行宣言、deadline は workflow 全体に 1 つ。旧サンプルは削除済み — 現行 canonical サンプルは `examples/` 配下を参照。

### approval-quorum (nOfM)

```json
{
  "id": "step-committee-approval",
  "kind": "workflow",
  "description": "5 名の委員会、過半数 3 名で成立",
  "pattern": "approval-quorum",
  "approvers": [
    { "role": "@conv.role.committeeMember1", "order": 1 },
    { "role": "@conv.role.committeeMember2", "order": 1 },
    { "role": "@conv.role.committeeMember3", "order": 1 },
    { "role": "@conv.role.committeeMember4", "order": 1 },
    { "role": "@conv.role.committeeMember5", "order": 1 }
  ],
  "quorum": { "type": "nOfM", "n": 3 },
  "deadlineExpression": "@submittedAt + duration('P5D')"
}
```

### approval-escalation

```json
{
  "id": "step-escalated-approval",
  "kind": "workflow",
  "description": "期限切れ時に上位ロールへエスカレーションする承認",
  "pattern": "approval-escalation",
  "approvers": [
    { "role": "@conv.role.financeManager", "label": "経理責任者", "order": 1 }
  ],
  "quorum": { "type": "any" },
  "deadlineExpression": "@submittedAt + duration('P3D')",
  "escalateAfter": "duration('P1D')",
  "escalateTo": { "role": "@conv.role.cfo" },
  "onTimeout": [
    {
      "id": "step-timeout-log",
      "kind": "log",
      "description": "期限切れを記録",
      "level": "warn",
      "message": "approval timeout"
    }
  ]
}
```

## v3 移行ノート

v2 / v1 から v3 への命名・構造変更:

| v1/v2 | v3 |
|---|---|
| `type: "workflow"` | `kind: "workflow"` |
| step の `type: "dbAccess"` | step の `kind: "dbAccess"` |
| `tableName: "users"` | `tableId: "<EntityId>"` (RFC #1284 で kebab-case EntityId 化) |
| quorum の `type: "n-of-m"` | quorum の `type: "nOfM"` (lowerCamelCase) |

## 関連

- スキーマ: [`schemas/v3/process-flow.v3.schema.json`](../../schemas/v3/process-flow.v3.schema.json) `#/$defs/WorkflowStep`
- 式言語: [`process-flow-expression-language.md`](process-flow-expression-language.md)
- 現行 canonical サンプル: `examples/` 配下の各プロジェクトを参照。旧サンプルは削除済み — `git log` でのみ参照可。
