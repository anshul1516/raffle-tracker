import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  const { data, error } = await supabaseAdmin.from("comments").upsert({
    id: "t1_test123",
    post_id: "p1",
    author: "u/Bob",
    body: "Test comment",
    spots: 1,
    beneficiary: "u/Bob",
    payer: "u/Bob",
    is_tab: false,
    needs_review: false,
    raw_data: {},
  });

  return NextResponse.json({ data, error });
}
