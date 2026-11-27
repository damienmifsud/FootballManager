// The key a scheduled job proves itself with: CRON_SECRET, sent as
// "Authorization: Bearer <key>". /api/sync also takes it as ?key=, for
// pingers that cannot set a header; nothing new should. With no CRON_SECRET
// set, nothing is a scheduled job.
//
// Both sides are hashed before they are compared, so the comparison takes the
// same time whatever was sent and however long it is. Server only.
import { createHash, timingSafeEqual } from "crypto";

const digest = (v) => createHash("sha256").update(String(v)).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));

export function cronAuthorized(req, { allowQueryKey = false } = {}) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (same(req.headers.get("authorization") || "", `Bearer ${secret}`)) return true;
  if (!allowQueryKey) return false;
  const key = new URL(req.url).searchParams.get("key");
  return key != null && same(key, secret);
}
