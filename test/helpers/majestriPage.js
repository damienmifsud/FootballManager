// A made-up Majestri competition page, in the shape a real one has: the
// breadcrumbs and heading, the ladder with each team's own page, then each
// round's games with the date, time, field, teams and, once played, the score.
// Every name, number and address is made up.
export const HOST = "riversidefc.majestri.com.au";
export const COMP = `https://${HOST}/comp-summary?compID=9001`;
export const TEAM_PAGE = `https://${HOST}/team-summary?teamID=7001&compID=9001`;

export const fixture = ({ field = "field5", time = "4:30 pm", home, away, homeScore, awayScore, locn = "Field 5", title = "", tba = false }) => {
  const sideOf = (cls, name, sc) => sc === undefined
    ? `<span class="team ${cls}"><span class="name">${name}</span></span>`
    : `<span class="team ${cls} showScore win"><span class="name">${name} <span class="score">${sc}</span></span><span class="outcome">${sc > (cls === "home" ? awayScore : homeScore) ? "Win" : sc === (cls === "home" ? awayScore : homeScore) ? "Draw" : "Loss"}</span></span>`;
  return `<li data-field="${field}" data-layout="36:Fives-2031"${tba ? ' class="tba"' : ""}>${title ? `<span class="title" style="margin-bottom:-.5rem;">${title}</span>` : ""}<span class="time">${time}</span><span class="matchup">${sideOf("home", home, homeScore)}${sideOf("away", away, awayScore)}</span><span class="locn">${locn}</span></li>`;
};
export const round = (id, name, date, games) => `<li><div class="actionContainer"><h2 id="${id}">${name}</h2></div><h3>${date}</h3><ul class="fixtures">${games.map(fixture).join("")}</ul></li>`;
export const ladderRow = (id, name) => `<li data-filter-club="0" class="searchable"><div class="team"><a href="team-summary?teamID=${id}&amp;compID=9001" class="default">${name}</a></div><span class="measure won">1</span></li>`;
export const PAGE = `<!DOCTYPE html><html><head><title>Riverside FC</title><script>var x = '<h2 id="rndfake">Round 99</h2><h3>Monday, 1 Jan 2031</h3><li data-field="field9"><span class="time">9:00 am</span><span class="matchup"><span class="team home"><span class="name">Riverside Rockets</span></span><span class="team away"><span class="name">Ghost Town</span></span></span><span class="locn">Field 9</span></li>';</script><style>.a{}</style></head><body class="">
<div id="header"><div class="page"><a class="orgName" href="/"><span>Riverside Football Club</span></a><a href="login" class="auth">Login</a></div></div>
<div id="mainPageWrapper"><div class="page">
<div id="breadcrumbs"><ul class="left"><li><a href="winter-fives-2031">Winter Fives 2031</a></li></ul></div>
<div class="actionContainer"><h1>Under 9 Mixed <span class="byLine">2031</span></h1></div>
<div class="ladderContainer searchableGroup"><ul class="ladder"><li class="header"><span class="team"><span class="expendable">Team</span></span></li>
${ladderRow(7001, "Riverside Rockets")}${ladderRow(7002, "Hilltop Hawks")}${ladderRow(7003, "Lakeside Lions &amp; Co")}${ladderRow(7004, "Valley Vipers")}${ladderRow(7005, "Riverside Rovers")}
</ul></div>
<ul class="nav"><li><a href="#rnd0a1b2c3">Round 1</a></li><li><a href="#rnd4d5e6f7">Round 2</a></li></ul>
<ul class="fixturesByDate">${round("rnd9f9f9f9", "Semi Finals ", "Thursday, 3 Jul 2031", [
  { home: "Riverside Rockets", away: "Valley Vipers", title: "Semi Final 1st vs 4th", time: "5:10 pm", locn: "Field 6", field: "field6" },
  { home: "Hilltop Hawks", away: "Lakeside Lions &amp; Co", title: "Semi Final 2nd vs 3rd" }
])}</ul>
<ul class="fixturesByDate">${round("rnd8e8e8e8", "Finals", "Thursday, 10 Jul 2031", [
  { home: "TBA", away: "TBA", title: "Grand Final", tba: true, time: "5:50 pm" }
])}</ul>
<ul class="fixturesByDate">${round("rnd0a1b2c3", "Round 1", "Thursday, 5 Jun 2031", [
  { home: "Riverside Rockets ", away: "Hilltop Hawks", homeScore: 5, awayScore: 2 },
  { home: "Lakeside Lions &amp; Co", away: "Valley Vipers", homeScore: 1, awayScore: 1, field: "field6", locn: "Field 6" }
])}${round("rnd4d5e6f7", "Round 2", "Thursday, 12 Jun 2031", [
  { home: "Valley Vipers", away: "Riverside Rockets", time: "12:15 pm", locn: "Field 7", field: "field7" },
  { home: "Hilltop Hawks", away: "Riverside Rovers" }
])}${round("rnd1c1c1c1", "Round 10", "Thursday, 19 Jun 2031", [
  { home: "Riverside Rockets", away: "Lakeside Lions &amp; Co", time: "4:30 pm" },
  { home: "Hilltop Hawks", away: "Riverside Rockets", time: "5:10 pm" },
  { home: "Riverside Rockets", away: "Bye", time: "5:50 pm" }
])}</ul>
</div></div></body></html>`;

