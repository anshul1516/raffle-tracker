import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { parseComment } from "@/lib/parser/parseComment";

function parseTotalSpotsFromTitle(title: string): number | null {
  const m1 = title.match(/#\s*(\d+)\s*spots?\b/i);
  if (m1) return parseInt(m1[1], 10);

  const m2 = title.match(/\b(\d+)\s*spots?\b/i);
  if (m2) return parseInt(m2[1], 10);

  return null;
}

/**
 * Extract content between <raffle-tool> ... </raffle-toll>
 * Also supports </raffle-tool> in case the closing tag is corrected later.
 */
function extractRaffleToolBlock(selftext: string): string | null {
  if (!selftext) return null;

  // Support both possible closing tags
  const patterns = [
    /<raffle-tool>([\s\S]*?)<\/raffle-toll>/i,
    /<raffle-tool>([\s\S]*?)<\/raffle-tool>/i,
  ];

  for (const re of patterns) {
    const m = selftext.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

async function fetchRedditThread(postId: string, subreddit: string) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?raw_json=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "raffle-tracker/1.0" },
  });

  if (!res.ok) {
    return {
      title: "",
      totalSpotsFromTitle: null as number | null,
      raffleToolBlock: null as string | null,
      comments: [] as Array<{ id: string; author: string; body: string }>,
    };
  }

  const json = await res.json();

  const post = json?.[0]?.data?.children?.[0]?.data;
  const title: string = post?.title ?? "";
  const selftext: string = post?.selftext ?? "";

  const totalSpotsFromTitle = title ? parseTotalSpotsFromTitle(title) : null;
  const raffleToolBlock = extractRaffleToolBlock(selftext);

  const comments =
    json?.[1]?.data?.children
      ?.filter((c: any) => c.kind === "t1")
      .map((c: any) => ({
        id: c.data.id,
        author: c.data.author,
        body: c.data.body,
      })) ?? [];

  return { title, totalSpotsFromTitle, raffleToolBlock, comments };
}

export async function POST(req: Request) {
  try {
    const { post_id, subreddit } = await req.json();
    if (!post_id || !subreddit) {
      return NextResponse.json(
        { error: "post_id and subreddit required" },
        { status: 400 }
      );
    }

    const { title, totalSpotsFromTitle, raffleToolBlock, comments } =
      await fetchRedditThread(post_id, subreddit);

    const parsedRows = comments.map((c) => {
      const parsed = parseComment(c.body, c.author, c.id);
      return {
        id: parsed.commentId,
        post_id,
        author: parsed.author,
        body: parsed.raw,
        spots: parsed.spots,
        payer: parsed.payer,
        beneficiary: parsed.beneficiary,
        is_tab: parsed.isTab,
        needs_review: parsed.needsReview,
        raw_data: parsed,
      };
    });

    const { data, error } = await supabaseAdmin
      .from("comments")
      .upsert(parsedRows)
      .select();

    if (error) {
      console.error("Supabase upsert error:", error);
      return NextResponse.json(
        { error: "Supabase error", details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      title,
      totalSpotsFromTitle,
      raffleToolBlock,
      comments: data ?? [],
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
