import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const body = await req.json();

    const runId = body?.runId;
    const commentId = body?.commentId;

    if (!runId || !commentId) {
      return NextResponse.json({ error: "runId and commentId required" }, { status: 400 });
    }
    if (typeof body?.expectedVersion !== "number") {
      return NextResponse.json({ error: "expectedVersion required" }, { status: 400 });
    }

    const res = await fetch(
      new URL(`/api/runs/${runId}/comments/${commentId}/override`, req.url),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({
          skipped: body?.skipped,
          override_spots: body?.override_spots,
          override_payer: body?.override_payer,
          override_beneficiary: body?.override_beneficiary,
          expectedVersion: body?.expectedVersion,
        }),
      }
    );

    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
