# RikiyaOta

文字だけの簡素な個人ページです。自己紹介と投稿は [Nostr](https://nostr.com/) から取得して表示します。

| パス | 内容 |
| :--- | :--- |
| `/` | Nostr プロフィール (kind 0) の画像、名前、自己紹介文、リンク。その下に自分の Nostr 投稿 (kind 1) をリプライを除いて 20 件ずつ表示 (`?until=` で前の投稿へ) |
| `/.well-known/nostr.json` | NIP-05。サイトのドメインを Nostr の認証済み ID として使うためのもの |

管理画面やデータベースはありません。Nostr アプリから投稿すれば、そのままサイトに反映されます。

## 仕組み

- Cloudflare Workers 上の 1 本の Worker が、リクエストのたびに Nostr リレーへ WebSocket で問い合わせて HTML を作ります。フレームワークは使っていません。
- 届いたイベントは署名を検証し、自分の公開鍵のものだけを表示します。
- 設定したすべてのリレーに同時に問い合わせ、応答をマージして表示します。応答しないリレーは 3 秒で打ち切ります。
- 作った HTML は Cloudflare のキャッシュに保存し、5 分以内のアクセスにはそれを返します。5 分を過ぎるとリレーから取得し直して新しいページを返します。リレーから取得できなかったときは古いページで代用します。
- 検索エンジンには載せません (`noindex`)。

## 設定

サイト名、npub、リンク、取得先のリレーは [`src/config.ts`](src/config.ts) にまとまっています。取得先のリレーは、普段使っている Nostr アプリの書き込み先リレーと揃えてください。

## 開発

ツールは [`mise`](https://mise.jdx.dev/) で管理しています。

```bash
mise install
mise exec -- pnpm install

# ローカルで起動 (http://localhost:8787)
mise exec -- pnpm dev

# 型チェック・テスト・バンドル確認
mise exec -- pnpm typecheck
mise exec -- pnpm test
mise exec -- pnpm check
```

テストは Node 標準のテストランナーで動き、本物のリレーには接続しません。テスト用の鍵で署名したイベントを返す疑似リレー ([`tests/mock-relay.ts`](tests/mock-relay.ts)) を使います。

## デプロイ

`main` にマージすると GitHub Actions が `wrangler deploy` を実行します。カスタムドメインは [`wrangler.jsonc`](wrangler.jsonc) の `routes` で設定しています。

GitHub Secrets に次の 2 つが必要です。

| Secret | 内容 |
| :--- | :--- |
| `CLOUDFLARE_API_TOKEN` | Workers のデプロイとカスタムドメイン設定ができる API トークン |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント ID |
