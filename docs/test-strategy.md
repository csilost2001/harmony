# テスト戦略 — E2E (#930)

## 目的

E2E テストを目的別タグで分類し、AI / 設計者が状況に応じて部分実行できるようにする。CI には乗せず手動実行 (memory `feedback_no_github_actions_ci.md`)。

## タグ定義

| タグ | 目的 | 目安実行時間 | 対象 spec 数 (現状) |
|---|---|---|---|
| `@smoke` | 主要 UI 動線が壊れていないかの最低保証 | < 1 分 | 5 |
| `@regression` | 機能 / 領域別の網羅 (デフォルト) | 10-20 分 | 67 |
| `@endurance` | examples 横断 round-trip / 長時間検証 | 30 分超 | 1 |

## 運用

- AI が毎 PR で smoke のみ実行 (`npm run test:e2e:smoke`)
- 設計者が定期的に regression 実行 (`npm run test:e2e`)
- 大規模変更時は endurance 含めて全実行 (`npm run test:e2e:all`)

## spec 追加時の付与ルール

- 新規 spec はデフォルトで `@regression` 付与
- `@smoke` は HeaderMenu 主要遷移・error boundary 等の最小動線にのみ付与 (現在 5 spec)
- `@endurance` は examples-walkthrough 系の重い real-data round-trip にのみ付与
- 形式: `test.describe(title, { tag: ["@regression"] }, callback)` でトップレベル describe にのみ付与

## npm script 一覧

| script | 内容 |
|---|---|
| `npm run test:e2e` | デフォルト (smoke + regression、endurance 除外) |
| `npm run test:e2e:smoke` | `@smoke` のみ |
| `npm run test:e2e:regression` | `@regression` のみ |
| `npm run test:e2e:endurance` | `@endurance` のみ (`E2E_INCLUDE_ENDURANCE=1` 強制) |
| `npm run test:e2e:all` | 全タグ含む全 spec |

特定領域だけ走らせたい場合は spec パス指定:
```bash
npm run test:e2e -- screen-list table-list
```

## CI 化していない理由

memory `feedback_no_github_actions_ci.md` の方針に従い、本リポジトリは GitHub Actions 等の CI を新設しない。設計者が手動で npm script を実行する運用。

## 関連

- メタ ISSUE: #929 (E2E カバレッジ強化シリーズ)
- 本機能 ISSUE: #930
- 監査資料: `tmp/review-cache/e2e-coverage-audit.md` (gitignored、設計者ローカル)
- 関連 memory: `feedback_no_github_actions_ci.md`、`feedback_no_silent_test_modification.md`
