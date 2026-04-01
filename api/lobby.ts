/**
 * Vercel serverless function — game lobby.
 *
 * GET  /api/lobby
 *   → LobbyEntry[]  (games created in the last 5 minutes, newest first)
 *
 * POST /api/lobby  { action:"register", roomId, hostName }
 *   → { ok: true }  — adds game to lobby
 *
 * POST /api/lobby  { action:"join", roomId }
 *   → { ok: true }  — removes game from lobby (best-effort)
 *
 * Storage: Upstash Redis sorted set (score = createdAt ms) in production;
 * falls back to in-memory map for local dev.
 */

import type { IncomingMessage, ServerResponse } from "http";

const LOBBY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LOBBY_TTL_S  = LOBBY_TTL_MS / 1000;
const INDEX_KEY    = "lobby:index";

export interface LobbyEntry {
  roomId: string;
  hostName: string;
  createdAt: number; // unix ms
}

// ── In-memory fallback (local dev only) ─────────────────────────────────────

const memStore = new Map<string, LobbyEntry>(); // roomId → entry

function memGc(): void {
  const cutoff = Date.now() - LOBBY_TTL_MS;
  for (const [id, e] of memStore) if (e.createdAt < cutoff) memStore.delete(id);
}

// ── Redis helpers ────────────────────────────────────────────────────────────

function makeRedis() {
  const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
  return new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
}

const useRedis = (): boolean => !!process.env.KV_REST_API_URL;

async function listGames(): Promise<LobbyEntry[]> {
  const cutoff = Date.now() - LOBBY_TTL_MS;

  if (useRedis()) {
    const redis = makeRedis();
    // Remove stale entries from the sorted set
    await redis.zremrangebyscore(INDEX_KEY, "-inf", cutoff);
    // Fetch active room IDs (sorted oldest→newest by score)
    const roomIds = (await redis.zrange(INDEX_KEY, 0, -1)) as string[];
    if (!roomIds.length) return [];
    const entries = await Promise.all(
      roomIds.map((id) => redis.get<LobbyEntry>(`lobby:game:${id}`))
    );
    return (entries.filter(Boolean) as LobbyEntry[]).reverse(); // newest first
  }

  memGc();
  return [...memStore.values()]
    .filter((e) => e.createdAt >= cutoff)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function registerGame(entry: LobbyEntry): Promise<void> {
  if (useRedis()) {
    const redis = makeRedis();
    await redis.set(`lobby:game:${entry.roomId}`, entry, { ex: LOBBY_TTL_S });
    await redis.zadd(INDEX_KEY, { score: entry.createdAt, member: entry.roomId });
    return;
  }
  memGc();
  memStore.set(entry.roomId, entry);
}

async function removeGame(roomId: string): Promise<void> {
  if (useRedis()) {
    const redis = makeRedis();
    await redis.del(`lobby:game:${roomId}`);
    await redis.zrem(INDEX_KEY, roomId);
    return;
  }
  memStore.delete(roomId);
}

// ── Handler ──────────────────────────────────────────────────────────────────

type Req = IncomingMessage & { body?: unknown };
type Res = ServerResponse;

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
    send(200, await listGames());
    return;
  }

  if (req.method === "POST") {
    const body = req.body as { action?: string; roomId?: string; hostName?: string } | null;
    if (!body?.action || !body?.roomId) { send(400, { error: "missing action or roomId" }); return; }

    if (body.action === "register") {
      if (!body.hostName) { send(400, { error: "missing hostName" }); return; }
      await registerGame({
        roomId: body.roomId,
        hostName: body.hostName.trim().slice(0, 30) || "Player",
        createdAt: Date.now(),
      });
      send(200, { ok: true });
    } else if (body.action === "join") {
      await removeGame(body.roomId);
      send(200, { ok: true });
    } else {
      send(400, { error: "unknown action" });
    }
    return;
  }

  send(405, { error: "method not allowed" });
}
