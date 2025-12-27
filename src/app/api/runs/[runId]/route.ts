import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await context.params;
    const token = req.nextUrl.searchParams.get("t");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const db = supabaseAdmin();

    const { data: access, error: aErr } = await db
      .from("run_access")
      .select("*")
      .eq("run_id", runId)
      .eq("token", token)
      .maybeSingle();

    if (aErr) {
      console.error(aErr);
      return NextResponse.json({ error: "Auth check failed" }, { status: 500 });
    }
    if (!access) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const { data: run, error: rErr } = await db
      .from("runs")
      .select("*")
      .eq("id", runId)
      .single();

    if (rErr) {
      console.error(rErr);
      return NextResponse.json({ error: "Failed to load run" }, { status: 500 });
    }

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

    return NextResponse.json({ run, comments });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
