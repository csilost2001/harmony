# collab-presence — 協調編集 (Direction B) 仕様

> **2026-05-07 改訂**: PR #888 の dogfood で「後から接続した viewer が編集中の最新 state を取得できない」根本欠陥が発覚 (= Direction B のメインユースケース破綻)。本 spec の lock + draft + presence の 3 層モデルから、**EditSession 一級概念を中核とする正規プロトコル**に再定義された。正規プロトコルは [`edit-session-protocol.md`](./edit-session-protocol.md) を参照。
>
> 本 spec は **overture (序章)** として継続有効: Direction B 採用根拠 (§ 2) / Forward-Compat 4 原則 (§ 3) / Activity taxonomy (§ 9) / Direction A への移行可能性 (本 spec の方針継続)。
>
> § 4-8 / § 11 のアーキテクチャ・状態遷移・broadcast プロトコル・既存 spec との関係は `edit-session-protocol.md` で置き換えられている。
>
> **Phase 6 (#903) 完了 (2026-05-07)**: lockManager / draftStore / onBehalfOfSession / SessionBadge を削除。lock.* / draft.* MCP tools 全削除。useEditSessionLegacy 削除。§ 4 アーキテクチャ図の lockManager/draftStore/presenceManager は obsolete。

> **シリーズ**: メタ #876 / RFC 派生 #855 (Option B 採用)
>
> 本ドキュメントは #855 で確定した Direction B (編集者 1 名 + 閲覧者複数 + presence + take-over UX) の正規仕様。
> 実装は子 ISSUE Phase 1 (#878) 以降で行う。Phase 0 (本 ISSUE #877) では本 spec を確定させ、後続 Phase 全体の設計契約とする。

---

## 目次

1. [概要 / 動機](#1-概要--動機)
2. [Direction B 採用根拠](#2-direction-b-採用根拠)
3. [Forward-Compat 4 原則](#3-forward-compat-4-原則)
4. [アーキテクチャ](#4-アーキテクチャ)
5. [lock 状態遷移 (viewer 拡張)](#5-lock-状態遷移-viewer-拡張)
6. [Heartbeat 仕様](#6-heartbeat-仕様)
7. [Opaque envelope 仕様](#7-opaque-envelope-仕様)
8. [Take-over フロー](#8-take-over-フロー)
9. [Activity taxonomy 5 段階](#9-activity-taxonomy-5-段階)
10. [AI `onBehalfOfSession` との関係](#10-ai-onbehalfofsession-との関係)
11. [既存 spec との関係](#11-既存-spec-との関係)
12. [受け入れ基準 / セキュリティ考慮事項](#12-受け入れ基準--セキュリティ考慮事項)

---

## 1. 概要 / 動機

### 1.1 動機

本リポジトリの編集モデルは現状 `edit-session-draft` (#683 マージ済) によって「編集者 1 名・lock 排他」で運用されている。同一ワークスペース内の **複数人協調** (会議・教育・AI ペアプロデモ等) のユースケースで以下の不足がある:

- 別ユーザーが「今誰が・何を・どこを編集中か」を観察する手段がない
- AI が `onBehalfOfSession` で編集している状況を別ユーザーが見る手段がない
- 編集権の譲渡 (take-over) が「強制解除」しかなく、誤って譲渡してもロールバックの猶予がない
- ユーザーが事前に他者の進行中 draft の存在に気付けず、衝突起票後に判明する

### 1.2 解決方針

**Direction B**: 編集者は引き続き 1 名 (lock holder)、他のセッションは **read-only follower (viewer)** として同じ workspace に attach し、editor の draft 中間状態をリアルタイム閲覧できる。

- 真の同時編集 (CRDT) は採用しない (#855 で Option A 不採用を確定)
- 既存 `edit-session-draft` の lock + draft 機構を温存しつつ、receive-only 経路を追加
- 同じ仕組みで AI の編集も別ユーザーに観察可能になる (副次効果)
- 編集者の交代は **take-over** (lock 譲渡 + 通知) で UX 的に明示

### 1.3 用語定義

| 用語 | 意味 |
|---|---|
| **editor** | lock holder。当該リソースに対する書込み権を持つ session 1 名 |
| **viewer** | lock を取らずに draft 中間状態を read-only で受信する session。複数可 |
| **take-over** | viewer が editor から lock を譲り受ける操作 (引継ぎ) |
| **presence** | 「今誰が・何を・どの role で見ているか」のメタ情報。CRDT に依存しない独立 channel で配信 |
| **awareness** | presence と同義 (Yjs 用語との互換)。本 spec 内では presence で統一 |
| **opaque envelope** | mid-edit broadcast の payload を非構造化 bytes-like として扱う規約。将来 CRDT バイナリへの swap を可能にする |
| **shadow store** | draft の in-memory キャッシュ。FS write を絞り、in-memory を真実点とする |
| **activity taxonomy** | session の「最終アクティビティ」を 5 段階に分類した状態モデル (live / active / idle / stale / abandoned) |

---

## 2. Direction B 採用根拠

### 2.1 #855 で比較した 3 案

| Option | 仕組み | 規模 | 採否 |
|---|---|---|---|
| A | フル CRDT (Loro / Dify v1.14 同等) | 8-12 週 | **不採用** (schema-first / AI 連携と衝突) |
| **B** | **編集者 1 + 閲覧者複数 (lock + viewer + broadcast)** | **1.5-2 週** | **採用** |
| C | presence のみ最小実装 | 2-3 日 | B のサブセット (B 内で段階的 release point として可) |

### 2.2 Direction B 採用理由

- **schema-first 思想と整合**: CRDT の LWW (Last-Writer-Wins) は schema 強制 (validator) と本質的に衝突する。Direction B は単一 editor が `validator` を pass させる責任を持つため、schema 整合性が崩れない。
- **既存 `edit-session-draft` の自然な延長**: lock + draft + `onBehalfOfSession` の機構を温存し、receive-only 経路を追加するだけ。再設計コストが小さい。
- **副次効果が大きい**: 同じ仕組みで AI の編集も別ユーザーに観察可能 (デモ / 教育 / 複数人レビュー)。
- **CRDT 互換層を維持**: Forward-Compat 4 原則 (§ 3) に従えば、将来 Option A 移行コストを 8-12 週 → 5-8 週 に低減できる。

### 2.3 Direction A を将来再評価する条件

Direction B 運用で以下のいずれかが顕在化した場合、Option A 移行を再評価する:

- lock 取得待ちの UX 摩擦が顕著に増加 (例: 1 リソースに同時編集要求が常時 3 件以上)
- AI がリアルタイム pair-programming で「人間と同時にキャレットを動かす」要求が立つ
- リアルタイム collab を期待する顧客要件が立つ (現在は内製ツールのため要件外)

---

## 3. Forward-Compat 4 原則

将来 Option A への移行を可能にするため、Direction B 実装時に以下を**必須遵守**する。違反は子 ISSUE PR レビューで Must-fix とする。

### 3.1 原則 ①: mid-edit broadcast を opaque envelope で抽象化

**Bad**: ProcessFlow / Table 固有の JSON 構造を WebSocket message に直接流す
**Good**: `{ type: "draft-update", resourceType, resourceId, sequence, payload: <opaque> }` のような汎用 envelope に包む

将来 Loro update バイナリ (Uint8Array) への差替えで message protocol を変えずに payload だけ swap できる。

### 3.2 原則 ②: lock を「UI hint」と「サーバ強制」の 2 層に分離

**Bad**: BE の lock を全 mutation の前で必須 check として実装、UI が結果を後追い表示
**Good**: BE は lock を「ヒント情報」として保持・配信、UI が hint に応じて edit を disable

CRDT 化時に「サーバ強制 lock」だけを撤去すれば済む。UI 層の「○○ さんが編集中」表示はそのまま残せる。

本実装 (Direction B) では BE 強制 lock も併用するが、UI 側のロジックを「lock 状態を hint として消費して disable する」形で書くことで、A 移行時に hint 部分のみ温存できる。

### 3.3 原則 ③: presence / awareness を CRDT 非依存の独立 channel に

**Bad**: presence (cursor / 選択ノード / 編集中バッジ) を draft state と同じ message に混入
**Good**: `presence:*` 専用 channel で完全分離 broadcast

Dify v1.14 も同じ設計 (`collaboration_event` 経路で CRDT と分離)。本実装でも最初から分離すれば、A 移行時に awareness 層は丸ごと無改修で流用可能。

### 3.4 原則 ④: draft 永続化を「snapshot のみ」設計に寄せる

**Bad**: server-side FS が authoritative source、全 mutation を即時反映保存
**Good**: server-side FS は **snapshot 用永続化** に役割限定、in-memory state を真実点とし、定期 / 明示 save 時にのみ FS flush

A 移行時に BE を relay-only に転換するのが容易。Direction B 段階でも mid-edit を毎回 FS write しない方が性能上も有利 (副次効果)。

---

## 4. アーキテクチャ

### 4.1 責務境界

```
┌──────────────────────────────────────────────────────────────────┐
│ Frontend                                                         │
│   ┌─────────────────────┐    ┌─────────────────────┐             │
│   │ EditorHeader        │    │ ListView            │             │
│   │  - EditSessionDropdown    - SessionBadge       │             │
│   │  - PresenceBadge    │    │  - PresenceBadge    │             │
│   └──────────┬──────────┘    └──────────┬──────────┘             │
│              │                          │                        │
│   ┌──────────▼──────────────────────────▼──────────┐             │
│   │ hooks                                           │             │
│   │  - useEditSession (mode: editor/viewer/...)    │             │
│   │  - useResourceEditor (update + draft-update push)             │
│   │  - usePresenceHeartbeat (30s + visibility 連動)               │
│   │  - usePresenceRegistry (broadcast subscribe)   │             │
│   └──────────┬──────────────────────────────────────┘             │
│              │                                                    │
│              ▼ wsBridge / mcpBridge                               │
└──────────────┼───────────────────────────────────────────────────┘
               │ WebSocket
┌──────────────▼───────────────────────────────────────────────────┐
│ Backend                                                          │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │ wsBridge — opaque envelope dispatch                     │    │
│   │  events: draft-update / presence:update / lock.changed  │    │
│   └────┬───────────────┬──────────────┬────────────────────┘    │
│        │               │              │                         │
│   ┌────▼────────┐ ┌────▼─────────┐ ┌──▼────────────┐             │
│   │ lockManager │ │ draftStore   │ │ presenceManager│             │
│   │  - acquire  │ │  - shadow    │ │  - heartbeat   │             │
│   │  - subscribeAsViewer (新)    │ │  - classify    │             │
│   │  - transferLock (新)         │ │  - cleanup    │             │
│   └─────────────┘ └──────────────┘ └───────────────┘             │
│        │               │                                         │
│        ▼               ▼ flush                                   │
│   ┌──────────────────────┐                                       │
│   │ FS: data/.drafts/    │                                       │
│   └──────────────────────┘                                       │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 各コンポーネント責務

| コンポーネント | 責務 | 既存/新規 |
|---|---|---|
| `lockManager` | lock 取得 / 解放 / 譲渡、viewer 受信権登録 | 既存拡張 (#683 PR-3) |
| `draftStore` | draft FS 永続化 + in-memory shadow + flush | 既存拡張 (#683 PR-2) |
| `presenceManager` | heartbeat 受信 / activity 分類 / cleanup | **新規** (Phase 1) |
| `wsBridge` | opaque envelope dispatch / broadcast scoping | 既存拡張 (event 追加のみ) |
| `useEditSession` | mode 管理 (editor/viewer/locked-by-other/...) | 既存拡張 (mode 追加) |
| `useResourceEditor` | state + update + draft-update push | 既存拡張 (push 統合) |
| `usePresenceHeartbeat` | 30s 間隔 + visibility 連動 | **新規** (Phase 1) |
| `usePresenceRegistry` | broadcast subscribe + Map | **新規** (Phase 1) |
| `EditSessionDropdown` | session 切替 UI | **新規** (Phase 4) |
| `PresenceBadge` | level → 色 + テキスト | **新規** (Phase 7) |

---

## 5. lock 状態遷移 (viewer 拡張)

### 5.1 既存 mode (#683 PR-7 で確立)

`frontend/src/hooks/useEditSession.ts` の mode:

- `readonly` — 初期状態、lock 未取得
- `editing` — lock 保有、自由に編集
- `locked-by-other` — 他者が lock 保有、自分は edit 不可
- `force-released-pending` — 強制解除要求中
- `after-force-unlock` — 強制解除直後

### 5.2 本 spec で追加する mode

- **`viewer`** — lock を取らずに draft 中間状態を受信する read-only follower

### 5.3 mode 遷移図

```
                ┌─────────────┐
                │  readonly   │
                └──────┬──────┘
                       │ ① lock.acquire 成功
                       │
                       ▼
                ┌─────────────┐
            ┌───┤   editing   │
            │   └──────┬──────┘
            │          │ ⑦ release / ⑧ transferLock
            │          │
            │          ▼
            │   ┌─────────────┐
            │   │  readonly   │
            │   └─────────────┘
            │
            │ ② lock.acquire 失敗 (LockConflictError)
            │   → 自動 fallback
            │
            ▼
       ┌─────────────┐                        ┌──────────────────┐
       │   viewer    │  ──── ⑨ take-over ───▶ │      editing     │
       │ (本 spec で追加)                     │ (新 owner)       │
       └─────────────┘                        └──────────────────┘
            ▲ ③ subscribeAsViewer 成功
            │
            │ ④ unsubscribeViewer / 切断
            │
            ▼
       ┌─────────────┐
       │ disconnected│
       └─────────────┘
```

凡例:
- ①: 「編集開始」ボタン押下成功
- ②: 「編集開始」ボタン押下したが他者が lock 保有 → viewer fallback
- ③: 「観察」アクション (EditSessionDropdown / 一覧バッジから)
- ④: タブクローズ / unsubscribe
- ⑦: 「保存して閉じる」 / 「破棄して閉じる」
- ⑧: 自分から lock を譲渡 (transferLock)
- ⑨: viewer から「引継」アクション → 新 owner

### 5.4 viewer mode の制約

- 全 edit 操作 disable (キーボード入力 / マウスドラッグ / コピペ等)
- `draft-update` broadcast を受信して state を上書き表示
- presence heartbeat は kind="activity" のみ送信 (kind="edit" は送らない)
- URL に `?session=<owner-sid>` が反映される

---

## 6. Heartbeat 仕様

### 6.1 目的

- presence 状態 (誰がどのリソースを見ているか) を維持
- activity taxonomy (§ 9) の判定に必要な lastActivityAt / lastEditAt を更新
- WS 切断検出 (`abandoned` 判定)

### 6.2 仕様

| 項目 | 値 |
|---|---|
| 間隔 | **30 秒** |
| 条件 | `document.visibilityState === "visible"` (タブが前面の時のみ) |
| 送信 method | WS message `presence.heartbeat` |
| payload | `{ resourceType, resourceId, kind: "activity" \| "edit" }` |
| editor mode | kind="activity" 30s 毎 + 編集 push 直後に kind="edit" |
| viewer mode | kind="activity" 30s 毎のみ |

### 6.3 server-side 反映

`presenceManager.heartbeat(wsId, sessionId, type, id, kind)`:

- kind="activity": lastActivityAt = now
- kind="edit": lastActivityAt = now + lastEditAt = now
- focusAt = now (visibility 連動)
- 状態 (level) が遷移した場合のみ `presence:update` broadcast

### 6.4 タイマー精度

heartbeat は precise timing を要求しない。30s ± 5s の jitter は許容。`setInterval` で十分。
`requestAnimationFrame` や precision timer は使わない。

---

## 7. Opaque envelope 仕様

### 7.1 envelope 形

```ts
interface DraftUpdateEnvelope {
  type: "draft-update";
  resourceType: DraftResourceType;
  resourceId: string;
  sequence: number;          // monotonic per (resourceType, resourceId)
  payload: unknown;           // ★ opaque — 内部構造を spec で固定しない
  senderSessionId: string;
}

interface PresenceUpdateEnvelope {
  type: "presence:update";
  resourceType: DraftResourceType;
  resourceId: string;
  entries: PresenceEntry[];
}
```

### 7.2 opaque 規約

`payload` は `unknown` 型。本 spec は以下のみを規定する:

- **server は payload の中身を解釈してはならない** (透過 relay)
- payload は JSON シリアライズ可能なものか、将来的には bytes-like (`Uint8Array` のような buffer)
- viewer 側は `sequence` で reorder を検出 (sequence が前回より小さければ破棄)
- editor 側は payload の生成責任 + viewer 側は consumer 責任を持つ

### 7.3 swap 互換性

将来 Option A 移行時、payload を Loro update binary (Uint8Array) に切り替える際:

- envelope 構造は変えない
- viewer 側 reducer のみ「JSON → setState」から「Loro doc.import」に書き換え
- server は引き続き透過 relay

→ Direction B 実装時は payload を **JSON のまま** で良いが、**server コードが payload 内部を読み取らない** ことを徹底する。

### 7.4 sequence 管理

- editor 側で resourceKey 単位の monotonic counter を持つ
- 各 update 毎に increment、push 時に envelope に含める
- viewer 側で `if (envelope.sequence <= lastReceived) return` で out-of-order 破棄

---

## 8. Take-over フロー

### 8.1 シーケンス

```
viewer (bob)         server (lockManager)         editor (alice)
   │                       │                          │
   │── "[↪引継]" click ────▶│                          │
   │                       │                          │
   │                       │── lock.changed ─────────▶│
   │                       │   { op: transferred,     │
   │                       │     from: alice,         │
   │                       │     to: bob }            │
   │                       │                          │
   │── transferLock ─────▶ │                          │
   │   confirm dialog →    │                          │
   │   yes                 │                          │
   │                       │                          │
   │                       │── transferDraft ─────────│
   │                       │   (FS path move +        │
   │                       │    shadow rename)        │
   │                       │                          │
   │                       │── onBehalfOfSession ────▶│ ← AI が alice を借受していた場合
   │                       │   reassign actor         │   bob を新 owner に
   │                       │                          │
   │◀── lock.changed ──────│                          │
   │   { op: transferred,  │                          │
   │     to: bob }         │                          │
   │                       │                          │
   │ mode: editing         │                          │ mode: viewer (auto-fallback)
   │                       │                          │ banner: "@bob に引き継がれました"
```

### 8.2 元 owner 通知

元 owner (alice) が:
- **接続中**: 即座に banner 表示「@bob に引き継がれました」+ mode 変更 (editing → viewer)
- **切断中**: 次回再接続時に通知履歴を表示 (`history` API、Phase 6 では list 表示まで)

### 8.3 不可逆性とリカバリ

- transferLock は不可逆 (元 owner は自動的には戻れない)
- リカバリ: 元 draft を **7 日 history 保持** することで復元可能 (実装は Phase 6 では list 表示まで、復元 UI は別 ISSUE)

### 8.4 確認ダイアログ

引継時、新 owner 側で confirm 必須:

> @<fromOwner> さんの編集権を引き継ぎます。<br>
> 現在の編集状態 (draft) はそのまま引き継がれます。<br>
> @<fromOwner> さんには通知が届きます。よろしいですか?

---

## 9. Activity taxonomy 5 段階

### 9.1 状態定義

| 内部状態 | 条件 | 表示 | 推奨アクション |
|---|---|---|---|
| **live** | WS 接続中 + lastEditAt < 60s | 🟢 操作中 | attach 観察 (会議中の可能性) |
| **active** | WS 接続中 + lastActivityAt < 5 min | 🟢 操作中 | attach 観察 OK |
| **idle** | lastActivityAt 5 min 〜 24h | 🟡 操作なし | 引継候補 |
| **stale** | lastActivityAt 24h 以上 (WS 接続中) | ⚫ 放置 | 破棄 or 引継 |
| **abandoned** | lastActivityAt 24h 以上 (WS 切断中) | (cleanup 候補) | 自動 cleanup 確認 prompt |

### 9.2 二重表現 (色覚配慮)

- 色 (🟢/🟡/⚫) + 補足テキスト (`"操作中"` / `"操作なし"` / `"放置"`) を必ず両方表示
- aria-label で screen reader 対応 (例: `aria-label="操作中、3 分前"`)

### 9.3 threshold の config 化

`backend/src/presenceConfig.ts`:

```ts
export const presenceConfig = {
  liveThresholdSec: 60,
  activeThresholdSec: 300,
  idleThresholdSec: 86400,
  cleanupIntervalMs: 60 * 60 * 1000, // 1h
};
```

env 変数で override 可:
- `HARMONY_PRESENCE_LIVE_SEC=60`
- `HARMONY_PRESENCE_ACTIVE_SEC=300`
- `HARMONY_PRESENCE_IDLE_SEC=86400`
- `HARMONY_PRESENCE_CLEANUP_INTERVAL_MS=3600000` — cleanupAbandoned の定期実行間隔 ms (デフォルト 1h)

### 9.4 broadcast 効率化

- 状態遷移時 (level が変わった時) のみ `presence:update` 発火
- 毎秒の更新通知は不要 (frontend 側で時刻差分から表示計算)

### 9.5 cleanup

`presenceManager.cleanupAbandoned()`:

- 1 時間ごとに `setInterval` で実行
- abandoned (`actAge > idleThresholdSec` && WS 切断) を internal Map から削除
- 削除した entry を `presence:update` で broadcast (空配列または filter 後)

#### 9.5.1 即時 cleanup on WS disconnect (#980-A 追加)

`wsBridge.ts` の `ws.on("close")` で `presenceManager.unregisterAllForSession(clientId)` を呼び、
切断 session の全 presence エントリを **即時削除 + presence:update broadcast** する。

`cleanupAbandoned` (1h 間隔) の補完経路として、tab close → 接続中 client の SessionBadge
即時消滅を実現する (これがないと 1h 間 stale バッジが残り、UX を損ねる)。

仕様 § 9.5 と矛盾せず: 即時 cleanup は強化経路であり、定期 cleanup は依然として
不慮の切断 (network 切れ等で `close` が発火しない) のための fallback として機能する。

---

## 10. AI `onBehalfOfSession` との関係

### 10.1 現状 (#683 PR-7 マージ済)

`backend/src/onBehalfOfSession.ts`:

```ts
resolveOnBehalfOfSession(
  callerSessionId,         // AI 自身の sessionId
  onBehalfOfSession?,       // 借受対象 (人間の sessionId)
  isActiveSession,          // 借受対象がアクティブか
): { owner, actor, isDelegated }
```

- `onBehalfOfSession` 指定あり: owner=人間 / actor=AI / isDelegated=true
- 指定なし: owner=actor=AI 自身

### 10.2 本 spec での拡張

#### 10.2.1 viewer による AI 観察

AI が `onBehalfOfSession` で alice の draft を編集中、別ユーザー bob が viewer attach した場合:

- bob は AI の編集を `draft-update` 経由でリアルタイム閲覧
- presence list に AI が `🤖 @ai (alice 代行)` として表示される
- AI 操作は kind="edit" heartbeat で alice の lastEditAt 更新 (= alice が live 表示)

#### 10.2.2 take-over 時の actor 再割当

bob が alice から take-over した時、AI が借受中なら:

- **採用方針 (option A)**: AI の actor を bob に引き継ぎ (透過)。AI は同じ仕事を続ける。
- 不採用 (option B): AI セッション切断 (新 owner の確認待ち)

理由: 「引き継いだ後も AI が同じ仕事を続けてくれる」が UX として自然。bob が AI を切断したい場合は EditSessionDropdown から明示的に「🤖 切断」可能 (別 ISSUE)。

### 10.3 presence 表示の特例

`PresenceEntry.ownerLabel` フィールドで表示名を制御:

- 通常: `@alice`
- AI 借受: `@ai (alice 代行)` (ownerLabel = `"@ai (alice 代行)"`、role はそのまま editor)

---

## 11. 既存 spec との関係

### 11.1 `edit-session-draft.md` (#683)

本 spec は `edit-session-draft.md` の **拡張**。基底機構 (lock + draft + onBehalfOfSession) はそのまま流用し、以下を加える:

- viewer mode (新 mode、§ 5)
- presence channel (新 channel、§ 6 / § 9)
- mid-edit broadcast (新 event、§ 7)
- shadow store (既存 draftStore の挙動変更、§ 4)
- transferLock (新 API、§ 8)

`edit-session-draft.md` の D-1 〜 D-12 設計判断は変更しない。本 spec は D-13 以降の追加判断として位置付ける (本 spec 内で D-13 〜 D-20 として明記してもよい)。

### 11.2 `workspace-multi.md` (#679)

別軸:
- `workspace-multi.md` = 複数 workspace の **同時並行編集** (1 ブラウザタブ = 1 active workspace)
- 本 spec = **同一 workspace 内の複数人 collab**

衝突なし。並行進行可能。

### 11.3 `multi-editor-puck.md` (#806)

editorKind / cssFramework の解決順序 (screen → project → default) は影響なし。Puck も GrapesJS も同じ presence 機構で動く。

### 11.4 `draft-state-policy.md`

業務リソースの maturity (draft / committed) policy は別軸。本 spec の draft は「編集セッション状態」の draft。`draft-state-policy.md` の draft は「リソースの成熟度」の draft。同名語が衝突するため、本 spec では **edit-session-draft** と書く。

---

## 12. 受け入れ基準 / セキュリティ考慮事項

### 12.1 受け入れ基準

- [x] 12 セクション全て記述
- [x] 既存 5 段階 mode の遷移図に viewer mode が追加されている (§ 5.3)
- [x] Forward-Compat 4 原則の各原則に「Bad/Good」例が含まれている (§ 3)
- [x] threshold が env 変数で override 可能 (§ 9.3)
- [x] `edit-session-draft.md` から本 spec への参照リンクが追加されている

### 12.2 セキュリティ考慮事項

- **viewer 権限**: 現状の認証層 (workspace に attach できれば全リソース閲覧可) を超える分離は行わない (内製ツール前提)
- **payload opaque**: server が payload を解釈しないため、payload に validator を通さない設計。validator は editor 側 + commit 時に server で実行されるため、viewer 表示時に schema 違反 payload が表示される可能性がある (要件: viewer は warning 表示のみ、edit 不可なので安全)
- **take-over**: 元 owner の同意なしに viewer 側から強制的に lock を奪える (= 既存 forceRelease と同等の権限モデル)。誤操作リカバリは history 7 日保持で対処
- **AI actor 再割当**: take-over 時に AI セッションが新 owner に継承される。新 owner が AI 動作を望まない場合は明示切断が必要 (§ 10.2.2)

### 12.3 性能考慮事項

- mid-edit broadcast は 300ms throttle、shadow store により FS write は減少 (現状の autosave 並み or 軽い)
- presence broadcast は state 遷移時のみで毎秒は発火しない (§ 9.4)
- cleanup は 1h 間隔の `setInterval` (§ 9.5)、CPU 負荷無視できる

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-05-07 | 新設 (#876 Phase 0 / #855 RFC 派生 Direction B 実装の基底 spec) |
