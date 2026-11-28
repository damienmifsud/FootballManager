// One Messages API call for server routes, over fetch (the way /api/ask
// calls it). Returns the parsed response, or throws an Error carrying
// `status` (the HTTP status, or 0 when the API couldn't be reached).
const API = "https://api.anthropic.com/v1/messages";

export async function claudeMessages(body, { betas = [] } = {}) {
  let r;
  try {
    r = await fetch(API, {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        ...(betas.length ? { "anthropic-beta": betas.join(",") } : {})
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw Object.assign(new Error("unreachable"), { status: 0 });
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw Object.assign(new Error(`api ${r.status}`), { status: r.status, detail: detail.slice(0, 300) });
  }
  return r.json();
}

// The text of a response's text blocks, joined.
export const replyText = (res) => (res?.content || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
