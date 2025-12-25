import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  { params }: { params: { runId: string } }
) {
  try {
    const runId = params.runId;

    const { data: run, error: runErr } = await supabaseAdmin
      .from("runs")
      .select("*")
      .eq("id", runId)
      .single();

    if (runErr || !run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const { data: comments, error: cErr } = await supabaseAdmin
      .from("comments")
      .select("*")
      .eq("run_id", runId);

    if (cErr) {
      console.error(cErr);
      return NextResponse.json({ error: "Failed to load comments" }, { status: 500 });
    }

    const { data: overrides, error: oErr } = await supabaseAdmin
      .from("comment_overrides")
      .select("*")
      .eq("run_id", runId);

    if (oErr) {
      console.error(oErr);
      return NextResponse.json({ error: "Failed to load overrides" }, { status: 500 });
    }

    const overrideMap = new Map<string, any>();
    for (const o of overrides || []) overrideMap.set(o.comment_id, o);

    const merged = (comments || []).map((c: any) => {
      const o = overrideMap.get(c.comment_id);
      return {
        id: c.comment_id,
        post_id: c.post_id,
        author: c.author,
        body: c.body,
        permalink: c.permalink,
        payer: c.payer,
        beneficiary: c.beneficiary,
        spots: c.spots,
        is_tab: c.is_tab,
        needs_review: c.needs_review,

        // override fields (if exist)
        skipped: o?.skipped ?? false,
        overrideSpots: o?.override_spots ?? null,
        overridePayer: o?.override_payer ?? null,
        overrideBeneficiary: o?.override_beneficiary ?? null,
        overrideVersion: o?.version ?? 0,
      };
    });

    return NextResponse.json({
      run: {
        id: run.id,
        title: run.title,
        subreddit: run.subreddit,
        post_id: run.post_id,
        post_url: run.post_url,
        raffleToolBlock: run.raffle_tool_block,
        totalSpotsFromTitle: run.total_spots_from_title,
        parserVersion: run.parser_version,
      },
      comments: merged,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
