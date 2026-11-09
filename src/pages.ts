import * as nip19 from "nostr-tools/nip19";
import * as nip27 from "nostr-tools/nip27";
import { html, raw, safeUrl, type Html } from "./html.ts";
import type { Event, PostsPage, Profile } from "./nostr.ts";
import { config } from "./config.ts";

const STYLE = `
:root {
  --bg: #fbfbf9;
  --text: #1f1f1f;
  --muted: #8c8c86;
  --accent: #b4532a;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #171716; --text: #e8e6e1; --muted: #8a8882; --accent: #e08a5e; }
}
* { box-sizing: border-box; }
html {
  background: var(--bg);
  color: var(--text);
  font: 16px/1.85 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
  -webkit-text-size-adjust: 100%;
}
body { max-width: 32rem; margin: 0 auto; padding: 4rem 1.5rem 5rem; }
a { color: var(--accent); text-underline-offset: 0.2em; }
img, video { max-width: 100%; height: auto; }
.avatar { display: block; width: 64px; height: 64px; border-radius: 50%; object-fit: cover; margin-bottom: 1rem; }
h1 { font-size: 1.1rem; margin: 0; }
h1 a { color: inherit; text-decoration: none; }
.bio { margin: 0.25rem 0 0.75rem; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.links { font-size: 0.9rem; margin: 0 0 3.5rem; }
.links span { color: var(--muted); margin: 0 0.4rem; }
h2 { font-size: 0.8rem; font-weight: 600; color: var(--muted); letter-spacing: 0.15em; text-transform: uppercase; margin: 0 0 1.25rem; }
.posts { list-style: none; margin: 0; padding: 0; }
.posts li { margin-bottom: 1.5rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.posts .date { font-size: 0.8rem; color: var(--muted); text-decoration: none; margin-right: 0.6rem; }
.posts img { display: block; margin: 0.5rem 0; max-height: 480px; width: auto; }
.posts img.emoji { display: inline; height: 1.4em; margin: 0; vertical-align: middle; }
.posts .youtube { display: block; width: 100%; aspect-ratio: 16 / 9; margin: 0.5rem 0; border: 0; }
.posts .youtube.shorts { width: auto; height: min(480px, 70vh); aspect-ratio: 9 / 16; max-width: 100%; }
.muted { color: var(--muted); }
.pager { font-size: 0.9rem; }
.pager span { color: var(--muted); margin: 0 0.4rem; }
footer { margin-top: 4rem; font-size: 0.8rem; color: var(--muted); }
`;

export function layout(options: {
  title?: string;
  profile: Profile | null;
  body: Html;
}): Html {
  const { title, profile, body } = options;
  const picture = safeUrl(profile?.picture);
  return html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>${title ? `${title} - ${config.name}` : config.name}</title>
        ${picture && html`<link rel="icon" href="${picture}" />`}
        <style>
          ${raw(STYLE)}
        </style>
      </head>
      <body>
        ${body}
        <footer>© ${new Date().getFullYear()} ${config.name}</footer>
      </body>
    </html> `;
}

// トップページ: 名前・自己紹介・リンクと、その下に投稿一覧
export function homePage(options: {
  profile: Profile | null;
  npub: string;
  page: PostsPage | null;
  isFirstPage: boolean;
}): Html {
  const { profile, npub, page, isFirstPage } = options;
  const links = [
    { label: "Nostr", url: `https://nosta.me/${npub}` },
    ...config.links,
  ];
  const picture = safeUrl(profile?.picture);
  return html`<header>
      ${picture && html`<img class="avatar" src="${picture}" alt="" width="64" height="64" />`}
      <h1><a href="/">${config.name}</a></h1>
      ${profile?.about && html`<p class="bio">${profile.about}</p>`}
      <p class="links">
        ${links.map((link, i) => html`${i > 0 && html`<span>/</span>`}<a href="${link.url}" rel="me">${link.label}</a>`)}
      </p>
    </header>
    <main>
      <h2>Posts</h2>
      ${postList(page, isFirstPage)}
    </main>`;
}

export function notFoundPage(): Html {
  return html`<header>
      <h1><a href="/">${config.name}</a></h1>
    </header>
    <main>
      <p>ページが見つかりませんでした。</p>
      <p><a href="/">トップへ戻る</a></p>
    </main>`;
}

function postList(page: PostsPage | null, isFirstPage: boolean): Html {
  if (!page) {
    return html`<p class="muted">
      投稿を取得できませんでした。時間をおいて再度お試しください。
    </p>`;
  }
  // 前のページを見ているときは、最新の投稿 (トップ) へ戻るリンクも出す
  const pager = [
    ...(isFirstPage ? [] : [{ label: "最新の投稿へ", url: "/" }]),
    ...(page.nextUntil !== null
      ? [{ label: "もっと前の投稿", url: `/?until=${page.nextUntil}` }]
      : []),
  ];
  const pagerHtml =
    pager.length > 0 &&
    html`<p class="pager">
      ${pager.map((link, i) => html`${i > 0 && html`<span>/</span>`}<a href="${link.url}">${link.label}</a>`)}
    </p>`;
  if (page.posts.length === 0 && page.nextUntil === null) {
    return html`<p class="muted">
        ${isFirstPage ? "まだ投稿がありません。" : "これより前の投稿はありません。"}
      </p>
      ${pagerHtml}`;
  }
  const now = new Date();
  return html`<ol class="posts">
      ${page.posts.map((post) => {
        const date = new Date(post.created_at * 1000);
        const url = `https://primal.net/e/${nip19.neventEncode({ id: post.id, author: post.pubkey })}`;
        // li は white-space: pre-wrap なので、タグの前後に改行や字下げを入れると表示に出てしまう
        // prettier-ignore
        return html`<li><a class="date" href="${url}"><time datetime="${date.toISOString()}" title="${fullDate.format(date)}">${shortDate(date, now)}</time></a>${noteContent(post)}</li>`;
      })}
    </ol>
    ${pagerHtml}`;
}

const TIME_ZONE = "Asia/Tokyo";
const fullDate = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: TIME_ZONE,
});
const dateParts = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: TIME_ZONE,
});

// 今年の投稿は「9月30日」、それより前は「2025年9月30日」
function shortDate(date: Date, now: Date): string {
  const parts = (d: Date) =>
    Object.fromEntries(
      dateParts.formatToParts(d).map((p) => [p.type, p.value]),
    );
  const { year, month, day } = parts(date);
  const sameYear = year === parts(now).year;
  return `${sameYear ? "" : `${year}年`}${month}月${day}日`;
}

function gatewayUrl(code: string): string {
  return `https://nostr.com/${code}`;
}

type Pointer = Extract<nip27.Block, { type: "reference" }>["pointer"];

function encodePointer(pointer: Pointer): string {
  if ("identifier" in pointer) return nip19.naddrEncode(pointer);
  if ("id" in pointer) return nip19.neventEncode(pointer);
  return nip19.npubEncode(pointer.pubkey);
}

function shorten(code: string): string {
  return code.length > 24 ? `${code.slice(0, 16)}…${code.slice(-6)}` : code;
}

// 投稿本文を HTML にする。URL はリンク、画像・動画は埋め込み、nostr: 参照は nostr.com へのリンクにする
function noteContent(event: Event): Html[] {
  return [...nip27.parse(event)].map((block) => {
    switch (block.type) {
      case "text":
        return html`${block.text}`;
      case "hashtag":
        return html`#${block.value}`;
      case "reference": {
        const code = encodePointer(block.pointer);
        return html`<a href="${gatewayUrl(code)}">nostr:${shorten(code)}</a>`;
      }
    }
    const url = safeUrl(block.url);
    if (!url) return html`${block.url}`;
    switch (block.type) {
      case "image":
        return html`<a href="${url}" rel="nofollow noopener"
          ><img src="${url}" alt="" loading="lazy"
        /></a>`;
      case "video":
        return html`<video src="${url}" controls preload="metadata"></video>`;
      case "audio":
        return html`<audio src="${url}" controls preload="metadata"></audio>`;
      case "emoji":
        return html`<img
          class="emoji"
          src="${url}"
          alt=":${block.shortcode}:"
          title=":${block.shortcode}:"
        />`;
      default: {
        const video = youtubeVideo(url);
        if (video) return youtubeEmbed(video);
        return html`<a href="${url}" rel="nofollow noopener">${displayUrl(url)}</a>`;
      }
    }
  });
}

const DISPLAY_URL_LENGTH = 40;

// リンクの表示用に URL を短くする。https:// と www. を外し、長ければ末尾を「…」で省く
function displayUrl(url: string): string {
  let text = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
  try {
    // 日本語などがパーセントエンコードされたままだと読めず長くなるので戻す
    text = decodeURI(text);
  } catch {
    // 不正なエンコードはそのまま表示する
  }
  if (text.endsWith("/") && text.indexOf("/") === text.length - 1) text = text.slice(0, -1);
  const chars = [...text];
  return chars.length > DISPLAY_URL_LENGTH ? `${chars.slice(0, DISPLAY_URL_LENGTH - 1).join("")}…` : text;
}

interface YoutubeVideo {
  id: string;
  start: number | null;
  shorts: boolean;
}

const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

// YouTube の動画 URL (watch / youtu.be / shorts / live / embed) から動画 ID と開始位置を取り出す
function youtubeVideo(url: string): YoutubeVideo | null {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  let shorts = false;
  if (parsed.hostname === "youtu.be") {
    id = segments[0];
  } else if (YOUTUBE_HOSTS.has(parsed.hostname)) {
    if (segments[0] === "watch") id = parsed.searchParams.get("v") ?? undefined;
    else if (["shorts", "live", "embed"].includes(segments[0])) {
      id = segments[1];
      shorts = segments[0] === "shorts";
    }
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { id, start: parseStart(parsed.searchParams.get("t") ?? parsed.searchParams.get("start")), shorts };
}

// 「90」「90s」「1m30s」「1h2m3s」を秒にする
function parseStart(value: string | null): number | null {
  const match = value?.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 ? seconds : null;
}

// Cookie を使わない youtube-nocookie.com のプレーヤーを埋め込む (CSP の frame-src で許可している)
function youtubeEmbed(video: YoutubeVideo): Html {
  const src = `https://www.youtube-nocookie.com/embed/${video.id}${video.start ? `?start=${video.start}` : ""}`;
  return html`<iframe
    class="youtube${video.shorts ? " shorts" : ""}"
    src="${src}"
    title="YouTube 動画"
    loading="lazy"
    allow="encrypted-media; picture-in-picture; web-share"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
  ></iframe>`;
}
