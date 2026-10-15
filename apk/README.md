# apk/ - Android APK ビルド

`app/`（ビルドなしの静的ファイル）を [Capacitor](https://capacitorjs.com/) の WebView に同梱して APK にする。アプリ本体（`app/`）へ依存は追加しない。APK 用の依存は `apk/package.json` に閉じる。方式はD-002の「PWAを後から包む」のうち、ホスティングに依存しない Capacitor を採用（TWA はプロジェクトサイトで URL 検証ができず URL バーが残るため見送り）。

- アプリ ID: `io.github.nagamaki0311.sf6memo`（変更すると別アプリ扱いになり、保存データが引き継がれない）
- 画面向き: 縦固定。ステータスバー/ナビゲーションバー背景: `#16140F`
- オリジンは `https://localhost`（`capacitor.config.json` の `androidScheme`）。localStorage はこのオリジンに保存され、アプリを更新しても残る。アンインストールすると消える
- minSdk 24（Android 7.0）、targetSdk 36。Java 21、Node 22、Android SDK `platforms;android-36` と `build-tools;36.0.0` が要る
- アイコンとスプラッシュは暫定（`#16140F` 地に黄色い円）。デザイン刷新後に `android/app/src/main/res/` の `mipmap-*/ic_launcher*.png`、`drawable-v24/ic_launcher_foreground.xml`、`values/ic_launcher_background.xml` を差し替える

## ダウンロードリンク（GitHub Release）

タグ `v*` を push すると `.github/workflows/apk.yml` が APK をビルドして Release に添付する。常に最新を指すリンク:

```
https://github.com/Nagamaki0311/strategy-memo/releases/latest/download/sf6memo.apk
```

リポジトリを公開しておくこと（非公開だとログインしていない端末からダウンロードできない）。GitHub Pages の有効化は不要。端末で APK を開き、「提供元不明のアプリ」のインストールを許可してインストールする。

## ユーザーが行う設定

1. リポジトリを公開にする。
2. リリース署名の鍵を作り、Secrets に登録する（初回配布の前に行う。下記「署名」）。
3. タグを打つ: `git tag v0.1.0 && git push origin v0.1.0`。または Actions タブから `apk` を手動実行（Release は作られず、アーティファクト `sf6memo-apk` だけができる）。

## 署名

署名鍵が Android の更新可否を決める。**署名が違う APK は上書きインストールできず、アンインストールが要る。アンインストールすると端末内のデータ（localStorage）が消える**。

- 鍵を登録しないと、Actions は実行ごとに新しいデバッグ鍵で署名する。毎回署名が変わるため、2 回目以降は上書き更新できない。試し用にだけ使う。
- 配布するなら先にリリース鍵を作る。鍵とパスワードは紛失すると更新できなくなるので、リポジトリ外にバックアップする。リポジトリにはコミットしない。

```
keytool -genkeypair -keystore release.jks -alias sf6memo -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.jks     # この出力を ANDROID_KEYSTORE_BASE64 に登録する
```

Settings > Secrets and variables > Actions に次の 4 つを登録する。

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `release.jks` を base64 にした文字列 |
| `ANDROID_KEYSTORE_PASSWORD` | キーストアのパスワード |
| `ANDROID_KEY_ALIAS` | 上の例では `sf6memo` |
| `ANDROID_KEY_PASSWORD` | 鍵のパスワード |

`versionCode` は Actions の実行番号、`versionName` はタグ（`v0.1.0` なら `0.1.0`）から自動で決まる。

## ローカルでビルドする

```
cd apk
npm ci
export ANDROID_HOME=<Android SDK のパス>
npm run build:debug      # android/app/build/outputs/apk/debug/app-debug.apk
npm run build:release    # android/app/build/outputs/apk/release/app-release.apk（KEYSTORE_FILE 等の環境変数が無ければデバッグ署名）
```

どちらも `cap sync` で `app/` を `android/app/src/main/assets/public/` へコピーしてからビルドする（コピーは gitignore 済み）。`app/` を変えたら再ビルドするだけでよい。リリース鍵を使うときの環境変数は `KEYSTORE_FILE`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`（`android/app/build.gradle` が読む）。

## 更新方法

- アプリを更新する: `app/` を変更して新しいタグを打つ。同じ署名なら上書きインストールでき、データは残る。
- Capacitor を更新する: `npm install @capacitor/cli@latest @capacitor/core@latest @capacitor/android@latest`（plugin も同様）の後、`npx cap migrate` の案内に従う。

## アプリ側の注意: JSON の書き出し（docs/requirements.md の書き出し機能、T-012）

Android の WebView では `<a download>`、Blob ダウンロード、`navigator.share` が使えない。APK には `@capacitor/filesystem` と `@capacitor/share` を含めてある。アプリ側は `window.Capacitor?.isNativePlatform?.()` が真のときだけ次の経路で書き出し、偽（ブラウザ/PWA）のときは従来の経路を使う。`import` は不要で、ネイティブ側が注入する `window.Capacitor.Plugins` から呼べる。

```js
// text: JSON.stringify(exportDoc(data))。ファイル名は例。MIME は application/json
async function exportNative(text, filename = 'sf6-memo.json') {
  const { Filesystem, Share } = window.Capacitor.Plugins;
  const { uri } = await Filesystem.writeFile({
    path: filename, data: text, directory: 'CACHE', encoding: 'utf8', // Directory.Cache / Encoding.UTF8 の値
  });
  await Share.share({ title: filename, files: [uri], dialogTitle: '書き出し' }); // 共有シートから「ドライブに保存」等を選ぶ
}
```

- `Share.share` はユーザーが共有シートを閉じると reject する（`Share canceled`）。キャンセルは失敗として扱わない。
- 共有先には MIME が `application/json` として渡る（拡張子から判定）。
- 読み込み（JSON の取り込み）は `<input type="file">` が WebView でも動くため、追加の経路は要らない。実機で未確認。
