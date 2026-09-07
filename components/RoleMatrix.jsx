"use client";
import React from "react";
// "Who can do what" — the role matrix from lib/roleMatrix.js as a compact
// table for the /admin page. Pure presentation; the data file is the source.
import { ROLES, MARKS, ROLE_MATRIX, ROLE_MATRIX_NOTES } from "@/lib/roleMatrix";

const TONE = {
  yes: { background: "#e6f6ec", color: "#1E9E57" },
  part: { background: "#fff1da", color: "#b3760a" },
  no: { background: "#fdecec", color: "#C8102E" },
  muted: { background: "#f1edee", color: "#7a6f72" }
};

const th = { textAlign: "left", fontSize: 11, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "#7a6f72", padding: "8px 6px", borderBottom: "1px solid #eee", verticalAlign: "bottom" };
const td = { fontSize: 12.5, padding: "7px 6px", borderBottom: "1px solid #f3eff0", verticalAlign: "top" };

function Mark({ value }) {
  const m = MARKS[value] || MARKS.no;
  return (
    <span style={{ ...TONE[m.tone], display: "inline-block", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
      {m.label}
    </span>
  );
}

export default function RoleMatrix() {
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr>
              <th style={th}>Feature</th>
              {ROLES.map((r) => (
                <th key={r.key} style={th}>
                  {r.label}
                  <div style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, fontSize: 10.5, marginTop: 2 }}>{r.note}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_MATRIX.map((g) => (
              <React.Fragment key={g.group}>
                <tr>
                  <td colSpan={ROLES.length + 1} style={{ ...td, fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "#C8102E", paddingTop: 14 }}>{g.group}</td>
                </tr>
                {g.rows.map((row) => (
                  <tr key={row.feature}>
                    <td style={{ ...td, fontWeight: 600, color: "#1d1417" }}>
                      {row.feature}
                      {row.note && <div style={{ fontSize: 11, color: "#7a6f72", fontWeight: 500, marginTop: 2 }}>{row.note}</div>}
                    </td>
                    {ROLES.map((r) => <td key={r.key} style={td}><Mark value={row[r.key]} /></td>)}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 12, color: "#7a6f72", lineHeight: 1.5 }}>
        {ROLE_MATRIX_NOTES.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
}
