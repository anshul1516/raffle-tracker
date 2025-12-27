import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

type RunSessionRow = { run_id: string; token: string; role: string; expires_at: string };

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await context.params;
    const token = req.nextUrl.searchParams.get("t");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const db = supabaseAdmin();

    const { data: sessionsData, error: sErr } = await db
      .from("run_sessions")
      .select("*")
      .eq("run_id", runId)
      .eq("token", token);

    if (sErr) {
      console.error(sErr);
      return NextResponse.json({ error: "Auth failed" }, { status: 500 });
    }

    const session = ((sessionsData || []) as unknown as RunSessionRow[])[0];
    if (!session) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const expMs = Date.parse(session.expires_at);
    if (!Number.isFinite(expMs) || expMs < Date.now()) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }

    const { data: run, error: rErr } = await db
      .from("runs")
      .select("*")
      .eq("id", runId)
      .single();

    if (rErr) {
      console.error(rErr);
      return NextResponse.json({ error: "Failed to load run" }, { status: 500 });
    }

    // Fetch comments + override row (may be null)
    const { data: comments, error: cErr } = await db
      .from("comments")
      .select(
        `
        *,
        comment_overrides (
          skipped,
          override_spots,
          override_payer,
          override_beneficiary,
          version
        )
      `
      )
      .eq("run_id", runId);

    if (cErr) {
      console.error(cErr);
      return NextResponse.json({ error: "Failed to load comments" }, { status: 500 });
    }

    return NextResponse.json({
      run,
      role: session.role,
      comments: comments || [],
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
