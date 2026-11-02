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

議題の一覧は `http://localhost:5190/`。題名・質問・回答の文字で探せて、「回答待ち」「回答済み」で絞れます (空白で区切ると、すべてを含むものだけに絞ります)。

## 会議で使う (発表モード)

上の帯の **「発表」** を押すと、1 枚ずつ大きく表示します (表紙 → 各章 → 全体へのコメント)。

| 操作 | 動き |
|---|---|
| `→` `PageDown` `Space` / 画面右の `›` / 左へスワイプ | 次へ |
| `←` `PageUp` `Shift+Space` / `‹` / 右へスワイプ | 前へ |
| `Home` `End` | 最初・最後へ |
| `Esc` / 「発表を終える」 | 終わる |

質問には発表中も答えられます (入力欄にいる間は矢印を奪いません)。F5 で更新しても同じ画面に戻り、URL の `#present-3` のような部分を開くと、その章から始まります (章を進めても履歴は増えないので、ブラウザの「戻る」は発表ではなく前のページへ戻ります)。印刷すると全章が出ます。

## 版の違いを見る

同じ議題で v2 以降を開くと、「これまでに決まったこと」の下に **「v1 からの変化」** が出ます。増えた質問 (クリックでその質問へ)・消えた質問 (前の版で答えた内容つき)・変わった質問・増えた決定が分かります。比べる版は選べます。質問の見出しと目次には「新規」「変更」の印が付きます。

## 図 (Mermaid)

AI が流れ図などを `mermaid` の図で出すことがあります。描画部品をネット (cdn.jsdelivr.net) から読むので、**ネットにつながっていないと図にならず、書き方が文字のまま出ます**。

## ハブ: 複数のプロジェクトの議題を 1 か所で見る

プロジェクト (開発コンテナ) ごとに表示サーバを立てる代わりに、**いまの表示サーバ 1 つ (ハブ) に全プロジェクトの議題を預けられます**。Windows の転送も 5190 (スマホ用 5191) のままで、増やすものはありません。

```
プロジェクト A のコンテナ ─ build.mjs ──議題を送る──▶                      ◀──ブラウザ (PC / スマホ)
プロジェクト B のコンテナ ─ build.mjs ──議題を送る──▶   ハブ (serve.mjs)   ─ 回答を保存
                          ◀─ wait.mjs ─回答をポーリング─                    http://localhost:5190/<project>/<topic>/
```

- 画面の URL: PC は `http://localhost:5190/<project>/<topic>/?key=…`、スマホは `http://<PC の IP>:5191/<project>/<topic>/?key=…`。`/` は全プロジェクトの議題の一覧 (プロジェクトごとに分かれ、回答待ち / 回答済みで絞れる)、`/p/<project>/` はそのプロジェクトだけの一覧 (`/<project>/` でも開けますが、ハブ自身の議題と同名だと、そちらが開くため)
- ハブ自身のプロジェクトは、これまでどおり `/<topic>/` で開けます
- 鍵はハブに 1 つ (`.tmp/html-qa/.key`)。ブラウザの cookie も 1 つなので、プロジェクトをまたいで開いても鍵が上書きされません
- プロジェクト名・議題名は英小文字・数字・ハイフンで 41 文字まで。プロジェクト名に `api` `p` `projects` は使えません

### 使い始める (1 回だけ)

**ハブは WSL ホスト (開発コンテナの外) で動かすのが標準です。** コンテナの中で動かした `serve.mjs` はそのコンテナの `127.0.0.1` で待つので、VS Code の転送では PC から開けても、別のコンテナの `host.docker.internal:5190` からは届きません。なお Harmony 本体のコンテナの中の AI は、ハブと同じファイル (`.tmp/html-qa/`) を直接読み書きするので、**ハブへの登録は要りません**。

1. **ホストでハブを起動する** (止めて起動し直す場合は Ctrl+C のあと `node ai-skills/html-qa/scripts/serve.mjs`)。起動時に、ハブの鍵を **共有の場所** `~/.agent-containers/.shared/html-qa/hub.key` に書きます (フォルダ 0700・ファイル 0600。書けなければ `△` を出して続け、鍵を画面に出す従来の案内にします)。場所を変える・書かないのは `--key-export <ファイル | off>`。`--new-key` で鍵を作り直すときも書き直します
2. 開発コンテナには、generate-code の雛形 (4 種) がこの場所を `~/.html-qa-shared/` に **読み取り専用** で mount します (`initializeCommand` が無ければ作ります)。すでにあるコンテナは、雛形の `devcontainer.json` の `mounts` と `initializeCommand` を足して、コンテナを作り直してください。mount が無い環境では、下の「手で鍵を渡す」を使います
3. 預けたいプロジェクトで、**鍵なしで** 1 回だけ登録します (`<プロジェクト名>` は例 `tax-app`)

   ```bash
   node ai-skills/html-qa/scripts/build.mjs --hub-url http://host.docker.internal:5190 --project tax-app
   ```

   - 鍵の探し方は、`--hub-key` → `--hub-key-file` → 環境変数 `HTML_QA_HUB_KEY` → **共有の場所** の順です。共有の場所は、`HTML_QA_HUB_KEY_FILE` で指すファイル、なければ `~/.html-qa-shared/hub.key`、なければ `~/.agent-containers/.shared/html-qa/hub.key`
   - 共有の場所から読んだときは、`.hub.json` に **鍵を保存せず**、毎回その場所から読みます。ハブの鍵を作り直しても登録し直しは要りません (401 のとき、共有の鍵が変わっていれば 1 回だけ読み直してやり直します)
   - `--hub-url` の `host.docker.internal:5190` は **環境で変わります** (ハブのポートを変えた・コンテナからの経路が違う、など)。起動時の表示にある URL を使ってください
   - `.tmp/html-qa/.hub.json` に保存されます (git には入りません)。以後 `build.mjs` / `wait.mjs` は自動でハブを使い、省略できます。解除は `build.mjs --hub off`
4. あとは同じです。AI が `build.mjs` を実行すると議題がハブに送られ、AI が出す `開く:` / `スマホ (家庭内 LAN):` の URL がハブのものになります

**鍵の扱い (注意)**: 鍵は git に入れない・チャットに貼らない。共有の場所はホームの下で、**同じ PC の中だけ** で使います。**共有 PC では、雛形の mount (と `initializeCommand` の html-qa の行) を外し**、ハブも `--key-export off` で起動してください (同じ PC の別の利用者や、ほかのコンテナから鍵を読めないようにするため)。

**手で鍵を渡す** (共有の場所が使えないとき): ハブの起動時の表示にある鍵を、コマンドの引数に書かず環境変数で渡すと、シェルの履歴や `ps` に残りません。

```bash
read -rs HTML_QA_HUB_KEY && export HTML_QA_HUB_KEY     # ハブの鍵を貼り付けて Enter (画面には出ません)
node ai-skills/html-qa/scripts/build.mjs --hub-url http://host.docker.internal:5190 --project tax-app
```

環境変数のかわりに、鍵を書いたファイルを `--hub-key-file <ファイル>` で、標準入力を `--hub-key-file -` で渡せます。`--hub-key <鍵>` も使えますが、履歴と `ps` に鍵が残ります。この場合は `.hub.json` に鍵を保存するので、ハブの鍵を作り直した (`serve.mjs --new-key`) ときは登録し直してください。

ハブに届かないときは、ローカルの HTML は作られたうえで `△ ハブに送れませんでした: …` と理由が出ます (ハブが起動していない / URL が違う / 鍵が違う)。

### `host.docker.internal` で届かないとき

ハブは既定で `127.0.0.1` だけで待ちます (同じ PC の中からだけ)。別のコンテナから届くかは、ハブをどこで動かしているか・Docker の設定に依ります。プロジェクトのコンテナの中で確かめます。

```bash
curl -s -H "X-Html-Qa-Key: $HTML_QA_HUB_KEY" http://host.docker.internal:5190/api/ping    # {"ok":true} が返れば届いています
```

返らないときの確認:

| 見るところ | 確かめること |
|---|---|
| ハブが動いているか | ハブを動かしている側で `curl -s -H "X-Html-Qa-Key: …" http://localhost:5190/api/ping`。動いていなければ起動する |
| VS Code のポート転送 | 「ポート」タブで、ハブのポートが転送されているか。転送先は PC の `localhost` だけなので、コンテナから見える保証はありません |
| Docker Desktop の設定 | `host.docker.internal` が PC を指しているか (Windows / Mac の Docker Desktop では既定で有効。Linux の Docker は `--add-host=host.docker.internal:host-gateway` が要ります) |
| 待ち受けの範囲 | ハブを `--host 0.0.0.0` で起動すると、PC のすべての経路 (LAN を含む) から届くようになります。`node ai-skills/html-qa/scripts/serve.mjs --host 0.0.0.0` |

`--host 0.0.0.0` の注意: 鍵が無い接続は断りますが、**家庭内 LAN の機器にもポートが見える**ようになります (鍵が漏れると、議題の閲覧・回答の送信・議題の預け入れができます)。信頼できるネットワークでだけ使い、鍵は他人に渡さないでください。通常は、Windows 側の 5191 → 5190 の転送 (後述) のように、必要な経路だけを開けるほうが安全です。

### 守り

- ハブへの書き込み (議題を送る・待ち受けの合図・受け取りの印) は、ヘッダの鍵が無いと断ります (ブラウザの cookie だけでは書けません)。画面から回答を送る API は JSON の `Content-Type` が必須で、別のサイトからの送信 (CSRF) は成り立ちません (`Origin` も検査します)
- プロジェクト名・議題名・版は形を検査し、預かる場所 (`.tmp/html-qa/.hub/<project>/<topic>/`) の外へは書きません (`.hub` の中のリンクもたどりません)。議題の JSON は `build.mjs` と同じ検査をして、壊れた形は預かりません
- 上限: 1 版 16MB、1 議題 300 版、1 プロジェクト 200 議題、プロジェクト 50 個、**ハブ全体で 1GB** (超えると預かりません。古い議題は `.tmp/html-qa/.hub/` から消します)
- **全プロジェクトが 1 つの鍵を共有します。** 鍵を持つプロジェクトは、ほかのプロジェクトの名前でも議題を預けられる (上書きできる) ので、互いの領域を守る仕組みはありません
- **ハブは同じオリジン (同じ URL の入口) で、預かった HTML をすべて配ります。** プロジェクト A の HTML は、画面から B の回答を読んだり、B の議題に「利用者の回答」を送ったりできます (鍵そのものは読めません)。つまり、**A の議題を開くだけで、B の AI に偽の回答を渡せてしまいます**
  - 自分のプロジェクト同士で、HTML を自分の AI が作る使い方なら、許容できる範囲です
  - AI が外部の文書 (Web ページ・他人から届いた資料など) を読んで HTML を作るときは、その文書の指示が HTML に紛れ込む恐れがあります。そうした議題は、ハブに預けず従来の (プロジェクト内だけの) 使い方にするか、中身を確かめてから開いてください
  - 他人のプロジェクトを預かる運用には向きません (分けるなら、プロジェクトごとに別のハブ・ポートを動かします)

### すでに `.tmp/tools/html-qa/` に写して使っているプロジェクト

写した版にはハブの機能がありません。**`ai-skills/html-qa/` の中身 (scripts と assets の全部) を写し直してください** (`scripts/` に `hub.mjs` `hub-client.mjs` が増えています。一部だけ写すと動きません)。

```bash
rm -rf .tmp/tools/html-qa && mkdir -p .tmp/tools && cp -r <Harmony のリポジトリ>/ai-skills/html-qa .tmp/tools/html-qa
```

そのあと、上の「使い始める」の 2 を `.tmp/tools/html-qa/scripts/build.mjs` で実行します。

## 鍵

表示サーバは、鍵 (`.tmp/html-qa/.key`、32 文字の乱数) を持たない接続を断ります。ポート転送を通ると、どの接続も「同じ PC から」に見えるため、送信元では見分けられないからです。

- 鍵を作り直す: `node ai-skills/html-qa/scripts/serve.mjs --new-key` (それまでのブラウザ・スマホは開き直しが要る)
- 鍵は git に入りません (`.tmp/` は対象外)

## スマホから答える (家庭内 LAN)

(ハブを使うと、プロジェクトが増えても下の設定は **5191 → 5190 の 1 つだけ** で済みます。スマホ用 URL の元は、ハブの `--lan-url` に 1 回登録すれば、全プロジェクトの `スマホ (家庭内 LAN):` の行に使われます。)

作業場所はコンテナの中にあり、ポートは PC の中 (localhost) にだけ転送されています。スマホから開くには、**PC の 5191 番を、localhost の 5190 番へつなぐ** 設定を Windows に 1 回入れます。

### 0. 先に PC で開けることを確かめる

表示サーバを起動し、PC のブラウザで AI が出した `http://localhost:5190/…?key=…` が開けること。VS Code の「ポート」タブで、5190 の「転送されたアドレス」が `localhost:5190` になっていること (別の番号なら、下の `connectport=` をその番号にする)。

### 1. 管理者の PowerShell を開く

スタートボタンを **右クリック** →「ターミナル (管理者)」(Windows 10 は「Windows PowerShell (管理者)」) →「はい」。

### 2. つなぐ設定とファイアウォール (コピーして貼り付け)

```powershell
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=5191 connectaddress=127.0.0.1 connectport=5190
New-NetFirewallRule -DisplayName "html-qa (5191)" -Direction Inbound -Protocol TCP -LocalPort 5191 -Action Allow -Profile Private
```

確かめる: `netsh interface portproxy show v4tov4` に `0.0.0.0 5191 127.0.0.1 5190` の行が出れば OK。

### 3. ネットワークが「プライベート」か確かめる

```powershell
Get-NetConnectionProfile | Select-Object InterfaceAlias, NetworkCategory
```

家の Wi-Fi (またはイーサネット) が `Public` なら、プライベートにする (家庭内のネットワークだけ):

```powershell
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
```

(`"Wi-Fi"` は上で出た InterfaceAlias に合わせる)

### 4. PC の IP アドレスを調べる

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch "Loopback|vEthernet" } | Select-Object InterfaceAlias, IPAddress
```

`192.168.` で始まるものが、ふつう家庭内 LAN のアドレス (例 `192.168.1.10`)。

### 5. PC の上でつながるか試す

```powershell
Test-NetConnection -ComputerName 192.168.1.10 -Port 5191
```

`TcpTestSucceeded : True` なら OK。

### 6. スマホ用の URL を登録する

AI に「スマホの URL は http://192.168.1.10:5191」と伝える (AI が登録する)。自分でするなら、表示サーバを Ctrl+C で止めてから VS Code のターミナルで:

```bash
node ai-skills/html-qa/scripts/serve.mjs --lan-url http://192.168.1.10:5191
```

以後、AI は `スマホ (家庭内 LAN): http://192.168.1.10:5191/…/?key=…` の URL も出します。

### 7. スマホで開く

同じ Wi-Fi につないだスマホで、その URL を開く。PC のブラウザで URL を開いて Chrome / Edge の「QR コードを作成」を使うと、読み取るだけで開ける。

### うまくいかないとき

| 症状 | 確かめること |
|---|---|
| 手順 5 が False | `Test-NetConnection -ComputerName 127.0.0.1 -Port 5190` が True か (False なら表示サーバか VS Code の転送が止まっている)。`Get-Service iphlpsvc` が Running か (つなぐ設定はこのサービスで動く。止まっていれば `Start-Service iphlpsvc`) |
| 手順 5 は True だがスマホで開けない | スマホが同じ Wi-Fi か (ゲスト用 Wi-Fi は PC と分けられていることがある)。手順 3 がプライベートか。ほかのセキュリティソフトのファイアウォール |
| 「鍵が必要です」と出る | URL の `?key=…` まで含めて開く |

### やめるとき

```powershell
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=5191
Remove-NetFirewallRule -DisplayName "html-qa (5191)"
```

登録した URL を消す: `node ai-skills/html-qa/scripts/serve.mjs --lan-url off`

> VS Code の設定 `remote.localPortHost` を `allInterfaces` にしても LAN から開けますが、**転送しているすべてのポート** (Harmony の backend 5179 など) が LAN に出ます。backend は初期設定では接続トークンが無く、設計を書き換えられる MCP まで LAN から使えてしまうため、勧めません。上の方法は 5191 番だけを開きます。

PC の IP アドレスがルーターの都合で変わると、URL も変わります (変わったら手順 4〜6 をやり直す)。ルーターで PC の IP を固定しておくと楽です。

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
