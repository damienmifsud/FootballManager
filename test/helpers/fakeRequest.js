// Minimal stand-ins for the Next.js request surface the route handlers use:
//   req.json(), req.cookies.get(name)?.value, req.headers.get(name), req.url
export function fakeRequest({ url = "https://x.test/", body, cookies = {}, headers = {} } = {}) {
  const lc = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url,
    json: async () => {
      if (body === undefined) throw new SyntaxError("no body");
      return body;
    },
    cookies: { get: (name) => (name in cookies ? { value: cookies[name] } : undefined) },
    headers: { get: (name) => lc[name.toLowerCase()] ?? null }
  };
}
