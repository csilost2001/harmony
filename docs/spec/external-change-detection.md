# 外部での更新の検知

設計ファイルが、この backend の外 (エディタ・git・別の AI など) で書き換えられたことを検知して、画面へ知らせる。

画面は、開いた設計を保存まで読み直さない。外で書き換えられたのに気づかないと、古い内容で上書き保存して、外での変更を失う。

## 動き

1. 画面が backend に接続して最初の要求を出したとき、そのワークスペースのデータフォルダ (`harmony.json` の `dataDir`) の監視を始める (`fs.watch` の recursive)
2. 設計ファイル (`screens` / `tables` / `process-flows` / `actions` / `sequences` / `views` / `view-definitions` / `page-layouts` / `business-flows` / `reports` / `screen-items` / `generic-definitions/<種類>` / `layout-components.json`) の変化を、300 ms まとめて受ける。隠しフォルダ・一時ファイル・退避ファイルは見ない
3. AI が書き換えたときと**同じ通知** (`tableChanged { tableId }` など) を、そのワークスペースを開いている全画面へ送る (`external: true` 付き)。あわせて、全体の知らせ `externalFilesChanged { paths }` を送る
4. 画面側 (各エディタの `useResourceEditor`):
   - 編集していなければ、自動で読み直す
   - 編集中なら、上書きせず、「別のクライアントでデータが変更されました」の帯を出す (編集中の内容はそのまま。「再読み込み」で外部の内容に、「無視」でそのまま続けられる)
5. 全体の知らせ: 「設計ファイルが外部で更新されました: tables/orders.json ほか 2 件」を、画面の下に短く出す

## backend 自身の書き込みは通知しない

画面の保存・AI の tool・改名など、この backend が書いたファイルは通知しない。見分けるため、`fs` の書き込み系 (`writeFile` / `rename` / `unlink` / `rm` / `rmdir` / `copyFile` / `truncate` / `cp` の promises 版・同期版) を起動時に 1 か所で包み、**書いたパス**を 1.5 秒 (`SELF_WINDOW_MS`) 覚える。覚えているパスの変化は「自分の書き込み」として除く。

要求の処理中かどうかではなく**そのファイル**で決めるので、画面が別の操作 (ハートビートなど) を続けていても、外部の変更は見逃さない。

## 限界 (正直に)

- backend が書いた直後 (1.5 秒以内) に、同じファイルを外で書き換えた場合は、検知できない
- 監視が使えない環境 (inotify の上限・一部のネットワークドライブ) では、検知しない (警告ログ)。保存時の競合の判定 (`expectedUpdatedAt` など) は従来どおり働く
- 外での変更は、ファイルが書き換わった事実だけを知らせる。スキーマに合うか・参照が壊れていないかは、ダッシュボードの「設計の要確認」で確かめる

## 実装

`backend/src/externalChanges.ts` (監視・分類・自分の書き込みの記録) / `backend/src/wsBridge.ts` (監視の開始・通知) / `frontend/src/utils/externalChangeNotice.ts` (全体の知らせ) / `frontend/src/hooks/useResourceEditor.ts` (編集画面の読み直し・帯)
