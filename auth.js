// Full Auth.js instance (Node runtime). Adds the Upstash adapter so the
// magic-link (Resend) provider can store verification tokens. Google/Microsoft
// work with JWT sessions and don't require the adapter.
import NextAuth from "next-auth";
import { UpstashRedisAdapter } from "@auth/upstash-redis-adapter";
import { Redis } from "@upstash/redis";
import { authConfig } from "@/auth.config";

let adapter;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  });
  adapter = UpstashRedisAdapter(redis);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter
});
