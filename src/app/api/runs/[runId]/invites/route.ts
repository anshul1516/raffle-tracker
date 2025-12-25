import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

function randomCode(bytes = 16) {
  const raw = crypto.randomBytes(bytes).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export async function POST(
  req: Request,
  { params }: { params: { runId: string } }
) {
  try {
    const runId = params.runId;
    const { adminCode, role, label } = await req.json();

    if (!adminCode) return NextResponse.json({ error: "adminCode required" }, { status: 400 });
    if (!role || !["viewer", "editor"].includes(role)) {
      return NextResponse.json({ error: "role must be viewer or editor" }, { status: 400 });
    }

    const adminHash = hashCode(String(adminCode).trim().toUpperCase());

    // verify admin code exists
    const { data: codes, error } = await supabaseAdmin
      .from("run_access_codes")
      .select("*")
      .eq("run_id", runId)
      .eq("code_hash", adminHash)
      .eq("role", "admin")
      .eq("revoked", false);

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "Failed to verify admin code" }, { status: 500 });
    }
    if (!codes || !codes.length) return NextResponse.json({ error: "Invalid admin code" }, { status: 401 });

    const inviteCode = randomCode();
    const inviteHash = hashCode(inviteCode);

    const { error: iErr } = await supabaseAdmin.from("run_access_codes").insert({
      run_id: runId,
      code_hash: inviteHash,
      role,
      label: label || null,
    });

    if (iErr) {
      console.error(iErr);
      return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
    }

    return NextResponse.json({ inviteCode, role });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
