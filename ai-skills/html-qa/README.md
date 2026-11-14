# html-qa (Harmony での使い方)

html-qa の本体 (ハブ・クライアント・手順書) は、別のリポジトリ [csilost2001/html-qa](https://github.com/csilost2001/html-qa) にある (2026-11 に Harmony から切り出した。#1608)。ここに置くのは、Harmony のプロジェクトとしての 2 ファイルだけ。

| ファイル | 中身 |
|---|---|
| `SKILL.md` | AI 向けの手順 (`/html-qa`)。`.claude/skills/html-qa` はこのフォルダへのリンク |
| `html-qa.mjs` | 薄いクライアント (`publish` `wait` `hook` `status` `pair` `update` など) |

- ハブは WSL ホストの Docker で動く (`~/projects/html-qa` で `docker compose up -d`)。ポートは 18190 (開発コンテナからは `http://host.docker.internal:18190`)。スマホ用は 18191 (Windows の portproxy で 18190 へ)
- Harmony はハブにプロジェクト `harmony` として接続する (`node ai-skills/html-qa/html-qa.mjs pair --hub-url http://host.docker.internal:18190 --project harmony`。ハブの画面で承認)。トークンは `.tmp/html-qa/.hub.json` (git に入れない)
- 回答を発言に添える hook は `.claude/settings.json` (`node ${CLAUDE_PROJECT_DIR}/ai-skills/html-qa/html-qa.mjs hook`)
- ハブを新しい版にしたら `node ai-skills/html-qa/html-qa.mjs update` で 2 ファイルを取り替え、commit する
- 回答を設計のマーカーにする変換 (Harmony 専用) は `scripts/dev/html-qa-markers.mjs` (`vN.answer.json` を読む。SKILL.md の「Harmony で使うとき」)
