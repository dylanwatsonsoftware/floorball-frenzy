/**
 * Vercel serverless function — WebRTC signaling relay via in-memory store.
 *
 * GET  /api/signal?room=<id>&role=<host|client>  → poll for a message
 * POST /api/signal                               → { room, role, msg } push a message
 *
 * Messages are held for 30 s then expire. This is ephemeral — no persistence.
 */

// Simple in-process store (works for single Vercel function instance / dev).
// For production with multiple instances, swap this for Vercel KV.
const store = new Map<string, { body: unknown; expiresAt: number }>();

const TTL_MS = 30_000;

function garbageCollect(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt < now) store.delete(key);
  }
}

export default function handler(
  req: { method: string; url: string; body: unknown },
  res: {
    status(code: number): { json(body: unknown): void; end(): void };
    setHeader(name: string, value: string): void;
    json(body: unknown): void;
  }
): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  garbageCollect();

  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method === "GET") {
    const room = url.searchParams.get("room");
    const role = url.searchParams.get("role"); // who is polling
    if (!room || !role) {
      res.status(400).json({ error: "missing room or role" });
      return;
    }
    const key = `${room}:${role}`;
    const entry = store.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      store.delete(key);
      res.status(200).json(null);
      return;
    }
    const body = entry.body;
    store.delete(key); // consume
    res.status(200).json(body);
    return;
  }

  if (req.method === "POST") {
    const payload = req.body as { room?: string; role?: string; msg?: unknown } | null;
    if (!payload?.room || !payload?.role || !payload?.msg) {
      res.status(400).json({ error: "missing room, role, or msg" });
      return;
    }
    // Store under the recipient's key (opposite role polls for it)
    const recipient = payload.role === "host" ? "client" : "host";
    const key = `${payload.room}:${recipient}`;
    store.set(key, { body: payload.msg, expiresAt: Date.now() + TTL_MS });
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}
