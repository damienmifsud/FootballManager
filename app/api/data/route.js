import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";

export const dynamic = "force-dynamic";

// Both routes are already gated by middleware (the shared site password).
// Everyone with the team code can read and write — no separate roles.
export async function GET() {
  const data = await getData();
  return NextResponse.json(data ?? null);
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  await setData(body);
  return NextResponse.json({ ok: true });
}
