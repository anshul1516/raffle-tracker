import { NextResponse, NextRequest } from "next/server";
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
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { data: sessions, error: sErr } = await supabaseAdmin
      .from("run_sessions")
      .select("*")
      .eq("run_id", runId)
      .eq("token", token);

    if (sErr) {
      console.error(sErr);
      return NextResponse.json({ error: "Failed auth" }, { status: 500 });
    }

    const session = (sessions || [])[0];
    if (!session) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    if (new Date(session.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }

    if (!["editor", "admin"].includes(session.role)) {
      return NextResponse.json({ error: "Read-only token" }, { status: 403 });
    }

    const body = await req.json();
    const {
      skipped,
      override_spots,
      override_payer,
      override_beneficiary,
      expectedVersion,
    } = body ?? {};

    if (typeof expectedVersion !== "number") {
      return NextResponse.json({ error: "expectedVersion required" }, { status: 400 });
    }

    // Read existing override (if any)
    const { data: existing, error: eErr } = await supabaseAdmin
      .from("comment_overrides")
      .select("*")
      .eq("run_id", runId)
      .eq("comment_id", commentId)
      .maybeSingle();

    if (eErr) {
      console.error(eErr);
      return NextResponse.json({ error: "Failed to read override" }, { status: 500 });
    }

    // If none exists, create it (version = 1)
    if (!existing) {
      const { error: insErr } = await supabaseAdmin.from("comment_overrides").insert({
        run_id: runId,
        comment_id: commentId,
        skipped: typeof skipped === "boolean" ? skipped : false,
        override_spots: override_spots ?? null,
        override_payer: override_payer ?? null,
        override_beneficiary: override_beneficiary ?? null,
        version: 1,
        updated_at: new Date().toISOString(),
      });

      if (insErr) {
        console.error(insErr);
        return NextResponse.json({ error: "Failed to create override" }, { status: 500 });
      }

      // If the client expected an existing row, signal conflict
      if (expectedVersion !== 0) {
        return NextResponse.json({ error: "Conflict", latest: { version: 1 } }, { status: 409 });
      }

      return NextResponse.json({ ok: true, version: 1 });
    }

    // Optimistic concurrency check
    if (existing.version !== expectedVersion) {
      return NextResponse.json(
        {
          error: "Conflict",
          latest: {
            skipped: existing.skipped,
            override_spots: existing.override_spots,
            override_payer: existing.override_payer,
            override_beneficiary: existing.override_beneficiary,
            version: existing.version,
          },
        },
        { status: 409 }
      );
    }

    const newVersion = existing.version + 1;

    // Update only if version matches (guards against races)
    const { error: upErr } = await supabaseAdmin
      .from("comment_overrides")
      .update({
        skipped: typeof skipped === "boolean" ? skipped : existing.skipped,
        override_spots: override_spots ?? existing.override_spots,
        override_payer: override_payer ?? existing.override_payer,
        override_beneficiary: override_beneficiary ?? existing.override_beneficiary,
        version: newVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("run_id", runId)
      .eq("comment_id", commentId)
      .eq("version", existing.version);

    if (upErr) {
      console.error(upErr);
      return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, version: newVersion });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
