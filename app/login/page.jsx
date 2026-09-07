"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AuthPage, AuthHeader, AuthFooter } from "@/components/AuthShell";

// Sign-in (S10, Direction C). One page, two modes:
//  - account mode: whatever /api/auth/providers reports — Google / Microsoft
//    SSO buttons, and a Resend magic-link form with its "sent" state;
//  - legacy mode (no providers configured): the shared team code, posted to
//    /api/login, with the wrong-code error and Enter-to-submit.
// The page is club-wide — it doesn't know the team yet — so the header says
// "Olympic FC / Team hub". After sign-in, app/page.jsx routes to the Viewing
// as picker when the account has a choice to make (D8), else straight home.

const looksLikeEmail = (s) => /\S+@\S+/.test(String(s || "").trim());

export default function Login() {
  const [providers, setProviders] = useState(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  // legacy team-code (only used when auth isn't configured)
  const [pw, setPw] = useState(""); const [err, setErr] = useState(false); const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/providers").then(r => r.ok ? r.json() : null).then((p) => setProviders(p || {})).catch(() => setProviders({}));
  }, []);

  const legacyLogin = async () => {
    if (!pw || busy) return; setBusy(true); setErr(false);
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
      if (res.ok) { router.push("/"); router.refresh(); } else { setErr(true); setBusy(false); }
    } catch { setErr(true); setBusy(false); }
  };

  const sendLink = () => {
    if (!looksLikeEmail(email)) return;
    signIn("resend", { email: email.trim(), callbackUrl: "/", redirect: false });
    setSent(true);
  };

  const has = (id) => !!(providers && providers[id]);
  const loading = providers === null;
  const authMode = !loading && Object.keys(providers).length > 0;
  const sso = has("google") || has("microsoft-entra-id");
  const magic = has("resend");

  const sub = loading ? null : (authMode ? "Sign in to see your team" : "Enter the team code to continue");

  return (
    <AuthPage>
      <AuthHeader sub={sub} />

      <div className="auth-card">
        {loading && <div className="auth-loading">Loading…</div>}

        {!loading && authMode && (<>
          {has("google") && <button className="auth-btn sso" onClick={() => signIn("google", { callbackUrl: "/" })}>Continue with Google</button>}
          {has("microsoft-entra-id") && <button className="auth-btn sso" onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/" })}>Continue with Microsoft</button>}
          {sso && magic && <div className="auth-or" aria-hidden="true"><span />or<span /></div>}
          {magic && (sent ? (
            <div>
              <div className="auth-sent-title">Check your email</div>
              <div className="auth-sent-sub">We sent a sign-in link to {email.trim()}. It signs you in on this phone.</div>
              <button className="auth-ghost" onClick={() => setSent(false)}>Use a different email</button>
            </div>
          ) : (
            <div>
              <label className="auth-label" htmlFor="login-email">Your email</label>
              <input id="login-email" className="auth-input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
                aria-label="Your email" value={email} onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendLink()} />
              <button className="auth-btn" onClick={sendLink} disabled={!looksLikeEmail(email)}>Email me a sign-in link</button>
              <div className="auth-help">No password. Use the email the club has for your family and we&apos;ll send a link that signs you in on this phone.</div>
            </div>
          ))}
        </>)}

        {!loading && !authMode && (<>
          <label className="auth-label" htmlFor="login-code">Team code</label>
          <input id="login-code" className="auth-input code" type="password" autoFocus autoComplete="current-password" placeholder="The code from your coach"
            aria-label="Team code" value={pw} onChange={(e) => { setPw(e.target.value); setErr(false); }}
            onKeyDown={(e) => e.key === "Enter" && legacyLogin()} />
          {err && <div className="auth-err" role="alert">Wrong code — check with your coach.</div>}
          <button className="auth-btn" onClick={legacyLogin} disabled={busy}>{busy ? "Signing in…" : "Let me in"}</button>
          <div className="auth-help">Everyone on the team uses the same code. Ask in the WhatsApp group if you don&apos;t have it.</div>
        </>)}
      </div>

      <AuthFooter />
    </AuthPage>
  );
}
