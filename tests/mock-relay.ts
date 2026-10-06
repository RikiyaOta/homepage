// テスト用の疑似 Nostr リレー。受け取った REQ に該当するイベントを返して EOSE を送るだけの最小実装。
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { createHash } from "node:crypto";
import type { Event, Filter } from "nostr-tools";

export interface MockRelay {
  url: string;
  close(): Promise<void>;
}

// silent: 接続は受け付けるが一切応答しないリレー (落ちているリレーの再現用)
// delayMs: REQ を受け取ってから応答するまでの待ち時間 (遠くて遅いリレーの再現用)
export async function startMockRelay(
  events: Event[],
  options: { silent?: boolean; delayMs?: number } = {},
): Promise<MockRelay> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((_req, res) => {
    res.writeHead(426).end("WebSocket only");
  });

  server.on("upgrade", (req, socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});

    const accept = createHash("sha1")
      .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    if (options.silent) return;

    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const frame = readFrame(buffer);
        if (!frame) return;
        buffer = buffer.subarray(frame.size);
        if (frame.opcode === 0x1) {
          const text = frame.payload.toString();
          setTimeout(() => {
            if (!socket.destroyed) handleMessage(socket, events, text);
          }, options.delayMs ?? 0);
        }
        else if (frame.opcode === 0x8) socket.end(Buffer.from([0x88, 0]));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function matches(event: Event, filter: Filter): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.until && event.created_at > filter.until) return false;
  return true;
}

function handleMessage(socket: Socket, events: Event[], text: string): void {
  const [type, subId, ...filters] = JSON.parse(text) as [string, string, ...Filter[]];
  if (type !== "REQ") return;
  for (const filter of filters) {
    const hits = events.filter((e) => matches(e, filter)).sort((a, b) => b.created_at - a.created_at);
    for (const event of hits.slice(0, filter.limit ?? hits.length)) {
      sendText(socket, JSON.stringify(["EVENT", subId, event]));
    }
  }
  sendText(socket, JSON.stringify(["EOSE", subId]));
}

// --- 最小限の WebSocket フレーム処理 (RFC 6455) ---

function readFrame(buffer: Buffer): { opcode: number; payload: Buffer; size: number } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= buffer[maskOffset + (i % 4)];
  }
  return { opcode, payload, size: offset + length };
}

function sendText(socket: Socket, text: string): void {
  const payload = Buffer.from(text);
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}
