"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

const wrap = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui, sans-serif", background: "linear-gradient(160deg,#C8102E,#7A0A1B)" };
const card = { background: "#fff", borderRadius: 18, padding: 20, boxShadow: "0 16px 40px rgba(60,0,10,.35)" };
const btn = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 };
const inp = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "2px solid #eee", fontSize: 16, boxSizing: "border-box", marginBottom: 10 };

function LoginLogo() {
  const [ok, setOk] = useState(true);
  return ok
    ? <img src="/logo.png" alt="" onError={() => setOk(false)}
        style={{ width: 72, height: 72, objectFit: "contain", margin: "0 auto 14px", display: "block", filter: "drop-shadow(0 3px 8px rgba(0,0,0,.35))" }} />
    : <div style={{ width: 64, height: 64, borderRadius: 18, background: "#fff", color: "#C8102E", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontWeight: 800, fontSize: 26 }}>⚽</div>;
}

export default function Login() {
  const [providers, setProviders] = useState(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  // legacy team-code (only used when auth isn't configured)
  const [pw, setPw] = useState(""); const [err, setErr] = useState(false); const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/providers").then(r => r.ok ? r.json() : null).then(setProviders).catch(() => setProviders({}));
  }, []);

  const legacyLogin = async () => {
    if (!pw || busy) return; setBusy(true); setErr(false);
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
      if (res.ok) { router.push("/"); router.refresh(); } else { setErr(true); setBusy(false); }
    } catch { setErr(true); setBusy(false); }
  };

  const has = (id) => providers && providers[id];
  const authMode = providers && Object.keys(providers).length > 0;

  return (
    <div style={wrap}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 22, color: "#fff" }}>
          <LoginLogo />

          <div style={{ fontSize: 22, fontWeight: 800 }}>Team Dashboard</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{authMode ? "Sign in to see your team" : "Enter the team code to continue"}</div>
        </div>

        <div style={card}>
          {authMode ? (
            <>
              {has("google") && <button style={btn} onClick={() => signIn("google", { callbackUrl: "/" })}>Continue with Google</button>}
              {has("microsoft-entra-id") && <button style={btn} onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/" })}>Continue with Microsoft</button>}
              {has("resend") && (
                sent ? (
                  <div style={{ textAlign: "center", padding: "8px 0", color: "#1E9E57", fontWeight: 700, fontSize: 14 }}>
                    Check your email for a sign-in link ✉️
                  </div>
                ) : (
                  <>
                    {(has("google") || has("microsoft-entra-id")) && <div style={{ textAlign: "center", color: "#aaa", fontSize: 12, margin: "6px 0" }}>or with your email</div>}
                    <input style={inp} type="email" inputMode="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
                    <button style={{ ...btn, background: "#C8102E", color: "#fff", border: "none" }}
                      onClick={() => { if (email) { signIn("resend", { email, callbackUrl: "/", redirect: false }); setSent(true); } }}>
                      Email me a sign-in link
                    </button>
                  </>
                )
              )}
              <div style={{ fontSize: 11, color: "#998", textAlign: "center", marginTop: 8 }}>Use the email your coach has on file for your child.</div>
            </>
          ) : (
            <>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#6b5a5d" }}>Team code</label>
              <input type="password" value={pw} autoFocus onChange={(e) => { setPw(e.target.value); setErr(false); }} onKeyDown={(e) => e.key === "Enter" && legacyLogin()} placeholder="••••••••" style={{ ...inp, marginTop: 6 }} />
              {err && <div style={{ color: "#C8102E", fontSize: 13, marginBottom: 8 }}>Wrong code — check with your coach.</div>}
              <button style={{ ...btn, background: "#C8102E", color: "#fff", border: "none" }} onClick={legacyLogin} disabled={busy}>{busy ? "…" : "Enter"}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
