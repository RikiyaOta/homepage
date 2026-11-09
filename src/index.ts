import { config } from "./config.ts";
import type { Html } from "./html.ts";
import { decodeNpub, getPosts, getProfile } from "./nostr.ts";
import { homePage, layout, notFoundPage } from "./pages.ts";

// 本番では何も設定しない。テストやローカル確認で取得先を差し替えるためのもの
export interface Env {
  NOSTR_RELAYS?: string;
  NOSTR_NPUB?: string;
}

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

interface Site {
  npub: string;
  pubkey: string;
  relays: string[];
}

interface Rendered {
  body: Html;
  status: number;
  // リレーから取得できたときだけキャッシュする (失敗した結果を配り続けないため)
  cacheable: boolean;
}

// この秒数を過ぎたキャッシュは使わず、作り直したページを返す
const FRESH_SECONDS = 300;
// リレーから取得できなかったときの予備として、キャッシュに保持しておく最長の秒数
const STALE_SECONDS = 60 * 60 * 24;
const BROWSER_MAX_AGE = 60;
const RENDERED_AT = "X-Rendered-At";

const COMMON_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; img-src https:; media-src https:; frame-src https://www.youtube-nocookie.com; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // 検索エンジンに載せない
  "X-Robots-Tag": "noindex",
};

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const url = new URL(request.url);

    // www 付きのアクセスは www なしへ寄せる
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice("www.".length);
      return Response.redirect(url.toString(), 301);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const site = siteFromEnv(env);

    switch (url.pathname) {
      case "/": {
        const until = parseUntil(url.searchParams.get("until"));
        const key = `${url.origin}/${until ? `?until=${until}` : ""}`;
        return cached(key, ctx, async () => {
          const [profile, posts] = await Promise.all([
            getProfile(site.relays, site.pubkey),
            getPosts(site.relays, site.pubkey, until),
          ]);
          const body = homePage({
            profile: profile.data,
            npub: site.npub,
            page: posts.ok ? posts.data : null,
            isFirstPage: !until,
          });
          return {
            body: layout({ profile: profile.data, body }),
            status: posts.ok ? 200 : 503,
            // 自己紹介か投稿のどちらかが取れなかったページは、次のアクセスで作り直す
            cacheable: posts.ok && profile.ok,
          };
        });
      }

      case "/.well-known/nostr.json":
        return nostrJson(site);

      default:
        return htmlResponse({
          body: layout({ title: "404", profile: null, body: notFoundPage() }),
          status: 404,
          cacheable: false,
        });
    }
  },
};

function siteFromEnv(env: Env): Site {
  const npub = env.NOSTR_NPUB || config.npub;
  const relays = env.NOSTR_RELAYS
    ? env.NOSTR_RELAYS.split(",").map((r) => r.trim()).filter(Boolean)
    : config.relays;
  return { npub, pubkey: decodeNpub(npub), relays };
}

function parseUntil(value: string | null): number | undefined {
  const until = Number(value);
  return Number.isSafeInteger(until) && until > 0 ? until : undefined;
}

function htmlResponse(rendered: Rendered): Response {
  return new Response(rendered.body.toString(), {
    status: rendered.status,
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": rendered.cacheable ? `public, max-age=${BROWSER_MAX_AGE}` : "no-store",
    },
  });
}

// NIP-05: 名前を "_" にすると、識別子がドメインそのもの (_@example.com → example.com) として表示される
function nostrJson(site: Site): Response {
  const body = { names: { _: site.pubkey }, relays: { [site.pubkey]: site.relays } };
  return new Response(JSON.stringify(body), {
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      // ブラウザ上の Nostr クライアントから取得されるため CORS 許可が必須
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// Cloudflare のデータセンターごとのキャッシュ (Cache API)。
// 5 分以内ならキャッシュを返し、過ぎていたら作り直したページを返す。
// 作り直しに失敗したときだけ、古いキャッシュで代用する (stale-if-error)。
// Node で動かすテストなど、Cache API がない環境では毎回作る。
async function cached(key: string, ctx: Context, render: () => Promise<Rendered>): Promise<Response> {
  const cache = (globalThis.caches as (CacheStorage & { default?: Cache }) | undefined)?.default;
  if (!cache) return htmlResponse(await render());

  const hit = await cache.match(key);
  if (hit) {
    const age = (Date.now() - Number(hit.headers.get(RENDERED_AT))) / 1000;
    if (age < FRESH_SECONDS) return fromCache(hit);
  }

  const rendered = await render();
  if (!rendered.cacheable && hit) return fromCache(hit);
  ctx.waitUntil(store(cache, key, rendered));
  return htmlResponse(rendered);
}

function fromCache(hit: Response): Response {
  const response = new Response(hit.body, hit);
  response.headers.set("Cache-Control", `public, max-age=${BROWSER_MAX_AGE}`);
  response.headers.delete(RENDERED_AT);
  return response;
}

async function store(cache: Cache, key: string, rendered: Rendered): Promise<void> {
  if (!rendered.cacheable) return;
  const response = htmlResponse(rendered);
  response.headers.set("Cache-Control", `public, max-age=${STALE_SECONDS}`);
  response.headers.set(RENDERED_AT, String(Date.now()));
  await cache.put(key, response);
}
