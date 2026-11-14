import * as nip19 from "nostr-tools/nip19";
import { html, raw, safeUrl, type Html } from "./html.ts";
import { ARTICLE_KIND, type Article, type PostsPage, type Profile } from "./nostr.ts";
import { config } from "./config.ts";
import { gatewayUrl, richText } from "./content.ts";
import { renderMarkdown } from "./markdown.ts";

const STYLE = `
:root {
  --bg: #fbfbf9;
  --text: #1f1f1f;
  --muted: #8c8c86;
  --accent: #b4532a;
  --code-bg: rgba(0, 0, 0, 0.045);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #171716; --text: #e8e6e1; --muted: #8a8882; --accent: #e08a5e; --code-bg: rgba(255, 255, 255, 0.07); }
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
.youtube { display: block; width: 100%; aspect-ratio: 16 / 9; margin: 0.5rem 0; border: 0; }
.youtube.shorts { width: auto; height: min(480px, 70vh); aspect-ratio: 9 / 16; max-width: 100%; }
.section { margin-bottom: 3.5rem; }
.articles { list-style: none; margin: 0; padding: 0; }
.articles li { margin-bottom: 0.6rem; overflow-wrap: anywhere; }
.articles .date { font-size: 0.8rem; color: var(--muted); margin-right: 0.6rem; }
.more { font-size: 0.9rem; margin: 1rem 0 0; }
.site { font-size: 0.9rem; margin: 0 0 3rem; }
.site a { color: var(--muted); text-decoration: none; }
.article h1 { font-size: 1.5rem; line-height: 1.5; }
.article .meta { font-size: 0.8rem; color: var(--muted); margin: 0.5rem 0 2.5rem; }
.article .cover { display: block; margin: 0 0 2.5rem; }
.article + .pager { margin-top: 3.5rem; }
.body { overflow-wrap: anywhere; }
.body h2, .body h3, .body h4 { color: var(--text); letter-spacing: normal; text-transform: none; font-weight: 700; line-height: 1.5; }
.body h2 { font-size: 1.2rem; margin: 3rem 0 1rem; }
.body h3 { font-size: 1.05rem; margin: 2.5rem 0 0.75rem; }
.body h4 { font-size: 1rem; margin: 2rem 0 0.5rem; }
.body p, .body ul, .body ol, .body pre, .body blockquote, .body .table { margin: 0 0 1.4rem; }
.body ul, .body ol { padding-left: 1.5rem; }
.body li > ul, .body li > ol { margin: 0; }
.body li > p { margin: 0 0 0.5rem; }
.body blockquote { padding-left: 1rem; margin-left: 0; border-left: 2px solid var(--muted); color: var(--muted); }
.body code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 3px; }
.body pre { background: var(--code-bg); padding: 1rem 1.1rem; border-radius: 4px; overflow-x: auto; line-height: 1.6; overflow-wrap: normal; }
.body pre code { background: none; padding: 0; font-size: 0.85rem; }
.body img { display: block; margin: 1.4rem 0; }
.body img.emoji { display: inline; height: 1.4em; margin: 0; vertical-align: middle; }
.body hr { border: 0; margin: 3rem 0; }
.body .table { overflow-x: auto; }
.body table { border-collapse: collapse; font-size: 0.9rem; }
.body th, .body td { padding: 0.35rem 0.8rem; text-align: left; }
.body th { background: var(--code-bg); }
.body .align-center { text-align: center; }
.body .align-right { text-align: right; }
.muted { color: var(--muted); }
.pager { font-size: 0.9rem; }
.pager span { color: var(--muted); margin: 0 0.4rem; }
footer { margin-top: 4rem; font-size: 0.8rem; color: var(--muted); }
`;

export function layout(options: {
  title?: string;
  profile: Profile | null;
  body: Html;
  // 記事ページの URL を SNS などで共有したときのプレビュー (OGP)
  og?: { title: string; description: string | null; image: string | null };
}): Html {
  const { title, profile, body, og } = options;
  const picture = safeUrl(profile?.picture);
  const ogImage = safeUrl(og?.image ?? undefined);
  return html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>${title ? `${title} - ${config.name}` : config.name}</title>
        ${picture && html`<link rel="icon" href="${picture}" />`}
        ${og &&
        html`<meta property="og:type" content="article" />
          <meta property="og:site_name" content="${config.name}" />
          <meta property="og:title" content="${og.title}" />
          ${og.description && html`<meta property="og:description" content="${og.description}" />`}
          ${og.description && html`<meta name="description" content="${og.description}" />`}
          ${ogImage && html`<meta property="og:image" content="${ogImage}" />`}`}
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

// トップに出す記事の数。これより多いときは「すべての記事」から /articles へ
export const ARTICLES_ON_HOME = 5;

// トップページ: 名前・自己紹介・リンクと、その下に記事一覧 (記事があるときだけ) と投稿一覧
export function homePage(options: {
  profile: Profile | null;
  npub: string;
  articles: Article[];
  page: PostsPage | null;
  isFirstPage: boolean;
}): Html {
  const { profile, npub, articles, page, isFirstPage } = options;
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
      ${articles.length > 0 &&
      html`<section class="section">
        <h2>Articles</h2>
        ${articleList(articles.slice(0, ARTICLES_ON_HOME))}
        ${articles.length > ARTICLES_ON_HOME &&
        html`<p class="more"><a href="/articles">すべての記事</a></p>`}
      </section>`}
      <section>
        <h2>Posts</h2>
        ${postList(page, isFirstPage)}
      </section>
    </main>`;
}

// 記事一覧ページ (/articles)
export function articlesPage(articles: Article[]): Html {
  return html`${siteHeader()}
    <main>
      <h2>Articles</h2>
      ${articleList(articles)}
    </main>`;
}

// 記事ページ (/articles/<d タグ>)
export function articlePage(article: Article): Html {
  const now = new Date();
  const published = new Date(article.publishedAt * 1000);
  const updated = new Date(article.updatedAt * 1000);
  // 公開日と別の日に編集していれば、更新日も添える
  const showUpdated = article.updatedAt > article.publishedAt && dayOf(updated) !== dayOf(published);
  const cover = safeUrl(article.image ?? undefined);
  const naddr = nip19.naddrEncode({
    kind: ARTICLE_KIND,
    pubkey: article.event.pubkey,
    identifier: article.slug,
  });
  return html`${siteHeader()}
    <main>
      <article class="article">
        <h1>${article.title}</h1>
        <p class="meta">
          ${dateTime(published, now)}${showUpdated && html`（${dateTime(updated, now)} 更新）`}
        </p>
        ${cover && html`<img class="cover" src="${cover}" alt="" />`}
        <div class="body">${renderMarkdown(article.event.content, article.event.tags)}</div>
      </article>
      <p class="pager">
        <a href="${gatewayUrl(naddr)}">Nostr で見る</a><span>/</span><a href="/articles">すべての記事</a>
      </p>
    </main>`;
}

export function articlePath(slug: string): string {
  return `/articles/${encodeURIComponent(slug)}`;
}

function articleList(articles: Article[]): Html {
  const now = new Date();
  return html`<ol class="articles">
    ${articles.map(
      (article) =>
        html`<li>
          <span class="date">${dateTime(new Date(article.publishedAt * 1000), now)}</span>
          <a href="${articlePath(article.slug)}">${article.title}</a>
        </li>`,
    )}
  </ol>`;
}

// トップ以外のページの見出し。小さくサイト名だけ出し、トップへ戻るリンクにする
function siteHeader(): Html {
  return html`<header>
    <p class="site"><a href="/">${config.name}</a></p>
  </header>`;
}

function dateTime(date: Date, now: Date): Html {
  return html`<time datetime="${date.toISOString()}" title="${fullDate.format(date)}">${shortDate(date, now)}</time>`;
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

export function unavailablePage(): Html {
  return html`${siteHeader()}
    <main>
      <p class="muted">記事を取得できませんでした。時間をおいて再度お試しください。</p>
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
        return html`<li><a class="date" href="${url}"><time datetime="${date.toISOString()}" title="${fullDate.format(date)}">${shortDate(date, now)}</time></a>${richText(post.content, post.tags)}</li>`;
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

function dayOf(date: Date): string {
  return dateParts.format(date);
}

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
