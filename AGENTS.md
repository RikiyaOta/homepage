# AGENTS.md — AI エージェント開発・運用ガイドライン

このドキュメントは、本リポジトリで作業を行うすべての AI コーディングエージェント（Antigravity, Claude, Copilot 等）が遵守すべき設計思想、アーキテクチャ規約、ツール制約、および過去の教訓をまとめたものです。

---

## 1. 最重要グローバル制約（Must-Follow Rules）

1. **言語・仕様記述**:
   - 仕様書、実装計画、ドキュメント、コミットメッセージ、チャット応答はすべて **日本語** で記述すること。
2. **ツール管理 (`mise`)**:
   - 開発ツール（Node.js, pnpm, pinact）はすべて [`mise.toml`](mise.toml) / [`mise.lock`](mise.lock) で管理すること。
   - コマンド実行時は常に `mise exec -- <command>` を介すること。
3. **サプライチェーンセキュリティ（3日間ルール & Hash Pinning）**:
   - `mise.toml` の `minimum_release_age = "3d"`、`pnpm-workspace.yaml` の `minimumReleaseAge: 4320`、`renovate.json` の `minimumReleaseAge: "3 days"`（3日間）を厳格に順守すること（リリース後3日未満の新着パッケージ・ツールはインストールしない）。これらの設定値は変更しないこと。
   - `mise.toml` のツールと `package.json` の依存は `x.y.z` で完全固定し、更新は Renovate の PR で行うこと。
   - GitHub Actions ワークフロー内のすべてのアクションは **40文字の Git コミットハッシュ（+バージョンコメント `# vX.Y.Z`）** で完全固定すること（`mise exec -- pinact run` を使用）。
4. **プライバシー・ドキュメント制約**:
   - ユーザーの要望により、`README.md` 等の対外的なドキュメントにはカスタムドメイン名を明記・過剰アピールしないこと。

---

## 2. アーキテクチャ

### 2.1 構成

- **Cloudflare Worker 1 本だけ**で動く。フレームワーク・DB・ストレージ・バインディングは持たない。
- コンテンツはすべて Nostr から取得する。
  - トップ (`/`) の 1 ページだけ。プロフィール画像 (kind 0 の picture)・名前・自己紹介 (kind 0 の about)・リンクの下に、自分の短文投稿 (kind 1) のうちリプライ以外を 20 件ずつ並べる。`?until=` で前の投稿へ、前の投稿のページからは「最新の投稿へ」でトップへ戻る
  - NIP-05 (`/.well-known/nostr.json`)
- `www.` 付きのホストへのアクセスは、`www.` なしのホストへ 301 リダイレクトする（`wrangler.jsonc` で www 付きのドメインも Worker に割り当てている）。
- 依存パッケージは `nostr-tools`（署名検証・NIP-19/10/27 の解析）のみ。開発用に `wrangler` と `typescript`。

### 2.2 ファイル

| ファイル                         | 役割                                                             |
| :------------------------------- | :--------------------------------------------------------------- |
| [`src/config.ts`](src/config.ts) | サイト名・npub・リンク・取得先リレー                             |
| [`src/index.ts`](src/index.ts)   | ルーティング、キャッシュ、レスポンスヘッダー                     |
| [`src/nostr.ts`](src/nostr.ts)   | リレーへの問い合わせ（WebSocket 直接）とプロフィール・投稿の取得 |
| [`src/pages.ts`](src/pages.ts)   | HTML テンプレートと CSS                                          |
| [`src/html.ts`](src/html.ts)     | 自動エスケープ付きの `html` タグ関数                             |
| [`tests/`](tests)                | Node 標準テストランナーのテストと疑似リレー                      |

### 2.3 デザイン（1 枚ものの簡素なページ）

- タブやページ分割はせず、1 ページにまとめる。区切り線は使わず余白で区切る。
- 生成り寄りの白背景と黒文字に、リンクだけテラコッタ色 (`--accent`) を使う。
- 投稿の日付は本文の頭に小さく添える（今年は「9月30日」、それ以前は「2025年12月31日」）。日付は nostr.com の投稿ページへのリンク。
- 参考にしたサイトの見た目（タブ、大きな太字のサイト名、点線の罫線、右寄せの日付）に寄せないこと。
- Web フォントは読み込まず OS のフォントを使う。CSS は `src/pages.ts` 内に直接書く。
- クライアント JavaScript は使わない（CSP でも禁止している）。
- ダークモードは `prefers-color-scheme` で対応する。
- 短文投稿の見出しは「Posts」と呼ぶ（「Notes」という語は使わない）。
- 検索エンジンに載せない（`<meta name="robots" content="noindex">` と `X-Robots-Tag: noindex`）。`robots.txt` でクロールを禁止すると noindex が読まれなくなるので使わない。

---

## 3. 実装上の注意

### ① HTML は必ず `html` タグ関数で組み立てる

- 投稿本文やプロフィールは外部データなので、文字列連結で HTML に埋め込まないこと。`html` タグ関数は埋め込んだ値を自動でエスケープする。
- `raw()` はエスケープしない。固定の CSS など信頼できる文字列にだけ使うこと。
- URL を `href` / `src` に使うときは `safeUrl()` で http(s) 以外を捨てること。

### ② リレーへの問い合わせ

- `nostr-tools` の `SimplePool` は使わない。接続失敗や EOSE タイムアウトでも `oneose` が呼ばれ、「リレーが本当に応答したか」を区別できないため。`src/nostr.ts` で WebSocket を直接扱っている。
- 受け取ったイベントは `matchFilter` と `verifyEvent` を通したものだけ採用する。
- Workers ではリクエストをまたいで WebSocket を使い回せないので、問い合わせごとに接続して閉じる。

### ③ キャッシュ

- Cache API (`caches.default`) を使う。5 分以内はキャッシュを返し、過ぎたらリレーから取得し直して新しいページを返す。
- stale-while-revalidate（古いページを返しつつ裏で作り直す）にはしないこと。アクセスの少ないサイトでは、ほぼ毎回の初回表示が古い内容になってしまう。
- 作り直しでリレーから取得できなかったとき（自己紹介か投稿が取れなかったとき）は、古いキャッシュがあればそれを返す (stale-if-error)。古いキャッシュは最長 24 時間保持する。
- リレーから 1 つも応答がなく、古いキャッシュもないときは 503 を返し、キャッシュしない。
- Cache API はカスタムドメインでのみ有効。Node のテストでは `caches` がないので毎回作る。

### ④ テスト

- 本物のリレーには接続しない。[`tests/mock-relay.ts`](tests/mock-relay.ts) を起動し、`Env` の `NOSTR_RELAYS` / `NOSTR_NPUB` で接続先を差し替えて Worker の `fetch` を直接呼ぶ。
- テストファイルは TypeScript のまま Node で実行する（型の除去のみ）。`enum` などの型以外の構文は使わないこと（`tsconfig.json` の `erasableSyntaxOnly`）。

### ⑤ pnpm

- pnpm 11 以降では `package.json` の `pnpm` フィールドは無視される。設定は [`pnpm-workspace.yaml`](pnpm-workspace.yaml) に書くこと。
- `pnpm deploy` は pnpm の組み込みコマンドなので、デプロイスクリプトは `pnpm run deploy` で呼ぶこと。

### ⑥ GitHub Actions

- ランナーは Node.js 24 で動作するため、`actions/checkout@v7` や `jdx/mise-action@v4` 等の Node 24 対応アクションを使用し、`pinact` でピン留めすること。

---

## 4. 検証ワークフロー

コードを変更した際は、必ず以下を実行してから作業を完了すること:

```bash
mise exec -- pinact run --verify   # GitHub Actions のピン留め検証
mise exec -- pnpm typecheck        # 型チェック
mise exec -- pnpm test             # テスト（疑似リレーを使用）
mise exec -- pnpm check            # Worker のバンドル確認 (wrangler deploy --dry-run)
```

見た目を確認するときは `mise exec -- pnpm dev` で起動する。取得先を疑似リレーに向けるには `--var NOSTR_RELAYS:<url> --var NOSTR_NPUB:<npub>` を付ける。

---

## 5. リポジトリ構成

```
.
├── .github/
│   └── workflows/
│       ├── ci.yml           # PR 検証
│       └── deploy.yml       # main マージ時に wrangler deploy
├── src/                     # Worker 本体
├── tests/                   # テストと疑似リレー
├── renovate.json            # 依存の自動更新
├── wrangler.jsonc           # Worker 設定 (カスタムドメイン)
├── tsconfig.json
├── pnpm-workspace.yaml
├── mise.toml                # ツール定義
├── mise.lock                # 全プラットフォーム向けツールバージョン固定
├── package.json
└── README.md
```
