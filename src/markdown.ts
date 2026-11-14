// 長文投稿 (NIP-23) の Markdown を HTML にする。
// marked は字句解析 (トークン列を作る) だけに使い、HTML の組み立ては html タグ関数で行う。
// こうすると外部データのエスケープが html タグ関数に一本化され、raw() を使わずに済む。
// 対応するのは実際に使う記法だけ。知らないトークンは元の Markdown を文字のまま表示する。
import { Lexer, type Token, type Tokens } from "marked";
import * as nip19 from "nostr-tools/nip19";
import { html, safeUrl, type Html } from "./html.ts";
import { gatewayUrl, richText } from "./content.ts";
import type { Event } from "./nostr.ts";

interface Context {
  // カスタム絵文字 (NIP-30) の解決に使う
  tags: Event["tags"];
  // リンクの中ではリンクや埋め込みを作らない (<a> の入れ子を避ける)
  inLink: boolean;
}

export function renderMarkdown(markdown: string, tags: Event["tags"]): Html {
  // breaks: 段落内の改行をそのまま改行として表示する (日本語で改行が空白になるのを避ける)
  const tokens = new Lexer({ gfm: true, breaks: true }).lex(markdown);
  return html`${blocks(tokens, { tags, inLink: false })}`;
}

function blocks(tokens: Token[], ctx: Context): Html[] {
  return tokens.map((token) => block(token, ctx));
}

function block(token: Token, ctx: Context): Html {
  const t = token as Tokens.Generic;
  switch (t.type) {
    case "space":
    case "def":
      return html``;
    case "heading": {
      // 記事のタイトルが h1 なので、本文の見出しは h2 から始める
      const { depth, tokens } = t as Tokens.Heading;
      const content = inline(tokens, ctx);
      if (depth <= 2) return html`<h2>${content}</h2>`;
      if (depth === 3) return html`<h3>${content}</h3>`;
      return html`<h4>${content}</h4>`;
    }
    case "paragraph":
      return html`<p>${inline((t as Tokens.Paragraph).tokens, ctx)}</p>`;
    case "text": {
      // 詰めて書いたリストの項目は、段落ではなく text トークンになる
      const text = t as Tokens.Text;
      return html`${text.tokens ? inline(text.tokens, ctx) : text.text}`;
    }
    case "code":
      // prettier-ignore
      return html`<pre><code>${(t as Tokens.Code).text}</code></pre>`;
    case "blockquote":
      return html`<blockquote>${blocks((t as Tokens.Blockquote).tokens, ctx)}</blockquote>`;
    case "hr":
      return html`<hr />`;
    case "list":
      return list(t as Tokens.List, ctx);
    case "table":
      return table(t as Tokens.Table, ctx);
    case "html":
      return rawHtml(t as Tokens.HTML, true);
    default:
      return html`<p>${t.raw}</p>`;
  }
}

function list(token: Tokens.List, ctx: Context): Html {
  const items = token.items.map((item) => html`<li>${blocks(item.tokens, ctx)}</li>`);
  if (!token.ordered) return html`<ul>${items}</ul>`;
  const start = typeof token.start === "number" && token.start !== 1 ? token.start : null;
  return html`<ol${start !== null && html` start="${start}"`}>${items}</ol>`;
}

function table(token: Tokens.Table, ctx: Context): Html {
  const cell = (c: Tokens.TableCell, tag: "th" | "td") => {
    const attr = c.align && html` class="align-${c.align}"`;
    const content = inline(c.tokens, ctx);
    return tag === "th" ? html`<th${attr}>${content}</th>` : html`<td${attr}>${content}</td>`;
  };
  return html`<div class="table">
    <table>
      <thead>
        <tr>${token.header.map((c) => cell(c, "th"))}</tr>
      </thead>
      <tbody>
        ${token.rows.map((row) => html`<tr>${row.map((c) => cell(c, "td"))}</tr>`)}
      </tbody>
    </table>
  </div>`;
}

// 生の HTML は使わせない。コメントは表示せず、それ以外はタグごと文字として見せる
function rawHtml(token: Tokens.HTML | Tokens.Tag, isBlock: boolean): Html {
  if (token.text.trimStart().startsWith("<!--")) return html``;
  return isBlock ? html`<p>${token.text}</p>` : html`${token.text}`;
}

function inline(tokens: Token[], ctx: Context): Html[] {
  return tokens.map((token) => inlineToken(token, ctx));
}

function inlineToken(token: Token, ctx: Context): Html {
  const t = token as Tokens.Generic;
  switch (t.type) {
    case "text": {
      const text = t as Tokens.Text;
      if (text.tokens) return html`${inline(text.tokens, ctx)}`;
      return ctx.inLink ? html`${text.text}` : html`${richText(text.text, ctx.tags)}`;
    }
    case "escape":
      return html`${(t as Tokens.Escape).text}`;
    case "strong":
      return html`<strong>${inline((t as Tokens.Strong).tokens, ctx)}</strong>`;
    case "em":
      return html`<em>${inline((t as Tokens.Em).tokens, ctx)}</em>`;
    case "del":
      return html`<del>${inline((t as Tokens.Del).tokens, ctx)}</del>`;
    case "codespan":
      return html`<code>${(t as Tokens.Codespan).text}</code>`;
    case "br":
      return html`<br />`;
    case "checkbox":
      return html`<input type="checkbox" disabled${(t as Tokens.Checkbox).checked && html` checked`} /> `;
    case "link":
      return link(t as Tokens.Link, ctx);
    case "image":
      return image(t as Tokens.Image);
    case "html":
      return rawHtml(t as Tokens.Tag, false);
    default:
      return html`${t.raw}`;
  }
}

function link(token: Tokens.Link, ctx: Context): Html {
  // 本文にそのまま書いた URL は、短文投稿と同じく画像・YouTube の埋め込みや短縮表示にする
  if (token.autolink && !ctx.inLink) return html`${richText(token.href, ctx.tags)}`;
  const content = inline(token.tokens, { ...ctx, inLink: true });
  if (ctx.inLink) return html`${content}`;
  if (token.href.startsWith("nostr:")) {
    const code = token.href.slice("nostr:".length);
    return isNip19(code) ? html`<a href="${gatewayUrl(code)}">${content}</a>` : html`${content}`;
  }
  const url = safeUrl(token.href);
  return url ? html`<a href="${url}" rel="nofollow noopener">${content}</a>` : html`${content}`;
}

function image(token: Tokens.Image): Html {
  const url = safeUrl(token.href);
  if (!url) return html`${token.text}`;
  return html`<img src="${url}" alt="${token.text}" loading="lazy" />`;
}

// nostr: リンクとして扱うのは公開してよい識別子だけ (nsec などは除く)
function isNip19(code: string): boolean {
  if (!/^(npub|nprofile|note|nevent|naddr)1/.test(code)) return false;
  try {
    nip19.decode(code);
    return true;
  } catch {
    return false;
  }
}
