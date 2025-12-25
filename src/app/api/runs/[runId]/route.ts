import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await context.params;
    const token = req.nextUrl.searchParams.get("t");

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    const { data: access } = await supabaseAdmin
      .from("run_access")
      .select("*")
      .eq("run_id", runId)
      .eq("token", token)
      .maybeSingle();

    if (!access) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { data: run } = await supabaseAdmin
      .from("runs")
      .select("*")
      .eq("id", runId)
      .single();

    const { data: comments } = await supabaseAdmin
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

    return NextResponse.json({ run, comments });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
