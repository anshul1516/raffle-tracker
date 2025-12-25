import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const { id, beneficiary, payer } = await req.json();
    if (!id || (!beneficiary && !payer)) {
      return NextResponse.json({ error: "id and at least one field to update required" }, { status: 400 });
    }

    const updateData: Record<string, any> = {};
    if (beneficiary) updateData.beneficiary = beneficiary;
    if (payer) updateData.payer = payer;
    updateData.needs_review = false; // mark resolved

    const { data, error } = await supabaseAdmin
      .from("comments")
      .update(updateData)
      .eq("id", id)
      .select();

    return NextResponse.json({ data, error });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
