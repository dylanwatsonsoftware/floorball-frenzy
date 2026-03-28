/**
 * Vercel serverless function — WebRTC signaling relay via in-memory store.
 *
 * GET  /api/signal?room=<id>&role=<host|client>  → poll for a message
 * POST /api/signal                               → { room, role, msg } push a message
 *
 * Messages are held for 30 s then expire. This is ephemeral — no persistence.
 * NOTE: compiled as CommonJS (see api/tsconfig.json) for Vercel Node.js runtime.
 */

import type { IncomingMessage, ServerResponse } from "http";

const store = new Map<string, { body: unknown; expiresAt: number }>();
const TTL_MS = 30_000;

function gc(): void {
  const now = Date.now();
  for (const [k, v] of store) if (v.expiresAt < now) store.delete(k);
}

function qs(url: string, key: string): string | null {
  const idx = url.indexOf("?");
  if (idx === -1) return null;
  const params = url.slice(idx + 1).split("&");
  for (const p of params) {
    const [k, v] = p.split("=");
    if (decodeURIComponent(k) === key) return decodeURIComponent(v ?? "");
  }
  return null;
}

type Req = IncomingMessage & { body?: unknown };
type Res = ServerResponse;

export default function handler(req: Req, res: Res): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  gc();

  const send = (code: number, body: unknown): void => {
    const json = JSON.stringify(body);
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(json);
  };

  if (req.method === "OPTIONS") { res.writeHead(200).end(); return; }

  if (req.method === "GET") {
    const url = req.url ?? "";
    const room = qs(url, "room");
    const role = qs(url, "role");
    if (!room || !role) { send(400, { error: "missing room or role" }); return; }
    const key = `${room}:${role}`;
    const entry = store.get(key);
    if (!entry || entry.expiresAt < Date.now()) { store.delete(key); send(200, null); return; }
    store.delete(key);
    send(200, entry.body);
    return;
  }

  if (req.method === "POST") {
    const payload = req.body as { room?: string; role?: string; msg?: unknown } | null;
    if (!payload?.room || !payload?.role || !payload?.msg) {
      send(400, { error: "missing room, role, or msg" }); return;
    }
    const recipient = payload.role === "host" ? "client" : "host";
    store.set(`${payload.room}:${recipient}`, { body: payload.msg, expiresAt: Date.now() + TTL_MS });
    send(200, { ok: true });
    return;
  }

  send(405, { error: "method not allowed" });
}
