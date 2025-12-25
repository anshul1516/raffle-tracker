import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { parseComment, PARSER_VERSION } from "@/lib/parser/parseComment";
import { randomUUID } from "crypto";

async function fetchReddit(postId: string, subreddit: string) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?raw_json=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch Reddit");

  const json = await res.json();
  const post = json[0]?.data?.children?.[0]?.data;
  const comments =
    json[1]?.data?.children
      ?.filter((c: any) => c.kind === "t1")
      .map((c: any) => ({
        id: c.data.id,
        author: c.data.author,
        body: c.data.body,
        permalink: `https://reddit.com${c.data.permalink}`,
      })) ?? [];

  return { post, comments };
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    const m = url?.match(/reddit\.com\/r\/([^/]+)\/comments\/([^/]+)/);
    if (!m) {
      return NextResponse.json({ error: "Invalid Reddit URL" }, { status: 400 });
    }

    const subreddit = m[1];
    const post_id = m[2];

    const { post, comments } = await fetchReddit(post_id, subreddit);

    const runId = randomUUID();
    const token = randomUUID();

    await supabaseAdmin.from("runs").insert({
      id: runId,
      subreddit,
      post_id,
      post_url: url,
      title: post?.title ?? null,
      parser_version: PARSER_VERSION,
    });

    await supabaseAdmin.from("run_access").insert({
      run_id: runId,
      token,
    });

    const parsedRows = comments.map((c) => {
      const parsed = parseComment(c.body, c.author, c.id);
      return {
        run_id: runId,
        comment_id: c.id,
        author: parsed.author,
        body: c.body,
        permalink: c.permalink,
        parsed,
        spots: parsed.spots,
        payer: parsed.payer,
        beneficiary: parsed.beneficiary,
        is_tab: parsed.isTab,
        needs_review: parsed.needsReview,
      };
    });

    if (parsedRows.length) {
      await supabaseAdmin.from("comments").insert(parsedRows);
    }

    return NextResponse.json({
      runId,
      token,
      shareUrl: `/r/${runId}?t=${token}`,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
