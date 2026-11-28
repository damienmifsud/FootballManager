// Which site this is: the real one families use, or a development site for
// trying changes before they go live. A development site is one deployed
// with APP_ENV=development: it says so on every page and sends no emails, so
// settings copied over from the real site can't message anyone from it.
export function isDevSite(env = process.env) {
  return String(env?.APP_ENV || "").trim().toLowerCase() === "development";
}
