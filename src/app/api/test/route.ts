import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET(_req: NextRequest) {
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from("runs").select("id").limit(1);

    if (error) {
      console.error(error);
      return NextResponse.json({ ok: false, error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sample: data || [] });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
