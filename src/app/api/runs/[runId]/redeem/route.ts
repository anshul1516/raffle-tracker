import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await context.params;

    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "code required" }, { status: 400 });
    }

    const codeHash = hashCode(code.trim().toUpperCase());

    const { data: codes, error } = await supabaseAdmin
      .from("run_access_codes")
      .select("*")
      .eq("run_id", runId)
      .eq("code_hash", codeHash)
      .eq("revoked", false);

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "Failed to verify code" }, { status: 500 });
    }

    const match = (codes || [])[0];
    if (!match) return NextResponse.json({ error: "Invalid code" }, { status: 401 });

    if (match.expires_at && new Date(match.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Code expired" }, { status: 401 });
    }

    // Create session token valid for 7 days
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    const { error: sErr } = await supabaseAdmin.from("run_sessions").insert({
      run_id: runId,
      token,
      role: match.role,
      expires_at: expiresAt,
    });

    if (sErr) {
      console.error(sErr);
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    return NextResponse.json({
      token,
      role: match.role,
      expiresAt,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
