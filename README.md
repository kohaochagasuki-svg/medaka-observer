# めだかラボ — メダカの活動量・観察準備アプリ

高校の生物探究で使う、HTML・CSS・JavaScriptだけのWebアプリです。対象はGoogle Pixel 8aのChrome。ビルドや有料API、サーバー処理、外部CDNは不要です。

## 今回できること

- スマホに保存した動画を選択（MP4 / WebMなど、Chromeで再生できる形式）
- 再生・一時停止・シーク・5秒送り／戻し・再生速度変更
- 動画の上に中央線を表示（縦線／横線）
- 中央線を指で移動、スライダーで調整、中央に戻す、表示切替
- 観察日、水温、匹数、明るさ、その他の条件、観察メモの入力
- 観察条件・メモ・中央線設定を同じブラウザに自動保存／復元
- スマホの縦画面・横画面に合わせた表示

動画は `URL.createObjectURL(file)` で端末内再生します。動画そのものはアップロード・保存しません。選び直すと古いURLを解放します。動画を全量ArrayBufferにしたり、全フレームを配列に蓄積したりしません。再読込後は動画を選び直してください。

記録はこのブラウザのlocalStorageに**直近1件**だけ保存します。観察ごとの履歴機能はありません。別の端末や別のURLでは共有されません。ブラウザのデータ削除やシークレットモード終了で失われるため、大切な記録は別のノートにも控えてください。

## 未実装

メダカの自動検出・追跡、横断回数の自動計測、解析の進捗表示・中止、誤検出の確認・修正、測定結果のCSV保存は**未実装**です。画面にも「未実装」と表示しています。解析開始ボタンや架空の測定結果は表示しません。

## ファイル

| ファイル | 用途 |
| --- | --- |
| `index.html` | 日本語の画面 |
| `styles.css` | スマホ対応のレイアウト |
| `app.js` | 動画操作、中央線、端末保存 |
| `icon.svg` | アプリのアイコン |
| `tests/app.test.cjs` | DOM環境での動作テスト |
| `docs/verification.md` | 確認結果とPixel実機チェック項目 |
| `docs/architecture.md` | 省メモリ設計と将来の解析設計 |
| `docs/pixel-local-check.md` | 公開せずにPixelのChromeで確認する手順 |

本番で必要なのは最初の4ファイルだけです。テスト用のNode.js／npm／jsdomは、アプリの使用には必要ありません。

## GitHubで変更を確認する

実装用ブランチは `codex/medaka-observation-setup`、マージ先は `main` です。Pull Requestの **Files changed** で差分を確認できます。PRの作成だけでは `main` に取り込まれません。実機で確認後、GitHub上で **Merge pull request** を選んでください。

Cloudflare Pagesを含め、ホスティングへの公開操作は保留しています。現在のリポジトリは非公開です。無料のGitHub Pagesを使うために公開設定を変える必要はありません。Pixelでの確認は下記の端末内起動で行えます。

## スマホだけでファイルを追加・編集する場合

対象リポジトリ：<https://github.com/kohaochagasuki-svg/medaka-observer>

1. この作業で用意したソースZIPをPixelにダウンロードし、「Files」アプリで展開します。
2. Chromeで上記GitHubリポジトリを開き、ログインします。必要に応じてChromeメニューから「PC版サイト」を有効にします。
3. ブランチメニューで既定ブランチから `feature/observation-setup` などの作業ブランチを作ります。
4. **Add file → Upload files** で、展開したソースをアップロードします。`index.html`、`styles.css`、`app.js`、`icon.svg` はリポジトリ直下に置きます。`node_modules` と観察動画はアップロードしません。既存のREADMEは今回の内容に更新します。ZIPそのものをアップロードしてもアプリとして公開できません。
5. 変更内容を確認し、「動画観察と中央線調整を実装」などのメッセージで **Commit changes** します。
6. **Compare & pull request** から既定ブランチへのPull Requestを作成し、差分を確認してマージします。

すでにPRに含まれているファイルを再アップロードする必要はありません。この手順は追加修正や、CodexからGitHubへ書き込めない場合の代替です。

以降はGitHubのファイル編集、またはURLの `github.com` を `github.dev` に置き換えたWebエディターで変更し、コミットできます。スマホではPC版サイト表示を使うと操作しやすくなります。アプリのために有料開発環境を用意する必要はありません。

### Gitコマンドを使える場合

別の環境で変更を加える場合の例です。

```sh
cd /workspace/medaka-observer
git switch -c feature/observation-setup
git add index.html styles.css app.js icon.svg README.md .gitignore package.json package-lock.json tests docs
git commit -m "動画観察と中央線調整を実装"
git push -u origin feature/observation-setup
```

その後、GitHub上でPull Requestを作成します。認証が必要な場合は自分のGitHubアカウントを使ってください。トークンをソースに書き込まないでください。

## 公開せずにPixel 8aで確認する

[端末内での起動手順](docs/pixel-local-check.md) に従って、無料のTermuxでローカルサーバーを起動します。GitHubのZIPをダウンロードして使うので、スマホ側でGitの認証設定をする必要はありません。

GitHubのファイル表示やRaw画面はアプリの実行画面ではありません。AndroidでHTMLファイルを直接開く方法はCSS・JavaScriptの読み込み制限があるため、ローカルHTTPで確認します。

1. Chromeで `http://127.0.0.1:8000` を開き、短いMP4を選びます。再生・一時停止・シークが動くことを確認します。
2. 中央線を指で移動し、縦／横切替、位置スライダー、中央に戻す、表示切替を試します。
3. 縦長動画と横長動画をそれぞれ読み込み、線が映像内に重なることを確認します。スマホを回転して表示を確認します。
4. 条件とメモを入力し、再読み込みで復元されることを確認します。動画は再選択が必要です。
5. 30分の実際の撮影動画で、読み込み・途中へのシーク・再生・動画変更を試します。高解像度／高ビットレート動画の負荷は実機で確認してください。

## 開発時の自動確認

Node.js 22以降を使用します（確認環境はNode.js 24）。

```sh
npm ci
npm run check
```

JavaScript構文確認と6件のDOMテストを実行します。これは本物の動画デコード、指操作、画面表示、実機メモリ計測の代わりにはなりません。結果と残る確認事項は [動作確認記録](docs/verification.md) に記載しています。
