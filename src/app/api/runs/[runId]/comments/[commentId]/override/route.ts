import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

type RunSessionRow = {
  run_id: string;
  token: string;
  role: "viewer" | "editor" | "admin" | string;
  expires_at: string;
};

type CommentOverrideRow = {
  run_id: string;
  comment_id: string;
  skipped: boolean | null;
  override_spots: number | null;
  override_payer: string | null;
  override_beneficiary: string | null;
  version: number;
  updated_at?: string | null;
};

function getBearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Tiny helper to avoid Supabase "never" types when Database types aren't generated yet.
function t(db: any, table: string) {
  return db.from(table) as any;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ runId: string; commentId: string }> }
) {
  try {
    const { runId, commentId } = await context.params;

    const token = getBearer(req);
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const db = supabaseAdmin();

    // ---- auth ----
    const { data: sessionsData, error: sErr } = await t(db, "run_sessions")
      .select("*")
      .eq("run_id", runId)
      .eq("token", token);

    if (sErr) {
      console.error(sErr);
      return NextResponse.json({ error: "Failed auth" }, { status: 500 });
    }

    const session = ((sessionsData || []) as RunSessionRow[])[0];
    if (!session) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const expMs = Date.parse(session.expires_at);
    if (!Number.isFinite(expMs) || expMs < Date.now()) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }

    if (!["editor", "admin"].includes(session.role)) {
      return NextResponse.json({ error: "Read-only token" }, { status: 403 });
    }

    // ---- payload ----
    const body = await req.json();
    const { skipped, override_spots, override_payer, override_beneficiary, expectedVersion } = body ?? {};

    if (typeof expectedVersion !== "number") {
      return NextResponse.json({ error: "expectedVersion required" }, { status: 400 });
    }

    // ---- existing override ----
    const { data: existingData, error: eErr } = await t(db, "comment_overrides")
      .select("*")
      .eq("run_id", runId)
      .eq("comment_id", commentId)
      .maybeSingle();

    if (eErr) {
      console.error(eErr);
      return NextResponse.json({ error: "Failed to read override" }, { status: 500 });
    }

    const existing = (existingData ?? null) as CommentOverrideRow | null;

    // ---- insert ----
    if (!existing) {
      if (expectedVersion !== 0) {
        return NextResponse.json({ error: "Conflict" }, { status: 409 });
      }

      const { error: insErr } = await t(db, "comment_overrides").insert({
        run_id: runId,
        comment_id: commentId,
        skipped: typeof skipped === "boolean" ? skipped : false,
        override_spots: typeof override_spots === "number" ? override_spots : null,
        override_payer: typeof override_payer === "string" ? override_payer : null,
        override_beneficiary: typeof override_beneficiary === "string" ? override_beneficiary : null,
        version: 1,
        updated_at: new Date().toISOString(),
      });

      if (insErr) {
        console.error(insErr);
        return NextResponse.json({ error: "Failed to create override" }, { status: 500 });
      }

      return NextResponse.json({ ok: true, version: 1 });
    }

    // ---- optimistic concurrency ----
    if (existing.version !== expectedVersion) {
      return NextResponse.json({ error: "Conflict", latest: existing }, { status: 409 });
    }

    const newVersion = existing.version + 1;

    const { error: upErr } = await t(db, "comment_overrides")
      .update({
        skipped: typeof skipped === "boolean" ? skipped : existing.skipped,
        override_spots: typeof override_spots === "number" ? override_spots : existing.override_spots,
        override_payer: typeof override_payer === "string" ? override_payer : existing.override_payer,
        override_beneficiary:
          typeof override_beneficiary === "string" ? override_beneficiary : existing.override_beneficiary,
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
