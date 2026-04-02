/**
 * GET /api/ice-servers
 * Returns ICE server config (STUN + TURN) for WebRTC.
 * TURN credentials are read from environment variables so they never appear
 * in client-side code.
 *
 * Set these in Vercel project settings → Environment Variables:
 *   TURN_URL      e.g. turn:xxxx.metered.ca:80
 *   TURN_USERNAME e.g. abc123
 *   TURN_PASSWORD e.g. supersecret
 *
 * If TURN_URL is not set the response still includes Google STUN servers so
 * same-network connections keep working without any config.
 */

import type { IncomingMessage, ServerResponse } from "http";

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const servers: IceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ];

  const url      = process.env.TURN_URL;
  const username = process.env.TURN_USERNAME;
  const password = process.env.TURN_PASSWORD;

  if (url && username && password) {
    // Metered.ca (and most providers) support multiple transports on different ports
    const urls = [url];
    // Add TCP and TLS variants if the base URL is plain UDP
    if (!url.includes("?transport=")) {
      urls.push(`${url}?transport=tcp`);
      const tlsUrl = url.replace(/^turn:/, "turns:").replace(/:80$/, ":443").replace(/:3478$/, ":5349");
      if (tlsUrl !== url) urls.push(tlsUrl);
    }
    servers.push({ urls, username, credential: password });
  }

  res.writeHead(200);
  res.end(JSON.stringify(servers));
}
