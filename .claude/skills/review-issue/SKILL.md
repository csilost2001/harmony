---
name: review-issue
description: ISSUE の実装計画が全 PR 横断で網羅されているかを検証し、結果を ISSUE コメントに投稿
argument-hint: <ISSUE 番号>
disable-model-invocation: true
---

<!--
  使い方:
    - 新しい Claude Code セッション (別ウィンドウ/別タブ) で `/clear` してから起動
    - `/review-issue 148` のように ISSUE 番号を指定して **明示的に** 呼び出す
    - ISSUE に紐づく PR が「全て」マージ済みになったタイミングで実行する
    - レビュー結果は `gh issue comment` で ISSUE に投稿される

  目的:
    - 1 ISSUE が複数 PR に分割された場合でも、ISSUE 本文の実装計画が漏れなく実装されたかを確認する
    - `/review-pr` は PR 単位のコード品質・spec 準拠を見る。こちらは **ISSUE 単位の網羅性** を見る
    - AI エージェントは ISSUE のチェックリスト項目を取りこぼしやすいため、最終的な deliverable 確認が重要

  発動制御:
    - frontmatter の `disable-model-invocation: true` により、Claude が description マッチで
      自動起動することを禁止している。ユーザーが明示的に `/review-issue <N>` と打った時のみ起動。
-->

ISSUE #$ARGUMENTS の実装計画が、紐づく全 PR 横断で網羅されているかを検証してください。

## 役割と前提

- **あなたは ISSUE 実装完了の監査役**。個々の PR の品質ではなく、「**ISSUE で約束した項目が全て実装されたか**」を見る
- 対象 ISSUE に紐づく PR は**全てマージ済み**の前提で動く。未マージがあれば指摘して中断
- 実装担当とは別セッション。実装者の自己申告 (PR 本文の「仕様逐条突合」) を**そのまま信じない**
- 実装コミットは作らない。レビュー報告のみ

## 正の仕様

ISSUE 本文・コメントが**実装計画の一次ソース**。その上に `docs/spec/` がある場合、spec も整合性チェックの対象に含める。

- ISSUE 本文のチェックリスト (`- [ ]` / `- [x]`)
- 箇条書きで列挙された実装項目
- 受け入れ条件 / 完了条件
- コメントで**追加・変更された**要件 (これを見落としやすい)

## レビュー手順 (この順で実施)

### Step 0: 情報収集 — 並列実行

**同じ ISSUE への 2 回目以降の呼び出しかもしれないため、最新状態とコメント履歴を必ず取得して現状を判断する。** 過去の Claude Review (ISSUE 完了監査) コメントがあっても「既に監査済み」で即終了せず、追加 PR マージや実装状況の変化を踏まえて **初回監査** / **再監査** / **再監査不要 (変化なし)** のいずれかを判断する。

以下を並列で:

- `gh issue view $ARGUMENTS --comments` (**過去の Claude Review コメントも確認**)
- `gh issue view $ARGUMENTS --json title,state,body,labels,assignees,closedAt`
- 紐づく PR 一覧: `gh pr list --search "$ARGUMENTS in:body" --state all --json number,title,state,mergedAt,body`
  - または ISSUE 本文・コメント内の `#<N>` 参照から抽出
- spec 参照: ISSUE 本文から `docs/spec/` へのリンクを抽出し全文読む

**前提チェック**: 紐づく PR に `OPEN` / `DRAFT` があれば、「全 PR マージ後に再実行してください」と報告して終了。過去の Claude Review コメントがあれば、前回監査以降の追加 PR マージ有無を確認して再監査の要否を判断する。

### Step 1: 実装計画項目の列挙

ISSUE 本文・コメントから**実装予定の deliverable を全て**抽出し、番号付きリスト化する。

列挙の観点:

- チェックリスト項目 (`- [ ]` / `- [x]` 両方)
- 箇条書きで書かれた「〜する」「〜を追加」「〜を修正」の項目
- 受け入れ条件節 (Acceptance Criteria / 完了条件)
- **コメントで追加・修正された項目** (これが最も漏れやすい)
- 否定的要件 (「〜はしない」「〜を壊さない」) も含む

出力形式:

```
### ISSUE #N 実装計画項目
1. [本文] XYZ 機能を追加
2. [本文] ABC のバグを修正
3. [コメント #2] Z はオプション扱いに変更
4. [完了条件] テストで N 件 pass
...
```

### Step 2: コードベースでの実装突合

**現在の main ブランチ**のコードに対して、各項目が実装されているかを `file:line` で確認する。

- Grep / Glob / Read で該当コードを特定
- 「それっぽいコードがある」ではなく「**この項目を本当に満たしているか**」を意味的に判定
- 見つからない項目は「**実装漏れ候補**」として Must-fix で挙げる
- 複数 PR で段階的に実装された場合、**最終状態で成立しているか**が判定基準

判定テーブル:

| # | 実装計画項目 | 実装箇所 | 担当 PR | 判定 |
|---|---|---|---|---|
| 1 | XYZ 機能 | `src/foo.ts:45-80` | #123 | ✓ |
| 2 | ABC バグ修正 | `src/bar.ts:12` | #124 | ✓ |
| 3 | Z をオプション化 | — | — | ❌ **実装漏れ** |

### Step 3: PR 横断での整合性チェック

複数 PR で分割実装された場合、**PR 間の整合性**を確認する:

- 前の PR で追加された機能が、後の PR で壊れていないか
- 命名・API 形状・スキーマが PR 間で食い違っていないか
- ISSUE 全体で一貫した設計になっているか (PR ごとに方針がブレていないか)

### Step 4: spec との整合性チェック

ISSUE が `docs/spec/` の追加・変更を伴う場合:

- spec と実装が整合しているか (`/review-pr` の逐条突合と同じ粒度)
- spec に書いてあって実装にない条項があれば指摘
- 実装にあって spec にない機能があれば「spec 側の更新漏れ」として指摘

### Step 4.5: マルチエディタ対応 ISSUE の画面 editorKind 整合性確認 (#806)

ISSUE が画面デザイン / デザイナー / cssFramework / editorKind に関連する場合:

- 各画面の `editorKind` が ISSUE で約束した設計と一致しているか (`screen.design.editorKind` の実際の値を確認)
- `editorKind: "puck"` 画面と `editorKind: "grapesjs"` 画面が同一プロジェクトに混在している場合、それぞれが独立に開けるか確認
- 動的コンポーネント定義 (`puck-components.json`) が存在し、primitive フィールドが BUILTIN_PRIMITIVE_NAMES に含まれるか確認
- Thymeleaf 出力が必要な ISSUE では、Puck 画面がスキップされ記録されているかの実装を確認

詳細仕様: `docs/spec/multi-editor-puck.md` § 2.3

### Step 5: テスト・動作確認の充足

- ISSUE の完了条件にテストが含まれていれば、該当テストが存在するか確認
- 可能なら `cd frontend && npx vitest run` を実行して pass 確認
- UI 影響のある ISSUE は AI が chrome-devtools MCP / Playwright で smoke test 実施済みかを確認 (E2E 通過 + smoke test pass = 完了)

## 制約 (必守)

- **ISSUE をクローズしない**
- **新しい PR / コミットを作らない**
- `docs/spec/` を勝手に書き換えない (不備は指摘のみ)
- `gh issue close` / `gh issue edit` 等の書き込み系は**コメント投稿以外禁止**
- テスト実行は read-only の範囲 (`--update-snapshots` 等は不可)
- ファイル編集は `tmp/review-cache/` 配下の一時ファイルのみ可 (`tmp/` は `.gitignore` 済)

## 報告フォーマット

結果を一時ファイルに書き出してから `gh issue comment` で投稿する。

### 1. 一時ファイルに書き出し

事前に `mkdir -p tmp/review-cache` でディレクトリを確保してから、`tmp/review-cache/review-issue-$ARGUMENTS.md` に以下の構造で書き出す:

```markdown
## Claude Review (ISSUE 完了監査) — <YYYY-MM-DD>

**レビュアー**: Claude <モデル名 / ID>
**対象 ISSUE**: #$ARGUMENTS
**紐づく PR**: #<N1> (merged), #<N2> (merged), ...
**レビュー手順**: 実装計画列挙 + コードベース突合 + PR 横断整合 + spec 整合 + テスト充足

---

### 総合判定

**完了 / 部分完了 (追加対応必要) / 未完了** のいずれか。

- 完了: 全項目実装済み、ISSUE クローズ可
- 部分完了: 実装漏れあり、追加 PR 必要
- 未完了: 紐づく PR に未マージあり、再実行待ち

---

### Must-fix (実装漏れ)

- 項目 #<N>: <実装予定だった内容> — 該当コードが見つからない / 要件を満たしていない
  - 推奨対応: <追加実装・修正案>

### Should-fix (整合性・品質)

- `<file>:<line>` — <問題点> / 推奨修正: <...>

### Nit / 質問

- ...

---

### 実装計画項目 突合結果

| # | 実装計画項目 | 実装箇所 | 担当 PR | 判定 |
|---|---|---|---|---|
| 1 | ... | `file:line` | #123 | ✓ |
| 2 | ... | — | — | ❌ 漏れ |

---

### PR 横断整合性

- PR 間の不整合: <あれば列挙 / なければ「問題なし」>

---

### spec 整合性

- spec 更新の要否: <該当節と現状>
- spec と実装の差分: <あれば列挙>

---

### 検証方法

- `gh issue view $ARGUMENTS --comments` で本文・コメント確認
- 紐づく PR 一覧: <列挙>
- 主要ファイル読み込み: <リスト>
- `cd frontend && npx vitest run` → <pass 数> 件 pass / 未実行
- AI smoke test (UI 影響あり時): 実施済 / 不要

---

### 完了に向けた次のアクション

判定が「部分完了」の場合、不足分を実装する新 PR の粒度・ブランチ名・commit メッセージ例を提案する:

- 新規 PR: `feat/issue-$ARGUMENTS-followup-<slug>`
- 対応項目: #3 (Z をオプション化)
- 概要: ...
```

### 2. ISSUE にコメント投稿

```bash
gh issue comment $ARGUMENTS --body-file tmp/review-cache/review-issue-$ARGUMENTS.md
```

投稿前にユーザーの許可を得るフローになる (権限設定による)。拒否された場合でも `tmp/review-cache/review-issue-$ARGUMENTS.md` に結果が残っているので、ユーザーが内容を確認してから手動で投稿できる。

### 3. 完了報告

投稿完了後、ユーザーに短く報告:

- 実装計画項目の総数 / 完了項目 / 漏れ項目
- 総合判定 (完了 / 部分完了 / 未完了)
- 部分完了の場合は追加 PR の提案概要
- ISSUE URL (`gh issue view $ARGUMENTS --json url --jq .url`)

## 注意事項

- ISSUE 本文は書かれた当時の情報。**コメントで方針変更・追加要件が加わっていないか**を必ず確認する (ここが最大の盲点)
- 「PR が全部マージされた = ISSUE 完了」ではない。**ISSUE 本文の各項目とコードベースを直接突合**するのが本コマンドの役割
- 筆者も同じモデルなので共通の盲点がある可能性が高い。「PR 本文で対応済みと書いてある」を**鵜呑みにしない**
- 判定が「部分完了」でも ISSUE をクローズしない。追加 PR 後の再レビューで完了を判定する
