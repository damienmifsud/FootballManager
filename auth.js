// Full Auth.js instance (Node runtime). Adds the Upstash adapter so the
// magic-link (Resend) provider can store verification tokens. Google/Microsoft
// work with JWT sessions and don't require the adapter.
//
// The Resend (email) provider MUST be defined here, in the same config as the
// adapter — Auth.js refuses to initialise an email provider without an adapter
// (the MissingAdapter error). Google/Microsoft stay in auth.config.js so they
// remain available to edge middleware.
import NextAuth from "next-auth";
import { UpstashRedisAdapter } from "@auth/upstash-redis-adapter";
import { Redis } from "@upstash/redis";
import Resend from "next-auth/providers/resend";
import { authConfig } from "@/auth.config";

let adapter;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  });
  adapter = UpstashRedisAdapter(redis);
}

// Magic-link (passwordless email) via Resend — defined here because it needs
// the adapter above. Lights up only when the Resend key is present.
const emailProviders = [];
if (process.env.AUTH_RESEND_KEY) {
  emailProviders.push(Resend({
    apiKey: process.env.AUTH_RESEND_KEY,
    from: process.env.AUTH_EMAIL_FROM || "login@resend.dev",
    // Link magic-link sign-in to an existing user with the same email
    // instead of refusing, matching the Google/Microsoft behaviour.
    allowDangerousEmailAccountLinking: true
  }));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // Combine OAuth providers (from the edge-safe config) with the email
  // provider (defined here alongside the adapter).
  providers: [...authConfig.providers, ...emailProviders],
  adapter
});
