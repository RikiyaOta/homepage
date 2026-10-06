import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { npubEncode } from "nostr-tools/nip19";
import type { Event, EventTemplate } from "nostr-tools";
import worker, { type Env } from "../src/index.ts";
import { startMockRelay, type MockRelay } from "./mock-relay.ts";

// テスト専用の鍵。本番のアカウントとは無関係
const SECRET_KEY = new Uint8Array(32).fill(1);
const PUBKEY = getPublicKey(SECRET_KEY);
const NPUB = npubEncode(PUBKEY);
const BASE_TIME = Math.floor(Date.UTC(2026, 8, 1) / 1000);

function sign(template: Partial<EventTemplate> & Pick<EventTemplate, "kind" | "content">): Event {
  return finalizeEvent({ created_at: BASE_TIME, tags: [], ...template }, SECRET_KEY);
}

// 通常投稿 25 件 + リプライ 3 件 + 本文に HTML を含む投稿 1 件
const events: Event[] = [
  sign({
    kind: 0,
    content: JSON.stringify({ about: "テスト用のプロフィールです。<b>太字</b>", picture: "https://example.com/me.jpg" }),
  }),
];
for (let i = 0; i < 25; i++) {
  events.push(sign({ kind: 1, created_at: BASE_TIME + i * 60, content: `テスト投稿 ${i}` }));
}
const root = events[1];
for (let i = 0; i < 3; i++) {
  events.push(
    sign({
      kind: 1,
      created_at: BASE_TIME + i * 60 + 30,
      content: `これはリプライ ${i}`,
      tags: [["e", root.id, "", "root"]],
    }),
  );
}
events.push(
  sign({
    kind: 1,
    created_at: BASE_TIME + 3600,
    content: "<script>alert(1)</script> https://example.com/a.png https://example.com/page",
  }),
);

let relay: MockRelay;
let secondRelay: MockRelay;
let silentRelay: MockRelay;

before(async () => {
  relay = await startMockRelay(events);
  secondRelay = await startMockRelay(events);
  silentRelay = await startMockRelay([], { silent: true });
});

after(async () => {
  await Promise.all([relay.close(), secondRelay.close(), silentRelay.close()]);
});

const ctx = { waitUntil() {} };

function get(path: string, env: Env = { NOSTR_NPUB: NPUB, NOSTR_RELAYS: relay.url }, host = "rikiyaota.kyoto") {
  return worker.fetch(new Request(`https://${host}${path}`), env, ctx);
}

function countPosts(body: string): number {
  return body.match(/<li><a class="date"/g)?.length ?? 0;
}

describe("トップページ", () => {
  test("プロフィール画像・名前・自己紹介・リンクを表示する", async () => {
    const res = await get("/");
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /<title>RikiyaOta<\/title>/);
    assert.match(body, /<img class="avatar" src="https:\/\/example\.com\/me\.jpg"/);
    assert.match(body, /<p class="bio">テスト用のプロフィールです。&lt;b&gt;太字&lt;\/b&gt;<\/p>/);
    assert.ok(body.includes(`href="https://nostr.com/${NPUB}"`));
    assert.ok(body.includes('href="https://github.com/RikiyaOta"'));
  });

  test("検索エンジンに載せない指定とセキュリティヘッダーを付ける", async () => {
    const res = await get("/");
    assert.equal(res.headers.get("x-robots-tag"), "noindex");
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.match(await res.text(), /<meta name="robots" content="noindex" \/>/);
  });

  test("リプライを除いた投稿を新しい順に 20 件表示し、前の投稿へリンクする", async () => {
    const body = await (await get("/")).text();
    assert.equal(countPosts(body), 20);
    assert.ok(!body.includes("これはリプライ"));
    assert.ok(body.indexOf("テスト投稿 24") < body.indexOf("テスト投稿 23"));
    assert.match(body, /href="https:\/\/nostr\.com\/nevent1/);
    assert.match(body, />9月1日<\/time>|>2026年9月1日<\/time>/);

    const next = body.match(/href="(\/\?until=\d+)"/);
    assert.ok(next, "「もっと前の投稿」へのリンクがある");
    assert.ok(!body.includes(">最新の投稿へ<"), "最初のページには「最新の投稿へ」がない");

    const older = await (await get(next[1])).text();
    assert.equal(countPosts(older), 6);
    assert.ok(older.includes("テスト投稿 0"));
    assert.ok(!older.includes("/?until="), "最後のページには「もっと前の投稿」がない");
    assert.ok(older.includes('<a href="/">最新の投稿へ</a>'), "前のページには「最新の投稿へ」がある");
  });

  test("本文の HTML はエスケープし、URL はリンクや画像にする", async () => {
    const body = await (await get("/")).text();
    assert.ok(!body.includes("<script>alert(1)</script>"));
    assert.ok(body.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.match(body, /<img src="https:\/\/example\.com\/a\.png"/);
    assert.match(body, /<a href="https:\/\/example\.com\/page" rel="nofollow noopener">/);
  });

  test("2 つのリレーが応答したら、応答しないリレーを待たない", async () => {
    const started = Date.now();
    const res = await get("/", {
      NOSTR_NPUB: NPUB,
      NOSTR_RELAYS: [relay.url, secondRelay.url, silentRelay.url].join(","),
    });
    assert.equal(res.status, 200);
    assert.equal(countPosts(await res.text()), 20);
    assert.ok(Date.now() - started < 2000, "タイムアウト (3 秒) まで待っていない");
  });

  test("リレーに接続できないときは 503 を返し、キャッシュさせない", async () => {
    const res = await get("/", { NOSTR_NPUB: NPUB, NOSTR_RELAYS: "ws://127.0.0.1:1" });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(await res.text(), /投稿を取得できませんでした/);
  });
});

describe("その他のルート", () => {
  test("NIP-05 の JSON を CORS 付きで返す", async () => {
    const res = await get("/.well-known/nostr.json");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const json = (await res.json()) as { names: Record<string, string> };
    assert.equal(json.names._, PUBKEY);
  });

  test("www 付きのアクセスは www なしへリダイレクトする", async () => {
    const res = await get("/?until=1", undefined, "www.rikiyaota.kyoto");
    assert.equal(res.status, 301);
    assert.equal(res.headers.get("location"), "https://rikiyaota.kyoto/?until=1");
  });

  test("存在しないページは 404", async () => {
    const res = await get("/posts/old-article");
    assert.equal(res.status, 404);
    assert.match(await res.text(), /ページが見つかりませんでした/);
  });
});

describe("キャッシュ", () => {
  // Cloudflare の Cache API (caches.default) の代わりに使う、メモリ上の簡易キャッシュ
  class MemoryCache {
    store = new Map<string, { body: string; init: ResponseInit }>();
    async match(key: string) {
      const hit = this.store.get(key);
      return hit && new Response(hit.body, hit.init);
    }
    async put(key: string, response: Response) {
      this.store.set(key, {
        body: await response.text(),
        init: { status: response.status, headers: response.headers },
      });
    }
  }

  test("5 分以内はキャッシュを返し、過ぎたら作り直したページを返す", async (t) => {
    const cache = new MemoryCache();
    Object.defineProperty(globalThis, "caches", { value: { default: cache }, configurable: true });
    t.after(() => {
      delete (globalThis as { caches?: unknown }).caches;
    });
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 1) });

    const liveEvents = [...events];
    const liveRelay = await startMockRelay(liveEvents);
    t.after(() => liveRelay.close());

    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    const env = { NOSTR_NPUB: NPUB, NOSTR_RELAYS: liveRelay.url };
    const fetchPosts = async () => {
      const res = await worker.fetch(new Request("https://rikiyaota.kyoto/"), env, ctx);
      await Promise.all(pending.splice(0));
      return res.text();
    };

    assert.ok((await fetchPosts()).includes("テスト投稿 24"));

    // 新しい投稿をしても、5 分以内はキャッシュのまま
    liveEvents.push(sign({ kind: 1, created_at: BASE_TIME + 7200, content: "新しい投稿" }));
    t.mock.timers.tick(60 * 1000);
    assert.ok(!(await fetchPosts()).includes("新しい投稿"));

    // 5 分を過ぎた最初のアクセスで、新しい投稿を含むページを返す
    t.mock.timers.tick(5 * 60 * 1000);
    assert.ok((await fetchPosts()).includes("新しい投稿"));
  });

  test("5 分を過ぎていても、リレーから取得できなければ古いキャッシュを返す", async (t) => {
    const cache = new MemoryCache();
    Object.defineProperty(globalThis, "caches", { value: { default: cache }, configurable: true });
    t.after(() => {
      delete (globalThis as { caches?: unknown }).caches;
    });
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 1) });

    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    const fetchPage = async (relays: string) => {
      const res = await worker.fetch(
        new Request("https://rikiyaota.kyoto/"),
        { NOSTR_NPUB: NPUB, NOSTR_RELAYS: relays },
        ctx,
      );
      await Promise.all(pending.splice(0));
      return res;
    };

    assert.equal((await fetchPage(relay.url)).status, 200);

    t.mock.timers.tick(10 * 60 * 1000);
    const res = await fetchPage("ws://127.0.0.1:1");
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes("テスト投稿 24"));
  });

  test("リレーから取得できなかった結果はキャッシュしない", async (t) => {
    const cache = new MemoryCache();
    Object.defineProperty(globalThis, "caches", { value: { default: cache }, configurable: true });
    t.after(() => {
      delete (globalThis as { caches?: unknown }).caches;
    });

    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    const res = await worker.fetch(
      new Request("https://rikiyaota.kyoto/"),
      { NOSTR_NPUB: NPUB, NOSTR_RELAYS: "ws://127.0.0.1:1" },
      ctx,
    );
    await Promise.all(pending);
    assert.equal(res.status, 503);
    assert.equal(cache.store.size, 0);
  });
});
