// A round's name, for a game whose round has no number in its draw: "Semi
// Finals", "Grand Final", "Pool A". Squadi, Dribl and Majestri all name such
// rounds; the sync keeps the name on the game (fixture.roundName) so it is
// called what the draw calls it instead of a dash.
//
// Pure, with no imports: the draw readers, the sync and the pages all use it.
export const ROUND_NAME_MAX = 40;

// The name as kept: plain text, short. One that is only a number, or "Round 3"
// or "R3", is a numbered round and no name.
export function roundNameText(v) {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, ROUND_NAME_MAX) : "";
  return t && !/^(?:round\s*|r)?\d+$/i.test(t) ? t : "";
}

// The name where a round number usually goes (a narrow column): the first
// letters of its words, at most three. "Semi Finals" is SF, "Grand Final" GF.
export function roundTag(name) {
  const words = roundNameText(name).split(/[\s-]+/).filter((w) => /^[a-z]/i.test(w));
  return words.slice(0, 3).map((w) => w[0].toUpperCase()).join("");
}
