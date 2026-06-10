# ページレイアウト Designer (互換 URL)

> **対象ルート**: `/w/:wsId/page-layout/design/:pageLayoutId`
> **現在の扱い**: `/w/:wsId/page-layout/edit/:pageLayoutId` へ redirect

## 概要

旧 PageLayout Designer は PageLayout 自身を GrapesJS / Puck で編集する画面だったが、PageLayout と Gadget / page Screen 本体の編集責務が混ざるため廃止した。

現在の正規 UI は [`ページレイアウト編集`](page-layout-editor.md) で、レイアウトマネージャとして以下を 1 画面で扱う。

- レイアウトパターン選択
- region 定義
- region → Gadget assignment
- `main` content slot の確認
- sample page を使った read-only 合成プレビュー

## 到達経路

- 旧 URL `/w/<wsId>/page-layout/design/<pageLayoutId>` は互換のため残し、対応する編集画面へ自動遷移する。
- 新しい操作導線ではページレイアウト一覧から `/page-layout/edit/:id` を開く。

## 注意

- PageLayout 画面では Gadget / page Screen 本体を編集しない。
- Gadget や page Screen の中身は Screen Designer で編集する。
- PageLayout の preview は read-only 合成表示であり、保存対象は `regions[]` / `assignments` である。
