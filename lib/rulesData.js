// Structured MiniRoos playing formats (factual rules by age group), drawn from the
// Football Australia / Coles MiniRoos National Playing Formats. Encoded as data so
// the assistant can answer format questions precisely and age-qualified. This is
// built in for every team, regardless of what the coach has uploaded.
export const MINIROOS_FORMATS = {
  source: "Football Australia / Coles MiniRoos – National Playing Formats and Rules",
  common: {
    halfTimeBreak: "minimum 5 minutes",
    startOfPlay: "pass to a teammate from the middle of the halfway line; opponents at least 5m away; the ball must touch a teammate before a goal can be scored",
    offside: "no offside in U6-U9; game leaders discourage standing in offside positions",
    matchResults: "results are recorded only to place teams in appropriate leagues; not published publicly",
    pointsTables: "no points tables/ladders in U6-U11",
    throwIn: "standard two-handed throw-in; opponents at least 5m away; no goal direct from a throw-in",
    cornerKick: "a goal may be scored directly from a corner kick",
    goalkeeperRestart: "(U8+) GK throws/rolls or plays from the ground within 6 seconds; may not kick or drop-kick directly from the hands; opponents at least 10m outside the penalty area until the ball is in play"
  },
  ageGroups: {
    "U6-U7": {
      players: "4-a-side, no goalkeeper",
      maxSubstitutes: 3,
      field: "30m x 20m",
      goalSize: "2m wide x 1m high",
      ballSize: "Size 3",
      halves: "two 20-minute halves",
      penaltyArea: "none required",
      pitchesPerField: "up to 8 on a full-size pitch"
    },
    "U8-U9": {
      players: "7-a-side including a goalkeeper",
      maxSubstitutes: 4,
      field: "minimum 40m x 30m; best practice 45m x 35m; maximum 50m x 40m",
      goalSize: "3m wide x 2m high",
      ballSize: "Size 3",
      halves: "two 20-minute halves",
      penaltyArea: "5m deep x 12m wide",
      penaltyKick: "8m penalty mark; only a goalkeeper in position; others outside the area and at least 5m behind the mark",
      pitchesPerField: "up to 4 on a full-size pitch",
      note: "This is the format Olympic FC U8 Kangaroos plays."
    },
    "U10-U11": {
      players: "9-a-side including a goalkeeper",
      maxSubstitutes: 5,
      field: "minimum 60m x 40m; best practice 65m x 45m; maximum 70m x 50m",
      goalSize: "maximum 5m wide x 2m high",
      ballSize: "Size 4",
      halves: "two 25-minute halves",
      penaltyArea: "10m deep x 20m wide",
      pitchesPerField: "maximum 2 on a full-size pitch (or 1 penalty-box to penalty-box)"
    }
  },
  notes: [
    "The FQ Junior Academy (U9-U12) is a separate program from MiniRoos/Kangaroos and has its own Football Queensland guidelines.",
    "U12+, divisional and advanced leagues follow their own Rules of Competition."
  ]
};

export function rulesAsText() {
  return "### Built-in reference: MiniRoos National Playing Formats (structured data)\n" +
    "Use this for any team-size, ball-size, field-size, game-duration or basic-rules question. " +
    "Match the age group to the question and state which age group your answer is for.\n" +
    JSON.stringify(MINIROOS_FORMATS, null, 1);
}
