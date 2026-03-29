/**
 * Vercel serverless function — WebRTC signaling relay.
 *
 * GET  /api/signal?room=<id>&role=<host|client>  → poll for a message
 * POST /api/signal                               → { room, role, msg } push a message
 *
 * Production: uses Upstash Redis REST API (set UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN in Vercel environment variables).
 * Local dev: falls back to in-memory map when those vars are absent.
 *
 * NOTE: compiled as CommonJS (see api/tsconfig.json) for Vercel Node.js runtime.
 */

import type { IncomingMessage, ServerResponse } from "http";

const TTL_S = 30;

// ── Upstash Redis helpers ────────────────────────────────────────────────────

async function redisCommand<T>(command: unknown[]): Promise<T | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // signal: "use in-memory fallback"
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const data = (await res.json()) as { result: T };
  return data.result ?? null;
}

// ── In-memory fallback (local dev only) ─────────────────────────────────────

const memStore = new Map<string, { body: unknown; expiresAt: number }>();

function memGc(): void {
  const now = Date.now();
  for (const [k, v] of memStore) if (v.expiresAt < now) memStore.delete(k);
}

// ── Storage abstraction ──────────────────────────────────────────────────────

async function storeGet(key: string): Promise<unknown | null> {
  if (process.env.UPSTASH_REDIS_REST_URL) {
    const raw = await redisCommand<string>(["GET", key]);
    if (raw === null) return null;
    await redisCommand(["DEL", key]);
    try { return JSON.parse(raw); } catch { return raw; }
  }
  memGc();
  const entry = memStore.get(key);
  if (!entry || entry.expiresAt < Date.now()) { memStore.delete(key); return null; }
  memStore.delete(key);
  return entry.body;
}

async function storeSet(key: string, value: unknown): Promise<void> {
  if (process.env.UPSTASH_REDIS_REST_URL) {
    await redisCommand(["SET", key, JSON.stringify(value), "EX", TTL_S]);
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
