/**
 * Vercel serverless function — WebRTC signaling relay via Vercel KV.
 *
 * GET  /api/signal?room=<id>&role=<host|client>  → poll for a message
 * POST /api/signal                               → { room, role, msg } push a message
 *
 * Messages expire after 30 s (KV TTL). Uses @vercel/kv in production;
 * falls back to in-memory map when KV env vars are absent (local dev).
 * NOTE: compiled as CommonJS (see api/tsconfig.json) for Vercel Node.js runtime.
 */

import type { IncomingMessage, ServerResponse } from "http";

// ── Storage abstraction ──────────────────────────────────────────────────────

const TTL_S = 30;

// In-memory fallback for local dev (no KV credentials available)
const memStore = new Map<string, { body: unknown; expiresAt: number }>();

function memGc(): void {
  const now = Date.now();
  for (const [k, v] of memStore) if (v.expiresAt < now) memStore.delete(k);
}

async function storeGet(key: string): Promise<unknown | null> {
  if (process.env.KV_REST_API_URL) {
    const { kv } = await import("@vercel/kv");
    const val = await kv.get<unknown>(key);
    if (val !== null && val !== undefined) await kv.del(key);
    return val ?? null;
  }
  memGc();
  const entry = memStore.get(key);
  if (!entry || entry.expiresAt < Date.now()) { memStore.delete(key); return null; }
  memStore.delete(key);
  return entry.body;
}

async function storeSet(key: string, value: unknown): Promise<void> {
  if (process.env.KV_REST_API_URL) {
    const { kv } = await import("@vercel/kv");
    await kv.set(key, value, { ex: TTL_S });
    return;
  }
  memGc();
  memStore.set(key, { body: value, expiresAt: Date.now() + TTL_S * 1000 });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const send = (code: number, body: unknown): void => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "OPTIONS") { res.writeHead(200).end(); return; }

  if (req.method === "GET") {
    const url = req.url ?? "";
    const room = qs(url, "room");
    const role = qs(url, "role");
    if (!room || !role) { send(400, { error: "missing room or role" }); return; }
    const val = await storeGet(`${room}:${role}`);
    send(200, val);
    return;
  }

  if (req.method === "POST") {
    const payload = req.body as { room?: string; role?: string; msg?: unknown } | null;
    if (!payload?.room || !payload?.role || !payload?.msg) {
      send(400, { error: "missing room, role, or msg" }); return;
    }
    const recipient = payload.role === "host" ? "client" : "host";
    await storeSet(`${payload.room}:${recipient}`, payload.msg);
    send(200, { ok: true });
    return;
  }

  send(405, { error: "method not allowed" });
}
