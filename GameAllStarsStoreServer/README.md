# Game All-stars 公開ストアサーバー

このフォルダは Game All-stars Store Server の公開用デプロイパッケージです。

## 推奨: Render で公開

1. Render にサインアップして GitHub リポジトリを作成します。
2. このフォルダをリポジトリのルートに置きます。
3. Render で New -> Web Service を選択し、そのリポジトリを接続します。
4. Runtime は Docker、Dockerfile は `./Dockerfile` にします。
5. デプロイ後に発行された `https://xxxxx.onrender.com` が公開サーバーURLです。
6. 環境変数 `GAMEALLSTARS_CORS_ORIGINS` に次を設定します。
   `https://willowy-halva-8cd15a.netlify.app`
7. クライアントの `Store/store.json` を公開URLに変更します。

## 動作確認

公開URLの `/health` を開いて、`{"status":"ok"}` が返ればサーバーは起動しています。

次に `/manifest.json` を開いてゲーム一覧を確認します。

## 注意

このサーバーは Guest ID を使います。Guest ID は本物の認証ではありません。
また、サーバーのローカル `data` に購入情報とゲームパッケージを保存します。ホスティングサービスで再起動後もデータを保持したい場合は、永続ディスク等のストレージを設定してください。
