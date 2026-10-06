import { verifyEvent } from "nostr-tools/pure";
import { matchFilter } from "nostr-tools/filter";
import * as nip10 from "nostr-tools/nip10";
import * as nip19 from "nostr-tools/nip19";
import type { Event, Filter } from "nostr-tools";

export type { Event };

export interface Profile {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
}

export interface QueryResult<T> {
  data: T;
  // 1 つ以上のリレーから応答 (EOSE) があったか。false なら取得失敗として扱う
  ok: boolean;
}

// リレーごとに持っている投稿が違うので、すべてのリレーの応答を待ってマージする。
// 応答しないリレーがあっても、この時間で打ち切る
const TIMEOUT_MS = 3000;

export function decodeNpub(npub: string): string {
  const decoded = nip19.decode(npub);
  if (decoded.type !== "npub") throw new Error(`npub ではありません: ${npub}`);
  return decoded.data;
}

// 複数のリレーに同じ問い合わせを投げて結果をまとめる。
// リレーから届いたイベントは、条件に合い署名が正しいものだけを採用する。
export async function query(relays: string[], filter: Filter): Promise<QueryResult<Event[]>> {
  if (relays.length === 0) return { data: [], ok: false };
  const events = new Map<string, Event>();
  const sockets: WebSocket[] = [];
  let responded = 0;
  let finished = 0;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, TIMEOUT_MS);
    const check = () => {
      if (finished >= relays.length) {
        clearTimeout(timer);
        resolve();
      }
    };

    for (const relay of relays) {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        finished++;
        if (ok) responded++;
        check();
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(relay);
      } catch {
        finish(false);
        continue;
      }
      sockets.push(ws);
      ws.addEventListener("open", () => ws.send(JSON.stringify(["REQ", "q", filter])));
      ws.addEventListener("message", (message) => {
        let data: unknown;
        try {
          data = JSON.parse(String(message.data));
        } catch {
          return;
        }
        if (!Array.isArray(data)) return;
        if (data[0] === "EVENT" && data[1] === "q") {
          const event = data[2] as Event;
          try {
            if (!events.has(event.id) && matchFilter(filter, event) && verifyEvent(event)) {
              events.set(event.id, event);
            }
          } catch {
            // 形式が壊れたイベントは捨てる
          }
        } else if (data[0] === "EOSE" && data[1] === "q") {
          finish(true);
        } else if (data[0] === "CLOSED" && data[1] === "q") {
          finish(false);
        }
      });
      ws.addEventListener("error", () => finish(false));
      ws.addEventListener("close", () => finish(false));
    }
  });

  for (const ws of sockets) {
    try {
      ws.close();
    } catch {
      // 接続途中のソケットは close できないことがあるが、無視してよい
    }
  }

  const sorted = [...events.values()].sort((a, b) => b.created_at - a.created_at);
  return { data: sorted, ok: responded > 0 };
}

export async function getProfile(relays: string[], pubkey: string): Promise<QueryResult<Profile | null>> {
  const { data, ok } = await query(relays, { kinds: [0], authors: [pubkey], limit: 1 });
  const latest = data[0];
  if (!latest) return { data: null, ok };
  try {
    return { data: JSON.parse(latest.content) as Profile, ok };
  } catch {
    return { data: null, ok };
  }
}

export const POSTS_PER_PAGE = 20;
// リプライを除くと件数が減るので、表示件数より多めに取得する
const FETCH_LIMIT = 100;

export interface PostsPage {
  posts: Event[];
  // 次ページ (より古い投稿) の until。これ以上ないときは null
  nextUntil: number | null;
}

// 自分の短文投稿 (kind 1) のうち、リプライを除いたものを新しい順に返す
export async function getPosts(
  relays: string[],
  pubkey: string,
  until?: number,
): Promise<QueryResult<PostsPage>> {
  const { data, ok } = await query(relays, {
    kinds: [1],
    authors: [pubkey],
    limit: FETCH_LIMIT,
    ...(until ? { until } : {}),
  });

  const topLevel = data.filter((event) => {
    const { root, reply } = nip10.parse(event);
    return !root && !reply;
  });
  const posts = topLevel.slice(0, POSTS_PER_PAGE);

  let nextUntil: number | null = null;
  if (topLevel.length > POSTS_PER_PAGE) {
    nextUntil = posts[posts.length - 1].created_at - 1;
  } else if (data.length >= FETCH_LIMIT) {
    nextUntil = data[data.length - 1].created_at - 1;
  }

  return { data: { posts, nextUntil }, ok };
}
