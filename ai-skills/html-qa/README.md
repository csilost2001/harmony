# html-qa の使い方 (利用者向け)

AI が質問や説明を、ブラウザで読んで答える画面にしてくれます。答えて **「AI に送る」** を押すと、チャットに何も書かなくても AI が受け取って続きを始めます。AI 向けの手順は [SKILL.md](SKILL.md)。

## 仕組み

```
ブラウザ ──「AI に送る」──▶ 表示サーバ ──書く──▶ 回答ファイル ◀──見張る── 待ち受け (AI が裏で動かす)
                                                                         │ 終わると
                                                                         ▼
                                                              Claude Code が続きを始める
```

| 部品 | 誰が動かすか | 役割 |
|---|---|---|
| 表示サーバ (`scripts/serve.mjs`) | **あなた** | 画面を開けるようにし、送った回答をファイルに書く |
| 待ち受け (`scripts/wait.mjs`) | AI (毎回、自動で) | 回答ファイルができたら AI に知らせる |
| hook (`scripts/hook-inject.mjs`) | Claude Code (登録した場合) | 待ち受けが動いていなかったとき、次にチャットで何か発言したときに、未読の回答を添える |

## 使い始める

1. 表示サーバを起動する。どちらか:
   - VS Code の「ターミナル → タスクの実行 → **html-qa: 表示サーバ**」
   - ターミナルで `node ai-skills/html-qa/scripts/serve.mjs`

   止めるときは、そのターミナルで Ctrl+C。
2. AI がチャットに出す URL (`http://localhost:5190/…/?key=…`) を開く。一度開けば、そのブラウザは鍵を覚える (30 日)。
3. 答えて「AI に送る」(Ctrl+Enter)。画面の下に「AI が受け取りました ✓」と出れば届いている。

議題の一覧は `http://localhost:5190/`。

## 鍵

表示サーバは、鍵 (`.tmp/html-qa/.key`、32 文字の乱数) を持たない接続を断ります。ポート転送を通ると、どの接続も「同じ PC から」に見えるため、送信元では見分けられないからです。

- 鍵を作り直す: `node ai-skills/html-qa/scripts/serve.mjs --new-key` (それまでのブラウザ・スマホは開き直しが要る)
- 鍵は git に入りません (`.tmp/` は対象外)

## スマホから答える (家庭内 LAN)

作業場所はコンテナの中にあり、ポートは PC の中 (localhost) にだけ転送されています。スマホから開くには、**PC の 5191 番を、localhost の 5190 番へつなぐ** 設定を Windows に 1 回入れます。

1. **PowerShell を管理者で** 開き、次を実行する:

   ```powershell
   netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=5191 connectaddress=127.0.0.1 connectport=5190
   New-NetFirewallRule -DisplayName "html-qa (5191)" -Direction Inbound -Protocol TCP -LocalPort 5191 -Action Allow -Profile Private
   ```

2. PC の IP アドレスを調べる: `ipconfig` の「IPv4 アドレス」(Wi-Fi か イーサネット。例 `192.168.1.10`)
3. 表示サーバを一度、次のように起動して URL を登録する (以後は普通に起動してよい):

   ```bash
   node ai-skills/html-qa/scripts/serve.mjs --lan-url http://192.168.1.10:5191
   ```

   以後、AI は `スマホ (家庭内 LAN): http://192.168.1.10:5191/…/?key=…` の URL も出します。
4. スマホで、その URL を開く (同じ Wi-Fi に入っていること)

- PC のブラウザで URL を開き、Chrome / Edge の「QR コードを作成」を使うと、スマホで読み取るだけで開ける
- Windows の「ネットワーク」が **プライベート** になっていること (パブリックだと、上のファイアウォールの設定が効かない)
- やめるとき:

  ```powershell
  netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=5191
  Remove-NetFirewallRule -DisplayName "html-qa (5191)"
  ```

  登録した URL を消す: `node ai-skills/html-qa/scripts/serve.mjs --lan-url off`

> VS Code の設定 `remote.localPortHost` を `allInterfaces` にしても LAN から開けますが、**転送しているすべてのポート** (Harmony の backend 5179 など) が LAN に出ます。backend は初期設定では接続トークンが無く、設計を書き換えられる MCP まで LAN から使えてしまうため、勧めません。上の方法は 5191 番だけを開きます。

PC の IP アドレスがルーターの都合で変わると、URL も変わります (変わったら手順 3 をやり直す)。ルーターで PC の IP を固定しておくと楽です。

## Remote Control と組み合わせる

Claude Code の Remote Control (スマホの Claude アプリから、PC で動いているセッションを操作する) と組み合わせると、ソファでも答えられます。

1. スマホの Claude アプリで、そのセッションを開く
2. AI がチャットに出した **スマホ用の URL** をタップして答える
3. 「AI に送る」→ PC の AI が自動で続きを始め、その様子が Remote Control に出る

Remote Control そのものはチャットだけを中継するので、画面を開けるのは **家庭内 LAN にいるとき** だけです (家の外からは開けない)。

## hook とサーバの自動起動

どちらも、このリポジトリでは設定済みです。

- **hook** (`.claude/settings.json` の `UserPromptSubmit`): 書き換えた時点で効きます (再起動は不要)。未読の回答が無ければ何もしません
- **サーバの自動起動** (`.vscode/tasks.json` の `"runOn": "folderOpen"`): 動かすには、**自分の PC の VS Code のユーザー設定** で `task.allowAutomaticTasks` を `on` にする必要があります
  - 設定画面 (Ctrl+,) で `task.allowAutomaticTasks` を検索して「on」にする。または「基本設定: ユーザー設定を開く (JSON)」で `"task.allowAutomaticTasks": "on"` を足す
  - この設定は VS Code の決まりで **ユーザー設定にしか書けません** (ワークスペースの `.vscode/settings.json` やコンテナ側の設定に書いても無視される。勝手にコードを動かされないための守り)
  - on にしたあと、フォルダを開き直すとサーバが起動します (ターミナルの「html-qa: 表示サーバ」)
  - on にすると、ほかのプロジェクトの自動タスクも動くようになります。信頼していないフォルダ (制限モード) では動きません

AI がこうした設定を自分で入れようとすると、Claude Code の auto mode が「AI 自身の設定の変更」「常駐する仕組みの追加」として止めます。入れるときは、チャットで変更を名指しして頼みます。
