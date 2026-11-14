// 投稿・記事の本文に出てくる URL や nostr: 参照を HTML にする部品。
// 短文投稿 (pages.ts) と長文投稿の Markdown (markdown.ts) の両方から使う。
import * as nip19 from "nostr-tools/nip19";
import * as nip27 from "nostr-tools/nip27";
import { html, safeUrl, type Html } from "./html.ts";
import type { Event } from "./nostr.ts";

export function gatewayUrl(code: string): string {
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

// 本文を HTML にする。URL はリンク、画像・動画は埋め込み、nostr: 参照は nostr.com へのリンクにする。
// tags はカスタム絵文字 (NIP-30) の解決に使う
export function richText(content: string, tags: Event["tags"]): Html[] {
  return [...nip27.parse({ content, tags } as Event)].map((block) => {
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
