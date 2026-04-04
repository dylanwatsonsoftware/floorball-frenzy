/**
 * GET /api/ice-servers
 * Returns ICE server config (STUN + TURN) for WebRTC.
 * TURN credentials are read from environment variables so they never appear
 * in client-side code.
 *
 * Set these in Vercel project settings → Environment Variables:
 *   TURN_USERNAME   e.g. 6fb6430d369f035ca93645fd
 *   TURN_PASSWORD   e.g. TNLmLb3YlxERTkDB
 *
 * Uses Metered.ca global relay with all 4 transport variants (UDP, TCP, TLS).
 * If credentials are not set, falls back to STUN only.
 */

import type { IncomingMessage, ServerResponse } from "http";

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const servers: IceServer[] = [
    { urls: "stun:stun.relay.metered.ca:80" },
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun.l.google.com:3478" },
    { urls: "stun:stun1.l.google.com:3478" },
    { urls: "stun:stun2.l.google.com:3478" },
    { urls: "stun:stun3.l.google.com:3478" },
    { urls: "stun:stun4.l.google.com:3478" },
  ];

  const username = process.env.TURN_USERNAME;
  const password = process.env.TURN_PASSWORD;

  if (username && password) {
    servers.push(
      { urls: "turn:global.relay.metered.ca:80",                    username, credential: password },
      { urls: "turn:global.relay.metered.ca:80?transport=tcp",      username, credential: password },
      { urls: "turn:global.relay.metered.ca:443",                   username, credential: password },
      { urls: "turns:global.relay.metered.ca:443?transport=tcp",    username, credential: password },
    );
  }

  res.writeHead(200);
  res.end(JSON.stringify(servers));
}
