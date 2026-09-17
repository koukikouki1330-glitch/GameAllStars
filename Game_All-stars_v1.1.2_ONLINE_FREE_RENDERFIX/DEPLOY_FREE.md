# Game All-stars 無料オンライン公開ガイド

## Render Freeで公開する場合

このリポジトリは、ランチャー本体（Electron）とオンラインサーバーを分離してインストールする構成です。Render側ではElectronをインストールしないため、以前の構成よりデプロイしやすくなっています。

### Render Web Service設定
- Runtime: Node
- Plan: Free
- Build Command: `npm install --prefix server`
- Start Command: `node server/server.js`
- Health Check Path: `/api/health`

`render.yaml` を使う場合は、この設定が自動で入ります。

### 公開後の確認
Renderが発行したURLをブラウザで開きます。

`https://YOUR-SERVICE.onrender.com/api/health`

次のようなJSONが返ればOKです。

`{"ok":true,"version":"1.1.1",...}`

### Launcherへの設定
Game All-stars → Settings → サーバーURL に、RenderのURLを入力します。

例：
`https://game-all-stars-api.onrender.com`

## GitHubからのデプロイ
1. ZIPを展開して中身をGitHubリポジトリへpush
2. RenderでNew → Web Service
3. GitHubリポジトリを選択
4. `render.yaml` の設定を使用、または上記4項目を手入力
5. Deploy

## 無料版の注意
Render Freeはアイドル時にサービスが停止することがあります。また、ローカルディスクに保存したJSONやゲームファイルは永続ストレージではありません。テスト・試運転用として利用し、本格運用では外部DBとオブジェクトストレージへ移行してください。
