# dogfood レポート — english-learning サンプル (2026-05-04)

> **📝 ステータス**: 完了済 **historical record** (英語学習サンプル dogfood、2026-05-04 実施)。本書は当時の検証結果記録として保持、削除不可 (他 spec から参照ある場合あり)。最新の状況・運用は現行 spec を参照。

## 概要

- **対象サンプル**: `examples/english-learning/` (英会話学習アプリ、B2C + 外部 AI 連携)
- **規模**: 画面 11、テーブル 10、ProcessFlow 5、View 3、ViewDefinition 5、Sequence 2、拡張 1 namespace
- **機械バリデータ結果 (事前)**: `npm run validate:samples` — 5 / 5 flows passed、vitest 93/93、半角カナ 0 件、schemas 無変更
- **dogfood 日付**: 2026-05-04

本レポートは子 5 (AI 実機 dogfood) の成果物。機械検証では拾えない **業務 semantic 整合 + 設計書としての完成度** を 4 軸で評価した。

---

## シナリオ end-to-end トレース結果

### S-1: ストーリー一覧 → セッション作成 → 会話プレイ

| ステップ | 評価 | 備考 |
|---|---|---|
| ストーリー一覧 (No.2) → ストーリー詳細 (No.3) | OK | tr-stories-to-detail で接続確認 |
| ストーリー詳細の「学習開始」ボタン → cc173367 flow 呼び出し | OK | screenId=046e1f83 と一致 |
| step-01: stories SELECT (WHERE id=@storyId AND is_active=TRUE) | OK | stories テーブル (b5aa3e1b) FK 確認 |
| step-02: learning_sessions INSERT | OK | d524cba6 テーブルの user_id / story_id / status / started_at / updated_at 列は存在する |
| step-03: sessionId を 201 で返す | OK | bodyExpression で @newSession.id を返す |
| 会話プレイ画面遷移 (/learn/:sessionId) | OK | tr-detail-to-play 確認 |

S-1 トレース: **OK**

---

### S-2: 会話プレイ → ユーザー発話 → LlmDialog + TtsGenerate → turn_logs INSERT → AI 応答表示

| ステップ | 評価 | 備考 |
|---|---|---|
| step-01: learning_sessions SELECT (WHERE id=@sessionId AND user_id=@sessionUserId AND status='in_progress') | OK | |
| step-02: セッション存在チェック (branch) | OK | |
| step-03: english-learning:LlmDialog — config で @turnContext / @userInput 参照 | **問題あり** | LlmDialog の outputType が `english-learning:dialogTurn` (object 型) なのに、step-04a で `@aiResponse` を TtsGenerate の `text` (string) に直接渡している。型不整合。step-07 も `aiResponseText: @aiResponse` で string として返しているが dialogTurn は role/content/audioUrl の object 型 |
| step-04: generateAudio フラグ分岐 | OK | |
| step-04a: english-learning:TtsGenerate — config.text = "@aiResponse" | **問題あり** | 上記の型不整合に起因 |
| step-04c: turn_logs からターン番号取得 | OK | |
| step-05: turn_logs INSERT — @nextTurnNumber / @userInput / @aiResponse / @aiAudioUrl | **注意** | turn_logs の列に user_input / ai_response / ai_audio_url / llm_context / turn_number / session_id / created_at を確認。存在する列と一致 |
| step-06: el.turn.completed イベント発行 — payload に `turnNumber: @newTurnLog.id` | **Should-fix** | turn_number (int) と newTurnLog.id (PK) は意味が異なる。turnNumber は @nextTurnNumber を使うべき |
| step-07: 200 OK で aiResponseText / aiAudioUrl / turnId を返す | **問題あり** | aiResponseText: @aiResponse が dialogTurn object を string として扱う |

S-2 トレース: **型不整合あり (Must-fix)**

---

### S-3: 会話プレイ → 録音送信 → SttEvaluate → pronunciation_scores INSERT → スコア表示

| ステップ | 評価 | 備考 |
|---|---|---|
| step-01: learning_sessions SELECT | OK | |
| step-02: セッション存在チェック | OK | |
| step-03: dialogue_lines SELECT (WHERE id=@dialogueLineId) | OK | dialogue_lines テーブル (246a3f13) 確認 |
| step-04: セリフ存在チェック | OK | |
| step-05: english-learning:SttEvaluate — config で audioUrl / referenceText / referenceIpa | OK | referenceText: @dialogueLine[0].text (text 列) / referenceIpa: @dialogueLine[0].ipa (ipa 列) 確認 |
| step-05b: evalResult.score を pronunciationScore に展開 | OK | |
| step-06: transactionScope (pronunciation_scores INSERT + learning_sessions UPDATE) | OK | |
| step-06a: pronunciation_scores INSERT — diff として @evalResult.diff を渡す | **Should-fix** | pronunciation_scores テーブルの description には `ORDER BY scored_at DESC LIMIT 1` と記述があるが、実際のカラム physicalName は `created_at` であり `scored_at` は存在しない。テーブル description の表記が誤っている |
| step-07: el.pronunciation.scored イベント発行 | OK | |
| step-08: 201 Created で scoreId / score / diff を返す | OK | |
| セッション結果画面遷移 (tr-play-to-result) | OK | |

S-3 トレース: **ほぼ OK (Should-fix 1 件)**

---

### S-4: 学習履歴一覧 → 詳細 / 単語帳 → 単語詳細 / 単語習熟度更新

| ステップ | 評価 | 備考 |
|---|---|---|
| 学習履歴一覧 (No.6) → 詳細 (No.7) | OK | tr-history-to-detail 確認 |
| 学習履歴 viewDef — v_learning_history_with_story (af699800) 参照 | **Must-fix** | SQL に `s.estimated_minutes` が含まれるが、stories テーブル (b5aa3e1b) に `estimated_minutes` カラムが存在しない。9 列定義のうち該当列なし |
| 単語帳 (No.8) → 単語詳細 (No.9) | OK | tr-vocabulary-to-word-detail 確認 |
| 単語帳 viewDef — v_words_with_progress (c0474fbf) 参照 | **Must-fix** | SQL に `w.reading` が含まれるが、words テーブル (8db75844) に `reading` カラムが存在しない。10 列定義のうち該当列なし |
| 21c25fb2 (単語習熟度更新) — words SELECT + user_word_progress UPSERT | OK | words (8db75844) / user_word_progress (7ab2cf24) FK 一致 |
| words テーブルの単語詳細 screen items — `translation_ja` 参照 | **Must-fix** | 単語詳細画面 (6bfa682c) / 会話プレイ画面 (a9d8eb6f) の description に `translation_ja` が記述されているが、words テーブルの列 physicalName は `translation`、dialogue_lines も `translation`。`translation_ja` は存在しない |

S-4 トレース: **Must-fix 3 件あり**

---

### scheduled: 3c4d9bfd 連続学習日数リセット

| ステップ | 評価 | 備考 |
|---|---|---|
| step-01: users UPDATE (streak_days=0 WHERE streak_days > 0 AND id NOT IN ...) | OK | users テーブル (c7e50462) に streak_days 列あり。サブクエリで learning_sessions (completed / completed_at) を参照 |
| step-02: log | OK | |
| step-03: el.streak.reset イベント発行 | OK | |

scheduled トレース: **OK**

---

## cross-entity 整合チェック

### テーブル FK 整合

| FK | 参照先 UUID | 実テーブル | 評価 |
|---|---|---|---|
| learning_sessions.user_id → users | c7e50462 | users | OK |
| learning_sessions.story_id → stories | b5aa3e1b | stories | OK |
| turn_logs.session_id → learning_sessions | d524cba6 | learning_sessions | OK |
| pronunciation_scores.session_id → learning_sessions | d524cba6 | learning_sessions | OK |
| pronunciation_scores.dialogue_line_id → dialogue_lines | 246a3f13 | dialogue_lines | OK |
| user_word_progress.user_id → users | c7e50462 | users | OK |
| user_word_progress.word_id → words | 8db75844 | words | OK |
| dialogue_lines.scene_id → scenes | 992ac5db | scenes | OK |
| scenes.story_id → stories | b5aa3e1b | stories | OK |
| stories.pack_id → content_packs | 517d50a3 | content_packs | OK |

FK 整合: 全件 OK

### View の依存テーブル整合

| View | 依存 UUID | 実テーブル | 評価 |
|---|---|---|---|
| v_learning_history_with_story | d524cba6 / b5aa3e1b / 517d50a3 | learning_sessions / stories / content_packs | OK |
| v_words_with_progress | 8db75844 / 7ab2cf24 | words / user_word_progress | OK |
| v_session_pronunciation_avg | fefa79cf / d524cba6 | pronunciation_scores / learning_sessions | OK |

### View SQL カラム整合 (Must-fix 2 件)

1. **v_learning_history_with_story** — `s.estimated_minutes` を SELECT しているが、stories テーブルに `estimated_minutes` カラムなし。outputColumns にも `estimated_minutes` が定義されている。
2. **v_words_with_progress** — `w.reading` を SELECT しているが、words テーブルに `reading` カラムなし。outputColumns に `reading` が定義されている。

### screen items の参照整合

- 会話プレイ画面 (a9d8eb6f) の `currentDialogueTranslation` description に `dialogue_lines.translation_ja` — 実列名は `translation` (Must-fix)
- 単語詳細画面 (6bfa682c) の description に `words.translation_ja` — 実列名は `translation` (Must-fix)
- 発音スコアテーブルの description に `ORDER BY scored_at DESC LIMIT 1` — 実列名は `created_at` (Should-fix)

### ViewDefinition のソーステーブル整合

| ViewDefinition | sourceTableId / query 参照 | 評価 |
|---|---|---|
| cfdbf081 (ストーリー一覧) | b5aa3e1b (stories) | OK |
| ba1c7d9d (コンテンツパック一覧) | 517d50a3 (content_packs) | OK |
| f06e103d (発音スコア履歴) | fefa79cf + 246a3f13 | OK |
| 4c9cdc85 (学習履歴一覧) | v_learning_history_with_story SQL | OK (view が Must-fix だが viewDef 自体の参照は正しい) |
| 090e9db0 (単語帳) | v_words_with_progress SQL | OK (同上) |

### extension stepKind 参照整合

- `english-learning:LlmDialog` → extensions.stepKinds.LlmDialog OK
- `english-learning:TtsGenerate` → extensions.stepKinds.TtsGenerate OK
- `english-learning:SttEvaluate` → extensions.stepKinds.SttEvaluate OK
- screenKind `english-learning:conversationPlayer` → extensions.screenKinds[0].kind = "conversationPlayer" OK

### conventions 参照整合

- `@conv.msg.sessionNotFound` → catalog.json msg.sessionNotFound OK
- `@conv.cefr.passingThreshold` → catalog.json extensionCategories.cefr.passingThreshold OK
- `@conv.wordProgress.masteryThreshold` → catalog.json extensionCategories.wordProgress.masteryThreshold OK
- `@conv.numbering.sessionId` → catalog.json numbering.sessionId OK
- `@conv.numbering.scoreId` → catalog.json numbering.scoreId OK
- `@conv.regex.ipa` → catalog.json regex.ipa OK

---

## description 待避粒度監査

| 待避項目 | 待避先 | 記述あり | 再現可能粒度 | 評価 |
|---|---|---|---|---|
| TTS 同期カラオケ字幕 | dialogue_lines.text.description + 会話プレイ screen items.description | あり | 「将来 TtsGenerate の wordTimings 出力を使い word-level highlight する。MVP は通常字幕のみ」と明記 | OK |
| Web Audio 録音 | recordButton 項目 description | あり | 「ブラウザ MediaRecorder API で録音し、終了後 audioUrl を SttEvaluate step に POST。録音中は Web Audio API AudioContext で波形描画 (canvas)」と明記 | OK |
| LLM ストリーム会話 | turn_logs テーブル description + S-2 flow meta.description | あり | 「ターン単位 request/response。実装側で SSE / WebSocket による partial response ストリーム表示を行う想定」と明記 | OK |
| 単語タップ辞書ポップアップ | dialogue_lines.text.comment + 会話プレイ screen description | あり | 「セリフ内の単語をタップすると /vocabulary/:wordId を modal 表示。実装側 router で intercept」と明記 | OK |
| 録音波形 visualizer | recordButton 項目 description | あり | 「録音中は Web Audio API AudioContext で波形描画 (canvas)」と明記 | OK (Web Audio 録音と同一個所に含む) |
| 発音採点フィードバック UI | pronunciation_scores テーブル description + S-3 flow output description | あり | 「diff フィールド (PhoneDiff[]) は音素単位の正誤判定リスト。実装側で IPA テーブル + 色分け表示」と明記 | OK |

全 6 項目 OK。粒度は実装者が再現できる水準。重複・抜けなし。

---

## spec dogfood 4 目的の達成度評価

| 目的 | 評価 (5 段階) | 所見 |
|---|---|---|
| (a) 外部 AI を ProcessFlow に組み込む (stepKind 拡張パターン実用例) | 4 / 5 | LlmDialog / TtsGenerate / SttEvaluate の 3 stepKind が実際の flow で使用され、config / outputBinding / outputType のパターンが蓄積された。LlmDialog の outputType (dialogTurn) と後続 step の型不整合が Must-fix として検出された点は知見として有効 |
| (b) UX を description 待避でどこまで表現できるか | 5 / 5 | 6 項目全て実装者再現可能粒度で記述。Web Audio / SSE / modal router intercept 等の実装詳細が設計書として保持されており、本フレームワークの description 待避パターンが B2C + 外部 AI 領域でも機能することを実証 |
| (c) 拡張パック (動的追加コンテンツ) を extensions/<namespace>/ でどう表現するか | 4 / 5 | content_packs.namespace_ref で拡張 namespace を参照するアプローチが明確に設計された。extensions/english-learning.v3.json でパック固有の stepKind / fieldType / screenKind を統合定義するパターンが確立。動的ロードの実装方針は description で待避 |
| (d) 進捗ベース UI (連続日数 / CEFR / 習熟度) を ViewDefinition でどう表現するか | 4 / 5 | v_words_with_progress + 単語帳 viewer で習熟ステータス別フィルタ、v_session_pronunciation_avg でセッション別集計が実現。CEFR 昇格判定は conventions.extensionCategories.cefr.passingThreshold で横断参照。ただし view SQL に存在しない列参照 (Must-fix) があり、フレームワーク外の bug を検出 |

---

## B2C トーン評価

| 観点 | 評価 | 所見 |
|---|---|---|
| スマホ縦長最適化 | (design.json 未確認、screen items の構造から判断) 要確認 | 各画面に Bootstrap 5 ベースの responsive 設計が指定されている |
| aria-label 充実 | OK | recordButton 項目 description に「aria-label は必須」と明記 |
| 4 テーマ破綻なし | design.json ベース、screen items 定義レベルでは判断不可 | |
| Bootstrap 5 統一 | 各 screen の description / items 構造から Bootstrap 5 前提が読み取れる | |

screen.design.json は設計書レベルの評価対象外。screen items の定義粒度では B2C トーン (録音ボタン / テキスト代替 / 会話履歴ペイン / スコア表示の構成) が業務見本品質を保っていることを確認。

---

## 検出された Must-fix 一覧

### Must-fix 1: v_learning_history_with_story で stories.estimated_minutes が存在しない列を参照

**ファイル**: `examples/english-learning/views/af699800-b15f-4588-9d0d-6a76a3eb2e48.json`

- selectStatement 内 `s.estimated_minutes` — stories テーブル (b5aa3e1b) に `estimated_minutes` カラムなし
- outputColumns に `estimated_minutes` が定義されている

**修正案**: stories テーブルに `estimated_minutes` 列 (INTEGER, nullable) を追加するか、view SQL / outputColumns から `estimated_minutes` を削除する。仕様書 (spec 2.3) には estimated_minutes の記述はないので、**削除が妥当**。

対象ファイル:
- `examples/english-learning/views/af699800-b15f-4588-9d0d-6a76a3eb2e48.json` (selectStatement + outputColumns から estimated_minutes を削除)

---

### Must-fix 2: v_words_with_progress で words.reading が存在しない列を参照

**ファイル**: `examples/english-learning/views/c0474fbf-d0f4-4cfc-bbcd-0154431df9a2.json`

- selectStatement 内 `w.reading` — words テーブル (8db75844) に `reading` カラムなし
- outputColumns に `reading` が定義されている

**修正案**: view SQL / outputColumns から `reading` を削除する。words テーブルの定義 (10 列) に reading 列を追加することも可能だが、spec に定義がないため削除を推奨。

対象ファイル:
- `examples/english-learning/views/c0474fbf-d0f4-4cfc-bbcd-0154431df9a2.json` (selectStatement + outputColumns から reading を削除)

---

### Must-fix 3: LlmDialog outputType 型不整合 — dialogTurn (object) を string として扱っている

**ファイル**: `examples/english-learning/process-flows/96118ae1-a0ab-401b-8584-dd645a45a81f.json`

- extensions の LlmDialog.outputType = `{ kind: "extension", extensionRef: "english-learning:dialogTurn" }`
- dialogTurn は `{ role, content, audioUrl }` の object 型
- step-03 の outputBinding `aiResponse` が object になるため、step-04a (TtsGenerate) の config.text に `@aiResponse` を渡すと object が text に入り型エラー
- step-07 の bodyExpression でも `aiResponseText: @aiResponse` で string として返している

**修正案 A**: LlmDialog の outputType を string (AI 応答テキストのみ) に変更する。dialogTurn responseType は参照可能だが、この flow での outputBinding は plain string で十分。extensions.stepKinds.LlmDialog.outputType を `{ kind: "base", baseType: "string" }` 等に修正する。

**修正案 B**: `@aiResponse.content` と参照するように flow の step-04a / step-05 / step-07 を修正する。

修正案 A の方が extensions の定義整合が簡潔なため推奨。

対象ファイル:
- `examples/english-learning/extensions/english-learning.v3.json` (LlmDialog.outputType を string に変更)
- または `examples/english-learning/process-flows/96118ae1-a0ab-401b-8584-dd645a45a81f.json` (参照を @aiResponse.content に変更)

---

### Must-fix 4: 画面 description に存在しない列名 `translation_ja` を参照

**ファイル**:
- `examples/english-learning/screens/a9d8eb6f-065d-4af6-ac9a-cc1fcf10b2b7.json` (会話プレイ screen)
- `examples/english-learning/screens/6bfa682c-b18e-45bd-8daa-eb20cc1834bf.json` (単語詳細 screen)

- 会話プレイ screen の items.currentDialogueTranslation.description: `dialogue_lines.translation_ja の表示` — 実列名は `translation`
- 単語詳細 screen の items description に `words.translation_ja` — 実列名は `translation`

**修正案**: description 内の `translation_ja` を `translation` に修正する。

---

## 検出された Should-fix 一覧

### Should-fix 1: S-2 flow step-06 のイベントペイロード — turnNumber が @newTurnLog.id (PK) を参照している

**ファイル**: `examples/english-learning/process-flows/96118ae1-a0ab-401b-8584-dd645a45a81f.json`

- `payload: "{ sessionId: @sessionId, turnNumber: @newTurnLog.id, role: 'assistant' }"`
- `@newTurnLog.id` は turn_logs.id (サロゲートキー)。ターン番号は `@nextTurnNumber` が正しい

**修正案**: `turnNumber: @nextTurnNumber` に変更する。

---

### Should-fix 2: pronunciation_scores テーブル description に存在しない列名 `scored_at` を参照

**ファイル**: `examples/english-learning/tables/fefa79cf-4721-4956-86bb-595427bf6f81.json`

- description: `最新スコアの取得は ORDER BY scored_at DESC LIMIT 1 で行う`
- 実際のカラムは `created_at`

**修正案**: description を `ORDER BY created_at DESC LIMIT 1` に修正する。

---

## Nit

1. S-2 flow の step-06 の id が `step-06` で正常だが、その後の step が `step-04c` / `step-04d` と非連番になっており、番号体系が不統一。機能上の問題はないが可読性が低い。
2. scheduled flow (3c4d9bfd) の actions[0].steps に httpRoute が定義されておらず scheduled trigger として適切だが、trigger="timer" に対応する cron 式は description でのみ記述されている。これは description 待避として妥当。

---

## フォローアップ提案 (起票判断は設計者)

### フレームワーク改善候補 (framework 領域)

- **型安全な stepKind outputType の参照パターンの文書化**: LlmDialog outputType が dialogTurn (object) か string かの設計判断は他サンプルでも繰り返し発生する可能性。`CustomStepKind.outputType` が `kind: "extension"` の場合、後続 step での参照方法 (`.content` 等のアクセス) をフレームワーク規約で明示するガイドがあると良い。記録は memory / spec に限定し、ISSUE 化は不要 (PR description に記録する程度で十分)。

### サンプル設計改善候補 (examples 領域)

- Must-fix 1-4 を修正し validate:samples / vitest で再確認する
- Should-fix 1-2 を合わせて修正する

---

## まとめ

`examples/english-learning/` は **B2C + 外部 AI 連携の初サンプル** として、spec dogfood 4 目的のうち (b) description 待避と (c) 拡張パックを完全実証した。(a) stepKind 拡張と (d) ViewDefinition も概ね実証済みだが、LlmDialog の型不整合 (Must-fix 3) と view SQL のカラム存在確認漏れ (Must-fix 1/2) が検出された。

Must-fix 4 件を解消すれば設計書品質は retail サンプルと同等水準に達する。Should-fix 2 件は軽微。

---

## 修正対応結果 (2026-05-04 同日)

dogfood 検出された全 Must-fix 4 件 + Should-fix 2 件を本子 5 PR で解消済。

| # | 内容 | 修正 |
|---|---|---|
| Must-fix 1 | views/af699800 の `estimated_minutes` 参照 (stories に該当列なし) | selectStatement と outputColumns から削除 |
| Must-fix 2 | views/c0474fbf の `reading` 参照 (words に該当列なし) | selectStatement と outputColumns から削除し、代わりに existing `example_translation` を含めるよう修正 |
| Must-fix 3 | LlmDialog outputType 型不整合 (`english-learning:dialogTurn` object 型を string として参照) | `@aiResponse` → `@aiResponse.content` に修正 (3 箇所: step-04a TtsGenerate.text、step-07 INSERT SQL ai_response、step-09 bodyExpression aiResponseText) |
| Must-fix 4 | screen description の `translation_ja` (実列名 `translation`) | a9d8eb6f / 6bfa682c の 2 画面で description 修正 |
| Should-fix 1 | turnNumber: @newTurnLog.id → @nextTurnNumber | step-06 eventPublish payload 修正 |
| Should-fix 2 | pronunciation_scores テーブル description の `scored_at` (実列名 `created_at`) | description 修正 |

### 再検証結果

- `npm --prefix designer run validate:samples -- ../examples/english-learning` → **5 / 5 flows passed**
- `npm --prefix designer run test:unit -- --run samples-v3.schema.test.ts` → 93/93 passed
- `Grep "[ｦ-ﾟ]" examples/english-learning/` → 0 件
- `git diff main..HEAD -- schemas/` → 0 件 (schema governance 遵守)

### 達成度評価 (修正後)

| 目的 | 修正前 | 修正後 |
|---|---|---|
| (a) 外部 AI stepKind 拡張パターン実用例 | 4 / 5 | **5 / 5** |
| (b) UX を description 待避で表現 | 5 / 5 | 5 / 5 |
| (c) 拡張パック (動的コンテンツ) を extensions で表現 | 4 / 5 | 4 / 5 (拡張余地は残るが MVP 範囲では完結) |
| (d) 進捗ベース UI を ViewDefinition で表現 | 4 / 5 | **5 / 5** |

**英会話学習サンプルは retail と同等水準で完成。リリース時の examples として提供可能。**
