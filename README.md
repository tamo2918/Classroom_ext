# Classroom Helper

Google Classroom の学習・授業閲覧を効率化する Chrome 拡張です。

このリポジトリは、Classroom の中で繰り返し発生する作業を小さく自動化していくためのものです。現在は最初の機能として、Classroom から開いた動画の文字起こしを検出し、タイムスタンプ付きテキストとしてクリップボードへ自動コピーします。

## 現在の機能

- Google Classroom から開いた Google Drive / YouTube 動画を検出
- Google Drive の mp4 文字起こしサイドバーから、各セグメントの時刻と本文を取得
- コピー形式は常に `[0:04] 本文...` のようなタイムスタンプ付きテキスト
- Drive の「文字起こし」ボタンが動画再生後に有効化されるケースを考慮して再スキャン
- 最後にコピーした文字起こしの再コピー
- 優先言語、ページ上の結果表示、自動コピーの設定

## インストール

1. Chrome で `chrome://extensions` を開く。
2. 右上の「デベロッパー モード」を有効にする。
3. 「パッケージ化されていない拡張機能を読み込む」を押す。
4. このリポジトリのフォルダを選ぶ。

更新後は `chrome://extensions` でこの拡張の更新ボタンを押し、対象の Classroom / Drive タブを再読み込みしてください。

## 使い方

1. Google Classroom から動画添付を開く。
2. Drive または YouTube の動画ページで文字起こしが検出されると、自動でコピーされます。
3. Drive の mp4 では、動画の再生後に「文字起こし」ボタンが有効になることがあります。その場合は拡張が再スキャンし、サイドバー表示後にコピーします。
4. 拡張アイコンのポップアップから、再スキャン、最後の文字起こしの再コピー、履歴消去、優先言語などを操作できます。

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

文字起こしが生成されていない動画、閲覧権限がない動画、組織設定で文字起こしが無効化されている動画では取得できません。

## 実装メモ

- Manifest V3 の Chrome 拡張です。
- ページ上の検出処理は `src/content.js` で行います。
- クリップボード書き込みは `src/background.js` から Offscreen Document に委譲します。
- 設定と最後のコピー結果は Chrome storage に保存します。
- 外部サーバーへ文字起こし内容を送信しません。

## 検証

```bash
node --check src/content.js
node --check src/background.js
node --check popup/popup.js
node --check offscreen/offscreen.js
python3 -m json.tool manifest.json >/dev/null
```

Chrome がインストールされている環境では、次のようにパッケージ化チェックもできます。

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --pack-extension=/path/to/Classroom_ext
```
