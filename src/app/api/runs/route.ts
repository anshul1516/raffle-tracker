import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { parseComment } from "@/lib/parser/parseComment";
import { PARSER_VERSION } from "@/lib/parser/version";
import crypto from "crypto";

function parseRedditUrl(url: string) {
  const match = url.match(/reddit\.com\/r\/([^/]+)\/comments\/([^/]+)/);
  if (!match) return null;
  return { subreddit: match[1], post_id: match[2] };
}

function extractTitleSpots(title: string): number | null {
  const m = title.match(/#?\s*(\d{1,5})\s*spots?\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function extractRaffleToolBlock(postBody: string): string | null {
  const m = postBody.match(/<raffle-tool>([\s\S]*?)<\/raffle-(?:tool|toll)>/i);
  if (!m) return null;
  return m[1].trim();
}

function randomCode(bytes = 16) {
  const raw = crypto.randomBytes(bytes).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

async function fetchRedditPostAndComments(subreddit: string, postId: string) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?raw_json=1`;
  const res = await fetch(url, { headers: { "User-Agent": "raffle-tracker/1.0" } });
  if (!res.ok) throw new Error(`Reddit fetch failed: ${res.status}`);

  const json = await res.json();
  const post = json?.[0]?.data?.children?.[0]?.data;
  const title = post?.title ?? "";
  const selftext = post?.selftext ?? "";

  const comments =
    json?.[1]?.data?.children
      ?.filter((c: any) => c.kind === "t1")
      .map((c: any) => ({
        comment_id: c.data.id,
        author: c.data.author,
        body: c.data.body,
        permalink: `https://reddit.com${c.data.permalink}`,
      })) || [];

  return { title, selftext, comments };
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    const postUrl = (url || "").trim();
    const parsed = parseRedditUrl(postUrl);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid Reddit post URL" }, { status: 400 });
    }

    const { subreddit, post_id } = parsed;

    const { title, selftext, comments } = await fetchRedditPostAndComments(subreddit, post_id);

    const totalSpotsFromTitle = extractTitleSpots(title);
    const raffleToolBlock = extractRaffleToolBlock(selftext);

    const { data: runRow, error: runErr } = await supabaseAdmin
      .from("runs")
      .insert({
        subreddit,
        post_id,
        post_url: postUrl,
        title,
        total_spots_from_title: totalSpotsFromTitle,
        raffle_tool_block: raffleToolBlock,
        parser_version: PARSER_VERSION,
      })
      .select("*")
      .single();

    if (runErr || !runRow) {
      console.error(runErr);
      return NextResponse.json({ error: "Failed to create run" }, { status: 500 });
    }

    // create admin code
    const adminCode = randomCode();
    const adminHash = hashCode(adminCode);

    const { error: codeErr } = await supabaseAdmin.from("run_access_codes").insert({
      run_id: runRow.id,
      code_hash: adminHash,
      role: "admin",
      label: "owner",
    });

    if (codeErr) {
      console.error(codeErr);
      return NextResponse.json({ error: "Failed to create admin code" }, { status: 500 });
    }

    // upsert comments
    const toUpsert = comments.map((c: any) => {
      const parsedC = parseComment(c.body, c.author, c.comment_id);
      return {
        run_id: runRow.id,
        comment_id: c.comment_id,
        post_id,
        subreddit,
        author: parsedC.author,
        body: c.body,
        permalink: c.permalink,
        spots: parsedC.spots,
        payer: parsedC.payer,
        beneficiary: parsedC.beneficiary,
        is_tab: parsedC.isTab,
        needs_review: parsedC.needsReview,
        parsed: parsedC,
      };
    });

    if (toUpsert.length) {
      const { error: upErr } = await supabaseAdmin.from("comments").upsert(toUpsert);
      if (upErr) console.error("comments upsert error:", upErr);
    }

    const base =
      process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";
    const shareUrl = `${base}/r/${runRow.id}`;

    return NextResponse.json({
      runId: runRow.id,
      shareUrl,
      adminCode,
      title,
      totalSpotsFromTitle,
      raffleToolBlock,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
