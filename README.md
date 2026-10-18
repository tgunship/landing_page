# 痛みと願いカード セッション LP

「痛みと願いカード」セッションのランディングページです。

- 元サイト: https://sites.google.com/view/itaminegaicard/
- メインカラー: `#12838b`

## 構成

```
index.html        … LP本体（HTML / CSS / JS を1ファイルに集約）
images/hero.jpg   … メインビジュアル
images/hero.webp  … メインビジュアル（WebP版）
images/ogp.jpg    … SNSシェア用画像（1200px幅）
images/cards-spread.jpg … カードを並べた写真（カード紹介用、webp版あり）
images/bg-*.webp  … Instagram投稿で使っている背景画像（各セクションの背景・動画のサムネイル）
images/profile.jpg … ナビゲーターのプロフィール写真（webp版あり）
```

ビルド不要です。`index.html` をブラウザで開けば表示できます。

## GitHub Pages で公開する

1. リポジトリの **Settings → Pages** を開く
2. **Source** を「Deploy from a branch」にし、公開したいブランチと `/ (root)` を選んで保存
3. 数分後に `https://<ユーザー名>.github.io/landing_page/` で公開されます

※ `index.html` の `og:image` は `https://tgunship.github.io/landing_page/images/ogp.jpg` を前提にしています。独自ドメインなどで公開する場合は書き換えてください。
