# Classroom Helper

Google Classroom の学習・授業閲覧を効率化する Chrome 拡張です。

このリポジトリは、Classroom の中で繰り返し発生する作業を小さく自動化していくためのものです。現在は、動画の文字起こしコピーと、添付資料の直接ダウンロード補助に対応しています。

## 現在の機能

- Google Classroom から開いた Google Drive / YouTube 動画を検出
- Google Drive の mp4 文字起こしサイドバーから、各セグメントの時刻と本文を取得
- コピー形式は常に `[0:04] 本文...` のようなタイムスタンプ付きテキスト
- Drive の「文字起こし」ボタンが動画再生後に有効化されるケースを考慮して再スキャン
- 最後にコピーした文字起こしの再コピー
- Classroom の添付資料カード右上にダウンロードアイコンを追加
- Drive 上の PDF / Office ファイルなどは、別タブで開かずに直接ダウンロードを開始
- Google ドキュメント / スプレッドシート / スライド / 図形描画は、ダウンロード可能な形式に変換して保存
- 優先言語、ページ上の結果表示、自動コピーの設定

## インストール

1. Chrome で `chrome://extensions` を開く。
2. 右上の「デベロッパー モード」を有効にする。
3. 「パッケージ化されていない拡張機能を読み込む」を押す。
4. このリポジトリのフォルダを選ぶ。

更新後は `chrome://extensions` でこの拡張の更新ボタンを押し、対象の Classroom / Drive タブを再読み込みしてください。

## 使い方

### 文字起こしコピー

1. Google Classroom から動画添付を開く。
2. Drive または YouTube の動画ページで文字起こしが検出されると、自動でコピーされます。
3. Drive の mp4 では、動画の再生後に「文字起こし」ボタンが有効になることがあります。その場合は拡張が再スキャンし、サイドバー表示後にコピーします。
4. 拡張アイコンのポップアップから、再スキャン、最後の文字起こしの再コピー、履歴消去、優先言語などを操作できます。

### 添付資料の直接ダウンロード

1. Classroom の課題詳細や投稿を開く。
2. ダウンロード可能な添付資料カードの右上にダウンロードアイコンが表示されます。
3. アイコンを押すと、別タブで Drive / Docs を開かずにダウンロードが始まります。

Google フォームや Drive フォルダなど、単一ファイルとして直接保存できない添付にはボタンを表示しません。

## コピー形式

```text
[0:04] 一言に老後資金と言っても...
[0:12] 理想の生活水準、家族との距離感...
```

タイムスタンプは後から動画の該当箇所へ戻れるよう、常に含めます。

## 対応範囲

- Classroom: Classroom ページ内の添付リンク、または Classroom から開いた動画ページ
- Google Drive: mp4 の文字起こしサイドバー、HTML text track
- YouTube: 字幕トラックまたは表示中の文字起こし UI
- 添付資料ダウンロード: Drive ファイル、Google ドキュメント、スプレッドシート、スライド、図形描画

文字起こしが生成されていない動画、閲覧権限がない動画、組織設定で文字起こしが無効化されている動画では取得できません。
添付資料についても、閲覧権限がないファイルや Google 側で直接ダウンロードできない種類の添付は保存できません。

## 実装メモ

- Manifest V3 の Chrome 拡張です。
- content script 共通処理は `src/content/shared.js` に集約しています。
- 動画文字起こしの検出処理は `src/content/transcript.js` で行います。
- Classroom 添付資料のボタン表示は `src/content/attachments.js` で行います。
- background のメッセージ分岐は `src/background/router.mjs` で扱います。
- background 側の設定初期値とマイグレーションは `src/shared/settings.mjs` に分離しています。
- Drive / Docs の直接ダウンロード URL 変換は `src/background/attachment-downloads.mjs` に分離しています。
- クリップボード書き込みは `src/background.js` から Offscreen Document に委譲します。
- 添付資料の保存は `src/background.js` から `chrome.downloads.download` を呼び出します。
- 設定と最後のコピー結果は Chrome storage に保存します。
- 外部サーバーへ文字起こし内容を送信しません。

### 機能追加の目安

- Classroom の画面に UI を足す機能は `src/content/` に機能別ファイルを追加します。
- content script で共通利用する設定取得、DOM判定、toast、時刻処理は `src/content/shared.js` に追加します。
- background で権限 API を使う処理は `src/background.js` に handler を作り、`createMessageRouter` の routes に message type を追加します。
- Drive / Docs / URL 変換のように単体でテストしやすい処理は `src/background/*.mjs` または `src/shared/*.mjs` に分離します。
- 新しい設定を追加する場合は `src/content/shared.js` と `src/shared/settings.mjs` の初期値、必要に応じて popup を更新します。

## 検証

```bash
node --check src/content/transcript.js
node --check src/content/attachments.js
node --check src/content/shared.js
node --check src/background.js
node --check src/background/router.mjs
node --check src/background/attachment-downloads.mjs
node --check src/shared/settings.mjs
node --check popup/popup.js
node --check offscreen/offscreen.js
python3 -m json.tool manifest.json >/dev/null
```

Chrome がインストールされている環境では、次のようにパッケージ化チェックもできます。

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --pack-extension=/path/to/Classroom_ext
```
