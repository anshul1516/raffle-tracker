import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

function getBearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ runId: string; commentId: string }> }
) {
  try {
    const { runId, commentId } = await context.params;
    const token = getBearer(req);

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

    const {
      skipped,
      override_spots,
      override_payer,
      override_beneficiary,
      expectedVersion,
    } = await req.json();

    if (typeof expectedVersion !== "number") {
      return NextResponse.json(
        { error: "expectedVersion required" },
        { status: 400 }
      );
    }

    const { data: existing } = await supabaseAdmin
      .from("comment_overrides")
      .select("*")
      .eq("run_id", runId)
      .eq("comment_id", commentId)
      .maybeSingle();

    if (!existing) {
      if (expectedVersion !== 0) {
        return NextResponse.json({ error: "Conflict" }, { status: 409 });
      }

      await supabaseAdmin.from("comment_overrides").insert({
        run_id: runId,
        comment_id: commentId,
        skipped: !!skipped,
        override_spots: override_spots ?? null,
        override_payer: override_payer ?? null,
        override_beneficiary: override_beneficiary ?? null,
        version: 1,
      });

      return NextResponse.json({ ok: true, version: 1 });
    }

    if (existing.version !== expectedVersion) {
      return NextResponse.json(
        { error: "Conflict", latest: existing },
        { status: 409 }
      );
    }

    const newVersion = existing.version + 1;

    await supabaseAdmin
      .from("comment_overrides")
      .update({
        skipped: typeof skipped === "boolean" ? skipped : existing.skipped,
        override_spots: override_spots ?? existing.override_spots,
        override_payer: override_payer ?? existing.override_payer,
        override_beneficiary:
          override_beneficiary ?? existing.override_beneficiary,
        version: newVersion,
      })
      .eq("run_id", runId)
      .eq("comment_id", commentId)
      .eq("version", existing.version);

    return NextResponse.json({ ok: true, version: newVersion });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
