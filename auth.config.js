// Edge-safe Auth.js configuration (no database adapter here, so it can run in
// middleware). Providers light up only when their env keys are present, so you
// can enable magic-link first and add Google / Microsoft later with no code change.
// NOTE: the Resend (magic-link) provider lives in auth.js, not here — the email
// provider requires the database adapter, which is only wired up in auth.js.
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

const providers = [];

// Google
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
    // Link to an existing user with the same verified email instead of
    // refusing with OAuthAccountNotLinked, so one person can use Google
    // and Microsoft interchangeably.
    allowDangerousEmailAccountLinking: true
  }));
}

// Microsoft (Entra ID / Microsoft 365 / personal accounts)
if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET) {
  providers.push(MicrosoftEntraID({
    clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
    clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
    issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER, // e.g. https://login.microsoftonline.com/common/v2.0
    allowDangerousEmailAccountLinking: true
  }));
}

export const authConfig = {
  providers,
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  callbacks: {
    // Keep the email on the token/session so the resolver can map it to teams.
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token?.email) session.user.email = token.email;
      return session;
    }
  }
};
