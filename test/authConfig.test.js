import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// auth.config.js builds its provider list from env at module load, so we
// re-import it per test after setting the relevant variables. The jwt/session
// callbacks are pure and tested directly.
const KEYS = [
  "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET",
  "AUTH_MICROSOFT_ENTRA_ID_ID", "AUTH_MICROSOFT_ENTRA_ID_SECRET", "AUTH_MICROSOFT_ENTRA_ID_ISSUER"
];
let saved;
beforeEach(() => {
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

async function loadConfig() {
  vi.resetModules();
  return (await import("@/auth.config")).authConfig;
}

describe("auth.config — provider wiring", () => {
  it("registers no OAuth providers when no keys are set", async () => {
    const cfg = await loadConfig();
    expect(cfg.providers).toHaveLength(0);
  });

  it("adds Google only when both Google keys are present", async () => {
    process.env.AUTH_GOOGLE_ID = "gid";
    process.env.AUTH_GOOGLE_SECRET = "gsecret";
    const cfg = await loadConfig();
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0].id).toBe("google");
  });

  it("does not add Google when only one of the pair is set", async () => {
    process.env.AUTH_GOOGLE_ID = "gid"; // secret missing
    const cfg = await loadConfig();
    expect(cfg.providers).toHaveLength(0);
  });

  it("adds Microsoft Entra ID when its keys are present", async () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "mid";
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "msecret";
    const cfg = await loadConfig();
    expect(cfg.providers.map((p) => p.id)).toContain("microsoft-entra-id");
  });

  it("registers both providers when all keys are present", async () => {
    process.env.AUTH_GOOGLE_ID = "gid";
    process.env.AUTH_GOOGLE_SECRET = "gsecret";
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "mid";
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "msecret";
    const cfg = await loadConfig();
    expect(cfg.providers).toHaveLength(2);
  });

  it("uses JWT sessions and the custom login page", async () => {
    const cfg = await loadConfig();
    expect(cfg.session).toEqual({ strategy: "jwt" });
    expect(cfg.pages).toEqual({ signIn: "/login" });
    expect(cfg.trustHost).toBe(true);
  });
});

describe("auth.config — callbacks", () => {
  it("jwt copies the user's email onto the token on sign-in", async () => {
    const cfg = await loadConfig();
    const token = await cfg.callbacks.jwt({ token: {}, user: { email: "Mum@A.com" } });
    expect(token.email).toBe("Mum@A.com");
  });

  it("jwt leaves the token untouched without a user", async () => {
    const cfg = await loadConfig();
    const token = await cfg.callbacks.jwt({ token: { email: "kept@a.com" } });
    expect(token).toEqual({ email: "kept@a.com" });
  });

  it("session exposes the token email on session.user", async () => {
    const cfg = await loadConfig();
    const session = await cfg.callbacks.session({ session: { user: {} }, token: { email: "mum@a.com" } });
    expect(session.user.email).toBe("mum@a.com");
  });

  it("session is unchanged when there is no token email", async () => {
    const cfg = await loadConfig();
    const session = await cfg.callbacks.session({ session: { user: { name: "X" } }, token: {} });
    expect(session.user).toEqual({ name: "X" });
  });
});
