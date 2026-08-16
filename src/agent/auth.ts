import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Wraps handler so requests must carry an `Authorization: Bearer <key>`
 * header matching key exactly, compared in constant time. An empty key
 * always rejects — even against a missing header or an empty bearer value
 * ("Bearer ") — so an unset/blank key is never mistaken for "no auth
 * required" at this layer; that decision belongs to the caller (see
 * main.ts's opt-in MCP_OUTBOUND_KEY wiring). The length check runs before
 * timingSafeEqual both to short-circuit mismatches the same way as the
 * length comparison itself (it only reveals that lengths differ, not
 * anything about key's content) and because timingSafeEqual throws on
 * mismatched buffer lengths.
 */
export function bearerAuth(key: string, handler: RequestListener): RequestListener {
  const want = Buffer.from(`Bearer ${key}`, "utf8");
  return (req, res) => {
    const got = Buffer.from(req.headers.authorization ?? "", "utf8");
    if (key === "" || got.length !== want.length || !timingSafeEqual(got, want)) {
      res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" }).end("unauthorized\n");
      return;
    }
    handler(req, res);
  };
}
