import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";
import { cronAuthorized } from "@/lib/cronAuth";

// The scheduled-job key: CRON_SECRET as "Authorization: Bearer <key>", and
// for /api/sync only, as ?key= too.

let saved;
beforeEach(() => { saved = process.env.CRON_SECRET; process.env.CRON_SECRET = "s3cret-key"; });
afterEach(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved; });

const withHeader = (value) => fakeRequest({ headers: value == null ? {} : { authorization: value } });
const withQuery = (key) => fakeRequest({ url: `https://x.test/api/sync?key=${encodeURIComponent(key)}` });

describe("cronAuthorized", () => {
  it("is the key in the Authorization header, as a Bearer token, exactly", () => {
    expect(cronAuthorized(withHeader("Bearer s3cret-key"))).toBe(true);
    for (const value of [null, "", "Bearer", "Bearer ", "bearer s3cret-key", "s3cret-key", "Bearer s3cret-key ", " Bearer s3cret-key", "Bearer s3cret-keyX", "Bearer s3cret-ke", "Basic s3cret-key"]) {
      expect(cronAuthorized(withHeader(value)), String(value)).toBe(false);
    }
  });

  it("takes ?key= only where it is allowed, and never instead of a wrong header", () => {
    expect(cronAuthorized(withQuery("s3cret-key"))).toBe(false);
    expect(cronAuthorized(withQuery("s3cret-key"), { allowQueryKey: true })).toBe(true);
    for (const key of ["", "s3cret", "s3cret-key2", "S3CRET-KEY"]) expect(cronAuthorized(withQuery(key), { allowQueryKey: true }), key).toBe(false);
    expect(cronAuthorized(fakeRequest({ url: "https://x.test/api/sync" }), { allowQueryKey: true })).toBe(false);
  });

  it("is never true when no key is set, whatever is sent", () => {
    for (const unset of [undefined, ""]) {
      if (unset === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = unset;
      for (const req of [withHeader("Bearer "), withHeader("Bearer undefined"), withHeader("Bearer s3cret-key"), withQuery(""), withQuery("undefined")]) {
        expect(cronAuthorized(req, { allowQueryKey: true })).toBe(false);
      }
    }
  });
});
