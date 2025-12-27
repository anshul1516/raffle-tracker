import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

function getBearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearer(req);
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { runId, commentId, field, value, expectedVersion } = await req.json();

    if (!runId || !commentId) {
      return NextResponse.json({ error: "runId and commentId required" }, { status: 400 });
    }
    if (!["payer", "beneficiary"].includes(field)) {
      return NextResponse.json({ error: "field must be payer or beneficiary" }, { status: 400 });
    }
    if (typeof expectedVersion !== "number") {
      return NextResponse.json({ error: "expectedVersion required" }, { status: 400 });
    }

    const db = supabaseAdmin();

    const { data: sessions, error: sErr } = await db
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

    const { data: existing, error: eErr } = await db
      .from("comment_overrides")
      .select("*")
      .eq("run_id", runId)
      .eq("comment_id", commentId)
      .maybeSingle();

    if (eErr) {
      console.error(eErr);
      return NextResponse.json({ error: "Failed to read override" }, { status: 500 });
    }

    const patch: any = {};
    if (field === "payer") patch.override_payer = value;
    if (field === "beneficiary") patch.override_beneficiary = value;

    if (!existing) {
      if (expectedVersion !== 0) {
        return NextResponse.json({ error: "Conflict" }, { status: 409 });
      }

      const { error: insErr } = await db.from("comment_overrides").insert({
        run_id: runId,
        comment_id: commentId,
        ...patch,
        version: 1,
        updated_at: new Date().toISOString(),
      });

      if (insErr) {
        console.error(insErr);
        return NextResponse.json({ error: "Failed to create override" }, { status: 500 });
      }

      return NextResponse.json({ ok: true, version: 1 });
    }

    if (existing.version !== expectedVersion) {
      return NextResponse.json({ error: "Conflict", latest: existing }, { status: 409 });
    }

    const newVersion = existing.version + 1;

    const { error: upErr } = await db
      .from("comment_overrides")
      .update({
        ...patch,
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
