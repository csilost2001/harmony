# edit-session-protocol — 協調編集の正規プロトコル

> **位置付け**: 既存 [`collab-presence.md`](./collab-presence.md) (#876 / RFC #855 派生) の **発展的後継**。
> 既存 spec の概念 (Direction B / Forward-Compat 4 原則 / lock + draft + presence の 3 層) を、**EditSession という単一の一級概念** に統一して再定義する。
>
> **背景**: PR #888 でマージされた現実装 (lockManager / draftStore / presenceManager の 3 層モデル) は、**Direction B のメインユースケース「A が編集中に B を呼んで閲覧してもらう」が破綻している**。原因は memory の隔離単位を session 単位にしてしまったため、後から接続した別 session が editor の最新 state を取得できないこと。本 spec はこの根本欠陥を解消する正規プロトコルを定義する。
>
> **状態**: 設計確定済 (2026-05-07 議論で Q1-Q4 合意)。実装は新シリーズ ISSUE で順次対応。

---

## 目次

1. [概要 / 動機](#1-概要--動機)
2. [用語定義](#2-用語定義)
3. [EditSession の概念](#3-editsession-の概念)
4. [ライフサイクル状態](#4-ライフサイクル状態)
5. [状態遷移 (1-6 step)](#5-状態遷移-1-6-step)
6. [participant と role](#6-participant-と-role)
7. [take-over の atomic 仕様](#7-take-over-の-atomic-仕様)
8. [save 規則](#8-save-規則)
9. [複数 EditSession の並存と衝突解決](#9-複数-editsession-の並存と衝突解決)
10. [AI participant 仕様](#10-ai-participant-仕様)
11. [URL とブックマーク](#11-url-とブックマーク)
12. [TTL と自動削除](#12-ttl-と自動削除)
13. [memory store と永続化](#13-memory-store-と永続化)
14. [broadcast プロトコル](#14-broadcast-プロトコル)
15. [API シグネチャ](#15-api-シグネチャ)
16. [既存 spec との関係](#16-既存-spec-との関係)
17. [Direction A (CRDT) への移行可能性](#17-direction-a-crdt-への移行可能性)
18. [受け入れ基準 / セキュリティ考慮事項](#18-受け入れ基準--セキュリティ考慮事項)
19. [改訂履歴](#19-改訂履歴)

---

## 1. 概要 / 動機

### 1.1 既存実装の根本欠陥 (PR #888 で発覚)

PR #888 でマージされた協調編集実装は、編集中の draft を **session 単位 (`${clientId}:${type}:${id}`)** で in-memory shadow store に保持する。これにより:

- editor が編集 → 自分の shadow に書く + broadcast
- 同時接続中の viewer は broadcast 経由で受信 ✓
- **後から接続した viewer は shadow にアクセスできず、broadcast もリプレイされないため、編集中の最新 state を取得できない ✗**

具体ユースケース:
1. ユーザ A が編集開始
2. 問題があるのでユーザ B に連絡し、閲覧してもらう
3. **ユーザ B が接続した時点で破綻する**: B は FS に書かれた古い state しか見えない (initial FS write 直後の編集はメモリにしかない、broadcast はリプレイされない)

これは Direction B のメインユースケースであり、現実装の根本欠陥である。

### 1.2 解決方針 — プロトコル化

memory の隔離単位を **「session 単位」から「編集セッション単位 (EditSession)」** に変更する。EditSession は以下の特性を持つ:

- 1 つの編集トランザクション全体を 1 つの一級概念として表現
- 識別子 (`editSessionId`) は session 横断、複数 participant が共有
- take-over (編集権譲渡) で `editSessionId` は維持 → memory が新 owner に引き継がれる
- 別 session が attach した瞬間に `editSessionId` 経由で memory を直接読める

これにより「lock + draft + presence の 3 層」を **「EditSession + role + audit」の 1 層** に統一する。

### 1.3 概念モデルの転倒

| 観点 | PR #888 (現実装) | 本 spec (新プロトコル) |
|---|---|---|
| 一級概念 | lock / draft / presence (3 つ) | EditSession (1 つ) |
| memory 隔離単位 | session (clientId) | editSessionId |
| take-over 時 | session 切替 (transferDraft で key rename) | editSessionId 維持 (rename 不要) |
| 別 session 閲覧 | broadcast 経由のみ (= 接続前の編集は取れない) | editSessionId 経由で memory 直接読める |
| 複数 active 並存 | 不可 (1 lock = 1 編集) | 可 (1 リソース = 複数 EditSession 並存可能) |
| 概念の自然さ | 実装都合の隔離 | 1 編集 = 1 トランザクション = 1 EditSession |

---

## 2. 用語定義

| 用語 | 意味 |
|---|---|
| **EditSession** | 特定リソースに対する協調編集の作業空間。1 編集トランザクション全体を表現する一級概念。identifier `editSessionId` で参照される。 |
| **editSessionId** | EditSession の identifier。lock の lifecycle と一致する識別子。`acquire` 時に発番、`transferLock` 時は維持、`release` / `discardDraft` / `commitDraft` 時に消滅。 |
| **participant** | EditSession に参加している session (人間 / AI 共通)。`Edit` または `View` の role を持つ。 |
| **role** | participant の役割。`Edit` (lock holder、書込み権) または `View` (read-only follower)。 |
| **take-over** | 別 participant の `View` から `Edit` への昇格 + 既存 editor の `Edit` から `View` への降格を atomic に行う操作。 |
| **save** | EditSession の現時点 payload を本体ファイル (committed state) に書き込む操作。session lifecycle と独立、複数回実行可能。 |
| **delete** | EditSession の完全終了。memory + 履歴 FS から削除される。TTL 経過 or 明示操作のみで発火。 |
| **AI participant** | AI session が EditSession に参加する場合の特殊な participant。`parentHumanSessionId` で「誰が指示した AI か」を保持。表示は `Alice@AI` 形式。 |
| **memory store** | active な EditSession の最新 payload を保持する in-memory store。`Map<editSessionId, EditSessionState>`。 |
| **history FS** | Saved / Released 後の EditSession を保持する file system。`data/.edit-sessions/<editSessionId>.json` に格納、TTL 経過で削除。 |
| **opaque envelope** | mid-edit broadcast の payload を非構造化 (server が解釈しない) として扱う規約 (collab-presence.md § 7 から継承)。 |

---

## 3. EditSession の概念

### 3.1 1 つの編集 = 1 つの EditSession

ユーザー A が「編集開始」ボタンを押した瞬間、新しい EditSession が生成され `editSessionId` が発番される。この EditSession は:

- 同一リソースに対する 1 つの編集トランザクション全体を表現
- 複数の participant (人間 / AI) が join できる
- `Edit` role は 1 EditSession に最大 1 名 (= 同時編集はしない、Direction B の制約)
- `View` role は複数可
- save / take-over を session lifecycle 内で複数回実行可能
- 終了は明示 delete または TTL 経過のみ

### 3.2 EditSession の構造

```ts
interface EditSession {
  id: string;                          // editSessionId (ULID-like、acquire 時発番)
  resourceType: DraftResourceType;
  resourceId: string;
  state: "Active" | "Saved" | "Discarded";   // lifecycle 状態
  participants: Map<sessionId, ParticipantInfo>;  // role を持つ session の集合
  payload: unknown;                     // 編集中の最新 state (in-memory 真実点)
  sequence: number;                     // monotonic counter (broadcast の reorder 検出用)
  createdAt: string;                    // ISO 8601
  expiresAt: string;                    // 自動削除予定日時 (createdAt + TTL)
  saveHistory: SaveEvent[];             // 各 save 操作の audit log
}

interface ParticipantInfo {
  sessionId: string;
  role: "Edit" | "View";
  joinedAt: string;
  lastActivityAt: string;
  parentHumanSessionId?: string;        // AI participant の場合のみ (誰が指示した AI か)
  displayLabel: string;                 // "@alice" / "Alice@AI" 等
}

interface SaveEvent {
  savedBy: string;                      // sessionId (audit 必須)
  savedAt: string;
  sequence: number;                     // save 時の payload sequence
}
```

### 3.3 識別の決定性

`editSessionId` は ULID-like (時刻順序保証 + ランダム性) を採用。理由:

- 同一リソースに複数 EditSession 並存時、UI 一覧で時系列順表示が容易
- URL `?session=<editSessionId>` で参加可能 (§ 11 参照)、推測攻撃に対する一定の耐性
- DB / FS の sort 索引と整合

---

## 4. ライフサイクル状態

EditSession は 3 つの **state** を持つ:

| state | 意味 | 操作可能性 |
|---|---|---|
| **Active** | 編集中。participant が join / leave / edit / save 可能 | 全操作可 |
| **Saved** | 最新 save 後の確定状態 (注: Saved は active の sub-state、edit 継続可) | 全操作可 (実質 Active と同等、UI 表示で区別) |
| **Discarded** | 明示的に「破棄」操作されたか、TTL 経過で削除候補となった | 履歴閲覧のみ可、再開不可 |

**重要**: PR #888 や Word の「保存」とは異なり、save は session 終了ではない。save 後も Active 状態が継続し、複数回 save 可能 (Q2 合意)。

### 4.1 state 遷移図

```
                     ┌──────────────────────────────┐
                     ▼                              │
[新規作成] ──→ Active ──→ (save) ──→ Active ───────┘
                │            (Saved sub-state、続けて編集可)
                │
                ├──→ (明示 discard) ──→ Discarded ──→ (TTL 経過) ──→ [Deleted]
                │
                └──→ (TTL 経過) ──→ Discarded ──→ (さらに TTL 経過) ──→ [Deleted]
```

注: TTL は **2 段階**:
- 1 段階目: Active の lastActivityAt から TTL 経過 → Discarded に遷移 (履歴として残る、復元可能)
- 2 段階目: Discarded から N 日経過 → 完全削除

---

## 5. 状態遷移 (1-6 step)

ご提案の 1-6 step を正規化:

| Step | 操作 | EditSession 状態の変化 |
|---|---|---|
| **1** | A が編集開始 | EditSession 新規作成、participants = `{ A: Edit }`、state = Active |
| **2** | B が閲覧開始 (attach) | participants += `{ B: View }`、state 不変 |
| **3** | B が編集取得 (take-over) | **atomic**: A.role: Edit → View、B.role: View → Edit (順序: View 先 / Edit 後)、editSessionId 不変、payload 不変 |
| **4** | B が編集終了 (release) | B.role: Edit → View、participants = `{ A: View, B: View }` (= editor 不在状態) |
| **5** | 誰かが save | payload を本体ファイルに書く、saveHistory に追加、state 不変 (Active 継続) |
| **6** | 7 日経過 / 明示 delete | EditSession 完全終了、memory + history FS から削除 |

### 5.1 step 4 の意味 (Q1 合意)

「編集終了」は **「Edit role を放棄、View に降格」** を意味する (B は依然 participant、attach 状態を維持)。完全離脱 (detach) は別操作。

### 5.2 step 5 の save 権限 (Q1 案 1 採用)

- **Edit role の participant がいる場合**: その participant のみ save 可能
- **全員 View の場合 (= editor 不在)**: View の誰でも save 可能 (合意の上、誰かが代表で save する)

理由: Edit がいる時に View が save すると Edit の最新変更を確定する奇妙な動きになる。Edit がいない時は責任主体が分散しているので誰でも OK。

### 5.3 step 5 の audit log (Q1 必須)

各 save は `SaveEvent { savedBy, savedAt, sequence }` を `saveHistory` に追加。後から「この変更は誰が確定したか」を遡れる。

---

## 6. participant と role

### 6.1 role の状態遷移

```
[新規 join]
    ▲
    │ (initial role 決定)
    │
    ├──→ View ←──── Edit ←─── (take-over to other) ←──── Edit
    │     │           ▲
    │     │           │ (take-over)
    │     ▼           │
    │   detach (leave EditSession)
    │
    └──→ Edit (= EditSession 創設時の最初の participant)
```

### 6.2 role transition の規則

| 遷移 | 条件 | 効果 |
|---|---|---|
| `[新規 join] → Edit` | EditSession 新規作成時の発起人のみ | initial editor |
| `[新規 join] → View` | 既存 EditSession に attach 時 | viewer として参加 |
| `View → Edit` | take-over の **昇格部分** (§ 7 参照) | 必ず `Edit → View` の降格と atomic に発生 |
| `Edit → View` | take-over の **降格部分** / 自発的 release (step 4) | role 変更のみ、participants は維持 |
| `View → detach` | participant が EditSession を離脱 | participants から削除、EditSession lifecycle は不変 |
| `Edit → detach` | editor が直接離脱する場合 | **禁止または release を強制**: editor は必ず先に View に降格してから detach |

### 6.3 1 EditSession 内の role 分布制約

- `Edit` role: 0 または 1 (= 同時編集はしない、Direction B の制約)
- `View` role: 0 以上 (上限なし)
- `Edit = 0` の状態 (= editor 不在) は許容される (step 4 後の状態)

---

## 7. take-over の atomic 仕様

### 7.1 atomicity の要請 (Q3 step 3 合意)

ご提案文面: **「View が先で Edit はそのあと」**

これは take-over 操作の atomic 性を意味する:

```
前提: B は既に View 状態 (= step 2 を経由している)、A は現在 Edit

[atomic transaction begin]
  1. A.role: Edit → View    (lock 降格)
  2. B.role: View → Edit    (lock 昇格)
  注: 1 と 2 は server 側で同一 critical section 内で実行
[atomic transaction end]
```

### 7.2 take-over の前提条件

- B は **必ず View 状態を経由** していること (= step 2 を経由)
- B が View なしに直接 Edit を奪う操作 (= 「強制取得」) は **禁止**
- 理由: View 経由 = 連絡を取って合意してから昇格、というプロトコルを保証する

### 7.3 server 側実装の要件

`lockManager.transferLock(fromSessionId, toSessionId, resourceType, resourceId)` の前提:

1. `toSessionId` が `View` participant として既に登録されていること (= 連絡を取った証拠)
2. 同一 mutex / critical section 内で role 変更を実行
3. broadcast `lock.changed` op:`transferred` で全 participant に通知

### 7.4 AI participant の take-over

AI も人間と同じプロトコル (Q4 合意)。alice が AI に編集を任せる流れ:

1. alice が AI を呼ぶ → AI が EditSession に View で join
2. alice が take-over で AI に Edit を渡す → AI が編集
3. AI が編集終了 → take-over で alice に Edit を返す or AI が自発的に Edit → View 降格

`onBehalfOfSession` の概念は **保持** (§ 10 参照)、ただし簡素化: AI session に `parentHumanSessionId` を持たせて責任追跡のみに限定、actor / owner の複雑な区別は不要。

---

## 8. save 規則

### 8.1 save の権限 (Q1 案 1 合意、§ 5.2 参照)

- Edit role の participant がいる時: その人のみ save 可能
- 全員 View (editor 不在) の時: 誰でも save 可能

### 8.2 audit log (Q1 必須、§ 5.3 参照)

各 save は `SaveEvent` を `EditSession.saveHistory` に追加。

### 8.3 save の効果

1. EditSession.payload を本体ファイル (`<resourceRoot>/<id>.json`) に atomic write
2. EditSession 自体は **削除しない** (Active 状態のまま、続けて編集可)
3. broadcast `editSession.saved` event で全 participant に通知
4. 関連 ListView / dashboard の表示更新

### 8.4 save と delete の独立性 (Q2 合意)

save は session lifecycle と独立。session 削除は **TTL 経過 / 明示 delete のみ**。

---

## 9. 複数 EditSession の並存と衝突解決

### 9.1 複数 active 並存の許容 (Q3 合意)

同一リソースに対し、**同時に複数の EditSession が active** であることを許容する。理由:

- 業務的有用性: 2 人が同じ機能の別案 (A 案 / B 案) を独立に作成、後から比較して採用
- 過去 EditSession (Discarded / Saved 履歴) も同時に保持可能

### 9.2 lock 概念の変更

| 観点 | 旧モデル (PR #888) | 新モデル (本 spec) |
|---|---|---|
| lock の単位 | リソース (1 resourceId = 1 lock) | EditSession (1 editSessionId = 1 lock) |
| 同時 active | 1 リソースに 1 lock のみ | 1 リソースに複数 EditSession 並存可 |
| 1 EditSession 内 | — | editor は 1 名のみ (Direction B 制約) |

### 9.3 衝突解決 — save 時のチェック (Q3 合意)

複数 active EditSession のいずれかが save する時:

```
A が EditSession-1 で save をクリック
   ↓
server: 本体ファイルの最終 save 時刻を確認
   ↓ (他の EditSession が後で save していた場合)
警告ダイアログ:
  「他の編集セッション (EditSession-2 by @bob, 5 分前 save) で本体ファイルが
   更新されています。今回の save で上書きしますか?」
   [上書きする] [キャンセル] [マージ確認 (Phase 2)]
   ↓
A が「上書きする」 → save 続行 (last-save-wins)
A が「キャンセル」 → save 中止、UI で diff 表示 (任意)
```

Phase 1 では `last-save-wins + 警告 UI`、Phase 2 で `merge` を別 ISSUE で検討。

### 9.4 UI 表示 (Q3 合意)

リソース一覧画面で:
- リソース行に「同時 active EditSession 件数」をバッジ表示 (`📝 3` 等)
- クリックで全 EditSession 一覧モーダル表示
- URL `/process-flow/edit/<id>?session=<editSessionId>` で個別 EditSession にアクセス

URL 経由で参加できることで、チャットツール (Slack 等) に URL を貼り付けて他者を招待する運用が可能 (Q3 メリット明記)。

---

## 10. AI participant 仕様

### 10.1 AI session の独立性 (Q4 合意)

AI も人間と同じ protocol で動作:

- AI 接続時に独立した sessionId が発番される (現状の MCP 接続パターン)
- AI は EditSession に participant として join できる
- role transition (Edit / View / take-over) は人間と完全に同じ規則に従う

### 10.2 責任追跡 — `parentHumanSessionId`

ユーザー指摘 (Q4): **「AI にプロンプトを与えた人に責任がある」**

AI session は以下のフィールドを保持:

```ts
interface AIParticipantInfo extends ParticipantInfo {
  sessionId: "ai-xyz-...";                // AI 自身の独立 ID
  parentHumanSessionId: "alice-...";      // 誰が指示した AI か
  displayLabel: "Alice@AI";               // 表示形式 (Q4 (ii) 採用)
}
```

### 10.3 表示形式 — `Alice@AI` (Q4 (ii) 採用)

- 識別子の構造: `<parentHumanLabel>@AI`
- URL safe (`@` は URL 安全文字)
- audit log で `savedBy: "Alice@AI"` の形式
- UI 表示で「誰が指示した AI か」が即座に分かる

### 10.4 自動削除対象外 (Q4 合意、§ 12 参照)

AI が Edit role の場合も自動削除対象外。詳細は § 12.2。

### 10.5 `onBehalfOfSession` 概念の扱い

**保持するが簡素化** (Q4 合意):

| 既存 (PR #888) | 本 spec |
|---|---|
| `actor` / `owner` の複雑な区別 | EditSession プロトコルに統合 (role + parentHumanSessionId) |
| `resolveOnBehalfOfSession` で borrow 関係を解決 | AI session 接続時に `parentHumanSessionId` を渡す簡素化 |
| AI session-borrow registry (#892) | **不要** (本プロトコルで代替) |

→ #892 は本プロトコル化に統合し、別 ISSUE としては不要。

---

## 11. URL とブックマーク

### 11.1 URL 構造

| パス | 意味 |
|---|---|
| `/process-flow/edit/<resourceId>` | 既定 EditSession (= 最新 active EditSession) を開く。無ければ新規作成 |
| `/process-flow/edit/<resourceId>?session=<editSessionId>` | 指定 EditSession に参加 (View で join) |
| `/process-flow/edit/<resourceId>/sessions` | 同一リソースの全 EditSession 一覧 (active + history) |

同様の URL 構造を Table / ViewDefinition / ScreenItems / Sequence / Designer (画面 GrapesJS / Puck) でも採用。

### 11.2 URL からの join (Q3 メリット)

チャット (Slack 等) に `https://harmony.example/process-flow/edit/abc?session=es01HX...` を貼り付けて、他者を View role で招待できる:

1. 貼り付けた URL を相手がクリック
2. ブラウザで開いた瞬間、`?session=` パラメータを解釈
3. `mcpBridge.request("editSession.attachAsView", { editSessionId })` 実行
4. View role で participants に追加
5. 即座に最新 payload を取得して表示 (memory store から、§ 13 参照)

### 11.3 URL のセキュリティ

- 現状の認証層 (workspace に attach できれば全リソース閲覧可) を超える分離は行わない (内製ツール前提)
- `editSessionId` は ULID-like で長く、推測攻撃に一定の耐性
- URL を貼られた相手は「workspace に access 権がある」前提

---

## 12. TTL と自動削除

### 12.1 TTL 設定 (Q2 合意、harmony.json で指定)

`harmony.json` (workspace 設定ファイル) に追加:

```json
{
  "editSession": {
    "ttlDays": 7,
    "discardedRetentionDays": 30
  }
}
```

| 設定 | デフォルト | 意味 |
|---|---|---|
| `editSession.ttlDays` | 7 | Active からの最終操作経過時間 (これを超えると Discarded に自動遷移) |
| `editSession.discardedRetentionDays` | 30 | Discarded からの追加保持期間 (これを超えると完全削除) |

### 12.2 自動削除規則 (Q4 合意)

EditSession 単位で判定:

| 条件 | 自動削除 |
|---|---|
| Edit role の participant が 1 人でも存在 (人間 / AI 問わず) | **対象外** (削除しない) |
| 全員 View 状態 + EditSession.lastActivityAt から `ttlDays` 経過 | Active → Discarded に遷移 |
| Discarded 状態 + 最終遷移から `discardedRetentionDays` 経過 | 完全削除 |

理由 (Q4): Edit している人 (人間 / AI) を自動的に消すのは危険。横取り (take-over) で他者が強制 release する経路があるため、AI hang や放置 editor は人間の操作で解決可能。

### 12.3 Activity taxonomy との関係

既存 Activity taxonomy (live / active / idle / stale / abandoned) は **個別 participant の状態** を表現する。

自動削除判断は **EditSession 全体の状態** を見る。両者は独立した軸:

| 軸 | 主体 | 用途 |
|---|---|---|
| Activity taxonomy | participant | UI 表示 (presence badge / dropdown) |
| 自動削除判断 | EditSession | TTL 評価 / cleanup 周期 |

### 12.4 cleanup の実行

- 1 時間に 1 回の `setInterval` で `cleanupExpiredEditSessions()` 実行 (現実装の `cleanupAbandoned` を発展)
- Active → Discarded への遷移 + Discarded → 完全削除 の 2 段階を同関数で処理
- 削除した EditSession を `editSession.changed` op:`expired` で broadcast

### 12.5 明示 delete UX

- EditSessionDropdown または一覧画面のコンテキストメニューから「この編集セッションを削除」操作可
- confirm dialog で「本当に削除しますか? 復元不能です」
- delete 実行 → state: Discarded → broadcast

---

## 13. memory store と永続化

### 13.1 隔離単位の根本変更

| 旧モデル (PR #888) | 本 spec |
|---|---|
| `${clientId}:${type}:${id}` で隔離 | `${editSessionId}` で隔離 |
| session 単位 | EditSession 単位 |
| take-over 時に key rename 必要 | 不要 (editSessionId 維持) |
| 別 session が直接読めない | 別 session が editSessionId 経由で直接読める |

### 13.2 EditSessionStore 構造

```ts
class EditSessionStore {
  private store = new Map<string, EditSession>();   // key = editSessionId

  // lifecycle
  create(actorSessionId, resourceType, resourceId, displayLabel): EditSession;
  get(editSessionId): EditSession | null;
  delete(editSessionId): void;

  // participant 管理
  attachAsView(editSessionId, sessionId, displayLabel, parentHumanSessionId?): ParticipantInfo;
  detach(editSessionId, sessionId): void;
  setRole(editSessionId, sessionId, role: "Edit" | "View"): void;

  // edit
  update(editSessionId, payload, byEditorSessionId): { sequence: number };  // payload を更新、broadcast 発火
  fetchCurrentPayload(editSessionId): { payload, sequence } | null;          // 別 session の attach 時に呼ぶ

  // save
  save(editSessionId, bySessionId): SaveEvent;

  // take-over (atomic)
  transferEdit(fromSessionId, toSessionId, editSessionId): { from, to };

  // cleanup
  cleanupExpired(now: Date, ttlDays: number, retentionDays: number): EditSession[];
}
```

### 13.3 attach 時の initial fetch (根本欠陥の解消)

別 session が attach する流れ (= § 1.1 の根本欠陥を解消する経路):

```
1. user clicks "閲覧開始" (or URL ?session=<id> でロード)
2. frontend: mcpBridge.request("editSession.attachAsView", { editSessionId })
3. server: editSessionStore.attachAsView(editSessionId, sessionId)
4. server: fetchCurrentPayload(editSessionId) → payload + sequence を取得
5. server: response { participantInfo, payload, sequence }
6. frontend: payload を即座に表示 (broadcast 待ちでない)
7. frontend: その後 broadcast `editSession.update` で追従
```

**これにより「後から接続した viewer」も最新 state を即座に取得できる**。

### 13.4 永続化戦略 (B.5 議論への決着)

PR #888 で議論した B.5 (案 2 / 案 3 のどちらか) は本 spec で **決着がつく**:

| 永続化対象 | タイミング | 場所 |
|---|---|---|
| EditSession 自体 (active) | acquire 時 | in-memory `EditSessionStore` のみ |
| EditSession 自体 (history) | save 時 + Discarded 遷移時 | FS `data/.edit-sessions/<editSessionId>.json` |
| 中間 payload (mid-edit) | update 毎 | in-memory `EditSession.payload` のみ (FS write しない) |
| save の payload | save 操作時 | 本体ファイル + EditSession.saveHistory |

**FS 即時書き込みは不要**: 別 session が attach した時に memory から fetch できるため、「初回 FS 書き込みで cross-session 互換」が必要だった理由が消失する。

→ B.5 は **案 2 (snapshot only) に純粋化** が可能になる。理由は本プロトコルが提供する「memory 共有」によって、PR #888 で必要だった「初回 FS 即時書き込み」の保守判断が不要になるため。

### 13.5 backend crash 耐性

Active EditSession の中間状態は in-memory のみ。crash 時:

- 中間状態は失われる (= save していない部分は消える)
- これは PR #888 と同等の挙動 (PR #888 でも shadow store のみ in-memory)
- 改善の余地: WS 切断検出時に明示 flush、定期的な snapshot を JSON dump 等

→ Phase 2 以降の最適化対象。Phase 1 では crash 時消失を許容。

---

## 14. broadcast プロトコル

既存 `collab-presence.md` § 7 (Opaque envelope) を継承し、event 名を整理:

### 14.1 EditSession 関連 event

| event | 発火タイミング | data |
|---|---|---|
| `editSession.created` | 新規 EditSession 作成 | `{ editSession: EditSession }` |
| `editSession.attached` | participant が join | `{ editSessionId, participant }` |
| `editSession.detached` | participant が離脱 | `{ editSessionId, sessionId }` |
| `editSession.roleChanged` | role 遷移 (take-over 含む) | `{ editSessionId, sessionId, oldRole, newRole, transferTo? }` |
| `editSession.update` | mid-edit (payload 更新) | `{ editSessionId, sequence, payload, senderSessionId }` (opaque) |
| `editSession.saved` | save 操作 | `{ editSessionId, savedBy, savedAt, sequence }` |
| `editSession.discarded` | Discarded 遷移 | `{ editSessionId, reason: "manual" \| "ttl" }` |
| `editSession.expired` | 完全削除 | `{ editSessionId }` |
| `presence.update` | activity taxonomy 遷移 | (既存 collab-presence.md と同じ) |

### 14.2 旧 event との対応

| 旧 event (PR #888) | 新 event |
|---|---|
| `lock.changed` op:`acquired` | `editSession.created` (initial Edit participant 含む) |
| `lock.changed` op:`released` | `editSession.roleChanged` (Edit → View) |
| `lock.changed` op:`transferred` | `editSession.roleChanged` (transferTo 付き、atomic) |
| `lock.changed` op:`force-released` | `editSession.detached` (forced=true) |
| `draft.changed` op:`updated` | (削除、`editSession.update` に統合) |
| `draft.changed` op:`committed` | `editSession.saved` |
| `draft.changed` op:`discarded` | `editSession.discarded` |
| `draft-update` (opaque) | `editSession.update` (本 spec の opaque envelope) |

### 14.3 broadcast の wsId scoping

既存 wsBridge の `wsId` scoping (workspace 単位) は維持。同一 workspace の全 client にのみ broadcast される。

---

## 15. API シグネチャ

### 15.1 backend (新規 / 変更)

#### `backend/src/editSessionStore.ts` (新規)

§ 13.2 のクラス定義参照。

#### `backend/src/wsBridge.ts` request handler (新規)

```ts
// 新 request
"editSession.create" — params: { resourceType, resourceId } → EditSession
"editSession.attachAsView" — params: { editSessionId } → { participant, payload, sequence }
"editSession.detach" — params: { editSessionId } → void
"editSession.setRole" — params: { editSessionId, role: "Edit" | "View" } → ParticipantInfo
"editSession.transferEdit" — params: { editSessionId, toSessionId } → { from, to }
"editSession.update" — params: { editSessionId, payload } → { sequence }
"editSession.save" — params: { editSessionId } → SaveEvent
"editSession.discard" — params: { editSessionId } → void
"editSession.list" — params: { resourceType, resourceId } → EditSession[]
"editSession.fetchPayload" — params: { editSessionId } → { payload, sequence }
```

#### 既存 API の扱い (互換性 / 撤去)

| 既存 API (PR #888) | 本 spec での扱い |
|---|---|
| `lock.acquire` | 削除 (`editSession.create` に統合) |
| `lock.release` | 削除 (`editSession.setRole(View)` に統合) |
| `lock.forceRelease` | 残置 (緊急 detach として、editSession.detach forced=true 経路) |
| `lock.subscribeAsViewer` | 削除 (`editSession.attachAsView` に統合) |
| `lock.unsubscribeViewer` | 削除 (`editSession.detach` に統合) |
| `lock.transferLock` | 削除 (`editSession.transferEdit` に統合) |
| `lock.list` | 削除 (`editSession.list` に統合) |
| `draft.update` | 削除 (`editSession.update` に統合) |
| `draft.commit` | 削除 (`editSession.save` に統合) |
| `draft.discard` | 削除 (`editSession.discard` に統合) |
| `draft.read` / `draft.readLatest` | 削除 (`editSession.fetchPayload` に統合) |
| `presence.heartbeat` / `presence.list` / `presence.register` | 維持 (independent channel、§ 14.1 参照) |

### 15.2 frontend (新規 / 変更)

#### `frontend/src/hooks/useEditSession.ts` (大幅改訂)

```ts
interface UseEditSessionOptions {
  resourceType: DraftResourceType;
  resourceId: string;
  editSessionId?: string;  // URL ?session= から復元時 / 新規作成時は undefined
}

interface UseEditSessionResult {
  editSession: EditSession | null;
  myRole: "Edit" | "View" | null;  // 自分の現在 role
  participants: ParticipantInfo[];
  payload: unknown;
  startEditing(): Promise<void>;     // 新規 EditSession 作成 + Edit role
  attach(editSessionId): Promise<void>;  // 既存 EditSession に View で join
  takeOver(): Promise<void>;          // View → Edit (atomic、prevEditor は View に降格)
  releaseEdit(): Promise<void>;       // Edit → View
  save(): Promise<void>;
  discard(): Promise<void>;
  detach(): Promise<void>;
}
```

#### 関連 hooks

- `usePresenceHeartbeat` — 維持 (presence channel 独立)
- `usePresenceRegistry` — 維持 (participant の activity 状態を見る用途)
- `useResourceEditor` — 内部実装を `useEditSession` ベースに改訂、外部 API は互換維持を推奨

#### UI components (改訂)

- `EditSessionDropdown.tsx` — `editSession.list` 経由で全 active EditSession + 過去履歴を表示
- `SessionBadge.tsx` / `PresenceBadge.tsx` — そのまま継続
- `TransferNotificationBanner.tsx` — `editSession.roleChanged` event listen に変更

---

## 16. 既存 spec との関係

### 16.1 `collab-presence.md` (#876)

**位置付け**: 本 spec の overture (序章) として残し、本 spec が正規プロトコルを担う。

`collab-presence.md` で書かれた以下は **継続有効**:
- Direction B 採用根拠 (§ 2)
- Forward-Compat 4 原則 (§ 3) — ただし原則 ④ の解釈は本 spec で純粋化される (§ 13.4)
- Activity taxonomy (§ 9)
- AI 借受の方針 (§ 10) — ただし簡素化 (§ 10.5)

`collab-presence.md` の以下は **本 spec で置き換え**:
- § 4 アーキテクチャ (lockManager / draftStore / presenceManager の 3 層) → § 3 EditSession 一級概念
- § 5 lock 状態遷移 → § 5 / § 6 EditSession ライフサイクル + role
- § 7 opaque envelope → § 14 broadcast プロトコル
- § 8 Take-over フロー → § 7 take-over の atomic 仕様

### 16.2 `edit-session-draft.md` (#683)

**位置付け**: 旧モデル (lock + draft + onBehalfOfSession の 3 層) の正規仕様。本 spec で **置き換え**。

D-1 ~ D-12 の設計判断は以下の扱い:
- D-1 (autosave 廃止) — 維持 (本 spec も明示保存式)
- D-2 (サーバ側 draft 管理) — 概念は維持、実装は本 spec で再設計
- D-3 ~ D-7 (lock 関連) — 本 spec の EditSession + role に置き換え
- D-8 ~ D-12 — 個別に本 spec で言及 / 統合

### 16.3 `workspace-multi.md` (#679)

**位置付け**: 別軸 (複数 workspace の同時並行編集)、本 spec と独立。衝突なし。

### 16.4 `multi-editor-puck.md` (#806)

**位置付け**: editorKind / cssFramework の解決順序、本 spec と独立。

### 16.5 `draft-state-policy.md`

**位置付け**: 業務リソースの maturity (draft / committed) policy。本 spec の draft (= edit session の payload) とは別軸 (本 spec では「edit-session payload」と呼ぶことで用語衝突を回避)。

---

## 17. Direction A (CRDT) への移行可能性

### 17.1 現状の判断 (Q3 (a) 合意)

ユーザー本来の要望: **「複数人同時 Edit (CRDT 風、Google Docs / Notion)」**

これは Direction A (Loro CRDT 採用) に相当し、#855 で 8-12 週見積もり / schema-first 思想と衝突する不採用根拠で見送り。**本 spec では未採用**、将来再評価の余地として残す。

### 17.2 本 spec から Direction A への移行コスト

`collab-presence.md` § 3 の Forward-Compat 4 原則を本 spec も継承するため、Direction A 移行コストは引き続き **8-12 週 → 5-8 週** に低減される設計を維持:

| 原則 | 本 spec での実装 | A 移行時 |
|---|---|---|
| ① opaque envelope | § 14 broadcast プロトコルで継続 | payload を Loro update binary に swap、envelope 不変 |
| ② lock 2 層化 | EditSession の `Edit` role が UI hint として機能 | サーバ強制を撤去、UI hint のみ残す |
| ③ presence 独立 | § 12.3 で presence channel 維持 | そのまま流用 |
| ④ snapshot only | § 13.4 で純粋化 | そのまま流用 |

### 17.3 Direction A 移行時の追加変更

- 1 EditSession 内で `Edit` role を **複数許容** (= CRDT による同時編集)
- payload を JSON から Loro doc に置換
- 同時編集の衝突解決 (LWW) と schema validator の関係を再設計
- これらが 5-8 週級の追加実装

### 17.4 移行判断の trigger

本 spec 運用で以下のいずれかが顕在化した場合、Direction A 移行を再評価:
- 「同一 EditSession 内で 2 人以上が同時に編集したい」要望が常時 3 件以上
- リアルタイム collab を期待する顧客要件
- AI と人間が同じキャレットで作業する pair-programming 要求

---

## 18. 受け入れ基準 / セキュリティ考慮事項

### 18.1 受け入れ基準

実装シリーズで以下を全て満たすこと:

- [ ] § 3 EditSession 概念の正規実装
- [ ] § 5 ライフサイクル 1-6 step が動作 (vitest + e2e)
- [ ] § 7 take-over の atomicity (View → Edit / Edit → View が同一 critical section)
- [ ] § 8 save 規則 (Edit のみ可 / 全員 View なら誰でも可、audit log 必須)
- [ ] § 9 複数 EditSession 並存 + last-save-wins 警告ダイアログ
- [ ] § 10 AI participant + `Alice@AI` 表示 + `parentHumanSessionId` 保持
- [ ] § 11 URL `?session=<editSessionId>` 経由の attach
- [ ] § 12 TTL 2 段階 (Active → Discarded → 完全削除) の自動削除
- [ ] § 13 attach 時の initial fetch (memory store から最新 payload 取得) — § 1.1 根本欠陥の解消
- [ ] § 14 broadcast プロトコルの新 event 一式
- [ ] PR #888 の旧 API (lock / draft 系) を全削除 (§ 15.1 表参照)
- [ ] 既存 spec (`collab-presence.md` / `edit-session-draft.md`) からの参照リンク追加

### 18.2 セキュリティ考慮事項

- **EditSessionId の推測攻撃**: ULID-like で十分長く、推測困難。ただし brute-force は技術的に可能 → workspace 認証層が一次防御
- **URL 経由の招待**: workspace 認証を通っていれば View 可能 (内製ツール前提)
- **take-over の濫用**: 元 owner の同意なしに take-over 可能 (View 経由は必須)。誤操作は 7 日 history で復元可能
- **AI 操作の責任**: `parentHumanSessionId` で常に追跡、`Alice@AI` 表示で audit 容易
- **payload opaque**: server は payload 中身を解釈しない → schema 違反 payload も transit する。viewer 側 UI で warning 表示 (本 spec ではこれを許容、edit 不可なので安全)

### 18.3 性能考慮事項

- mid-edit broadcast は debounce (frontend 300ms throttle 維持)
- presence broadcast は state 遷移時のみ
- cleanup は 1h 間隔 setInterval
- EditSessionStore は in-memory Map、entry 数は active 数 + history 数で限定的

### 18.4 移行戦略 (PR #888 → 本 spec)

PR #888 マージ済の現実装は **過渡的扱い**。本 spec 実装シリーズで以下を段階的に置き換える:

1. EditSessionStore 新規実装 (Phase 1)
2. wsBridge の新 request handler 追加 (Phase 2)
3. frontend useEditSession 改訂 (Phase 3)
4. 旧 API (lock.* / draft.*) を deprecation 経路で並行運用 (Phase 4)
5. UI components 改訂 + URL `?session=` の正規化 (Phase 5)
6. 旧 API 完全削除 + 既存 spec 改訂 (Phase 6)
7. テスト + e2e (Phase 7)

各 Phase は別子 ISSUE として分割、統合 PR で main マージ。

---

## 19. 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-05-07 | 新設 (#876 / #855 派生 Direction B 実装の根本欠陥を解消する正規プロトコル) |
