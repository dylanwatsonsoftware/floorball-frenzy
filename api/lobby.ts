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
 */

import { kv } from "@vercel/kv";
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

const useRedis = (): boolean => !!process.env.KV_REST_API_URL;

async function listGames(): Promise<LobbyEntry[]> {
  const cutoff = Date.now() - LOBBY_TTL_MS;

  if (useRedis()) {
    try {
      // Remove stale entries from the sorted set
      await kv.zremrangebyscore(INDEX_KEY, "-inf", cutoff);
      // Fetch active room IDs (sorted oldest→newest by score)
      const roomIds = (await kv.zrange(INDEX_KEY, 0, -1)) as string[];
      if (!roomIds.length) return [];

      const entries = await Promise.all(
        roomIds.map((id) => kv.get<LobbyEntry>(`lobby:game:${id}`))
      );
      return (entries.filter(Boolean) as LobbyEntry[]).reverse(); // newest first
    } catch (e) {
      console.error("Redis listGames error:", e);
      return [];
    }
  }

  memGc();
  return [...memStore.values()]
    .filter((e) => e.createdAt >= cutoff)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function registerGame(entry: LobbyEntry): Promise<void> {
  if (useRedis()) {
    try {
      await kv.set(`lobby:game:${entry.roomId}`, entry, { ex: LOBBY_TTL_S });
      await kv.zadd(INDEX_KEY, { score: entry.createdAt, member: entry.roomId });
    } catch (e) {
      console.error("Redis registerGame error:", e);
    }
    return;
  }
  memGc();
  memStore.set(entry.roomId, entry);
}

async function removeGame(roomId: string): Promise<void> {
  if (useRedis()) {
    try {
      await kv.del(`lobby:game:${roomId}`);
      await kv.zrem(INDEX_KEY, roomId);
    } catch (e) {
      console.error("Redis removeGame error:", e);
    }
    return;
  }
  memStore.delete(roomId);
}

// ── Handler ──────────────────────────────────────────────────────────────────

type Req = IncomingMessage & { body?: any };
type Res = ServerResponse;

async function parseBody(req: Req): Promise<any> {
  if (req.body) return req.body;
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

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
    const body = await parseBody(req);
    if (!body?.action || !body?.roomId) {
      console.warn("Lobby POST missing action or roomId", body);
      send(400, { error: "missing action or roomId" });
      return;
    }

    if (body.action === "register") {
      if (!body.hostName) { send(400, { error: "missing hostName" }); return; }
      const entry: LobbyEntry = {
        roomId: body.roomId,
        hostName: body.hostName.trim().slice(0, 30) || "Player",
        createdAt: Date.now(),
      };
      await registerGame(entry);
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
