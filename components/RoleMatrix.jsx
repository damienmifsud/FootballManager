"use client";
import React from "react";
// "Who can do what" — the role matrix from lib/roleMatrix.js as a compact
// table for the /admin page. Pure presentation; the data file is the source.
// Styled by the adm- classes in AdminShell (tinted pills, hairlines); on a
// phone the table scrolls sideways with the feature column pinned.
import { ROLES, MARKS, ROLE_MATRIX, ROLE_MATRIX_NOTES } from "@/lib/roleMatrix";

// Fills over outlines: a soft tint with strong-coloured text per answer.
const TONE = { yes: " ok", part: " warn", no: " bad", muted: "" };

function Mark({ value }) {
  const m = MARKS[value] || MARKS.no;
  return <span className={"adm-pill" + (TONE[m.tone] || "")}>{m.label}</span>;
}

export default function RoleMatrix() {
  return (
    <div>
      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Feature</th>
              {ROLES.map((r) => (
                <th key={r.key} scope="col">
                  {r.label}
                  <small>{r.note}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_MATRIX.map((g) => (
              <React.Fragment key={g.group}>
                <tr className="grp">
                  <td colSpan={ROLES.length + 1}>{g.group}</td>
                </tr>
                {g.rows.map((row) => (
                  <tr key={row.feature}>
                    <td className="feat">
                      {row.feature}
                      {row.note && <small>{row.note}</small>}
                    </td>
                    {ROLES.map((r) => <td key={r.key}><Mark value={row[r.key]} /></td>)}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="adm-list">
        {ROLE_MATRIX_NOTES.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
}
