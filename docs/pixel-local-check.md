# Pixel 8aのChromeで動作確認する（公開不要）

無料のTermuxとPythonを使って、**Pixel自身の中だけ**でアプリを起動します。Cloudflare PagesやGitHub Pagesの設定は不要です。GitHubリポジトリは非公開のまま使えます。

## 1. PRのソースをダウンロードする

1. PixelのChromeでGitHubにログインし、[実装ブランチ](https://github.com/kohaochagasuki-svg/medaka-observer/tree/codex/medaka-observation-setup) を開きます。
2. **Code → Download ZIP** を選びます。表示されない場合はChromeのメニューで「PC版サイト」を有効にします。
3. ZIPは通常「ダウンロード」に保存されます。**ZIPを展開せずに**次へ進んで構いません。

このブランチからダウンロードすれば、PRをマージする前に確認できます。マージ後に最新コードを確認する場合は `main` のZIPをダウンロードしてください。

## 2. Termuxを用意する（最初の1回）

1. [F-DroidのTermux公式配布ページ](https://f-droid.org/packages/com.termux/) からTermuxのAPKをダウンロードし、インストールします。F-Droidアプリ自体のインストールは必須ではありません。Androidから求められた場合は、今回のインストールに使うChromeなどにインストールを許可します。
2. Termuxを開き、次のコマンドを1行ずつ実行します。初回はインターネット接続が必要です。続行確認には `y` を入力します。

```sh
pkg update
pkg install python
termux-setup-storage
```

3. Androidがファイルアクセスの許可を求めたら許可します。これでTermuxから `~/storage/downloads` にあるZIPを読めます。

## 3. ZIPを展開して起動する

Termuxに以下を**まとめて貼り付けて**実行します。Download ZIPが生成する、ファイル名が `medaka-observer` で始まるZIPを対象にします。同名ZIPを複数回ダウンロードした場合は、最も新しいものを使います。最新版以外の内容を試す場合は不要なZIPを先に整理してください。

```sh
python - <<'PY'
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

downloads = Path.home() / 'storage' / 'downloads'
archives = list(downloads.glob('medaka-observer*.zip'))
if not archives:
    raise SystemExit('medaka-observerのZIPがダウンロードに見つかりません。手順1を確認してください。')
archive = max(archives, key=lambda p: p.stat().st_mtime)
target = Path.home() / 'medaka-observer-local'
target.mkdir(exist_ok=True)
needed = {'index.html', 'styles.css', 'app.js', 'icon.svg'}
with ZipFile(archive) as bundle:
    entries = {}
    for item in bundle.infolist():
        parts = PurePosixPath(item.filename).parts
        if len(parts) == 2 and parts[1] in needed:
            entries[parts[1]] = item
        elif len(parts) == 1 and parts[0] in needed:
            entries[parts[0]] = item
    if set(entries) != needed:
        raise SystemExit('必要な4ファイルがそろっていません。実装ブランチのZIPを取得してください。')
    for name, item in entries.items():
        (target / name).write_bytes(bundle.read(item))
print('準備できました:', archive.name)
PY
```

続いて実行します。

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory ~/medaka-observer-local
```

`Serving HTTP on 127.0.0.1 port 8000` のような表示になったら、Termuxはそのまま開いておきます。待機状態になるのは正常です。AndroidからTermuxのバックグラウンド動作制限を案内された場合は、確認中に停止しないよう設定してください。

## 4. Chromeで開く

Chromeのアドレス欄に **`http://127.0.0.1:8000`** を入力します。検索欄ではなくURLとして開いてください。これはPixel自身のアドレスで、外部公開URLではありません。サーバーはこの端末からだけ接続できるように設定しています。

動画や観察条件はGitHubにもローカルサーバーにも送信しません。サーバーが配信するのはアプリの4ファイルです。

| 操作 | 確認すること |
| --- | --- |
| 短いMP4を選択 | 映像と再生時間が表示される |
| 再生・一時停止・シーク | 動作とボタンの表示が一致する |
| 動画上の中央線を指で動かす | 線と位置の%が変わる |
| 縦／横・表示切替・中央に戻す | 選んだ設定が映像に反映される |
| 縦長動画・画面回転 | 線が映像の余白を除いた範囲に重なる |
| 条件とメモを入力し再読み込み | 入力内容が復元される。動画は再選択する |
| 30分動画を読み込み・シーク・再生 | 読み込み時間、停止や発熱の有無を確認する |
| 別の動画へ変更 | 新しい動画が再生され、古い動画は停止する |

同じChrome・同じ `http://127.0.0.1:8000` を使うと、保存した観察条件を引き継げます。`localhost` に変えたりポートを変更したりすると、保存先は別扱いです。

## 終了・再開・更新

- 終了：Termuxに戻り、画面の追加キーにある **CTRL** と **C** を押してサーバーを停止します。
- 再開：手順3の最後の `python -m http.server ...` をもう一度実行します。ZIPの再展開やPythonの再インストールは不要です。
- コード更新：最新ZIPをダウンロードし、サーバー停止後に手順3からやり直します。Chrome側で再読み込みしてください。表示が更新されない場合はChromeのシークレットタブで確認すると、既存の観察条件を消さずに比較できます。
- 起動できない：Termuxのサーバーが動いているか、URLの `http`・IP・ポート番号が一致しているか確認してください。`Address already in use` は、すでにサーバーが起動している可能性があります。

この手順は実機でまだ検証していません。結果は [動作確認記録](verification.md) の未確認項目に沿って記録してください。自動解析やCSV保存のボタンがないのは、今回の実装範囲どおりです。
