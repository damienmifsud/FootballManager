"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw })
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setErr(true);
        setBusy(false);
      }
    } catch {
      setErr(true);
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, fontFamily: "system-ui, sans-serif",
      background: "linear-gradient(160deg,#C8102E,#7A0A1B)"
    }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 22, color: "#fff" }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18, background: "#fff", color: "#C8102E",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
            fontWeight: 800, fontSize: 26, fontFamily: "Georgia, serif"
          }}>⚽</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: ".01em" }}>Team Dashboard</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>Enter the team code to continue</div>
        </div>

        <div style={{ background: "#fff", borderRadius: 18, padding: 18, boxShadow: "0 16px 40px rgba(60,0,10,.35)" }}>
          <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#6b5a5d" }}>Team code</label>
          <input
            type="password"
            value={pw}
            autoFocus
            onChange={(e) => { setPw(e.target.value); setErr(false); }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="••••••••"
            style={{
              width: "100%", boxSizing: "border-box", marginTop: 6, marginBottom: err ? 6 : 12,
              padding: "13px 14px", borderRadius: 12, fontSize: 16,
              border: err ? "1px solid #E5484D" : "1px solid #e7e3e3", background: "#faf9f9"
            }}
          />
          {err && <div style={{ color: "#E5484D", fontSize: 12.5, marginBottom: 12 }}>That code didn't work — check with your coach.</div>}
          <button
            onClick={submit}
            disabled={busy}
            style={{
              width: "100%", padding: 14, borderRadius: 12, border: "none", cursor: "pointer",
              background: "#C8102E", color: "#fff", fontWeight: 800, fontSize: 15, opacity: busy ? 0.7 : 1
            }}
          >
            {busy ? "Checking…" : "Enter"}
          </button>
        </div>
        <div style={{ textAlign: "center", color: "#fff", opacity: 0.7, fontSize: 11.5, marginTop: 14 }}>
          One shared code for the whole team.
        </div>
      </div>
    </div>
  );
}
