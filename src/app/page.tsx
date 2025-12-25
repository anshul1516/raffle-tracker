"use client";

import { useState } from "react";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [adminCode, setAdminCode] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const createRun = async () => {
    setLoading(true);
    setAdminCode(null);
    setShareUrl(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) return alert(json?.error || "Failed");

      setAdminCode(json.adminCode);
      setShareUrl(json.shareUrl);

      // Redirect immediately to the run page
      window.location.href = json.shareUrl;
    } catch (e) {
      console.error(e);
      alert("Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-semibold">Reddit Raffle Tracker</h1>

        <div className="text-zinc-400">
          Paste a Reddit post URL. You’ll get a shareable link. Editing requires an invite code.
        </div>

        <div className="flex gap-3">
          <input
            className="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="https://www.reddit.com/r/.../comments/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-6 py-3 font-medium"
            onClick={createRun}
            disabled={loading}
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>

        {adminCode && shareUrl ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 space-y-2">
            <div className="text-sm text-zinc-400">
              Admin code (save this — shown once):
            </div>
            <div className="font-mono text-lg text-zinc-100">{adminCode}</div>
            <div className="text-sm text-zinc-400">Share URL:</div>
            <div className="font-mono text-sm text-indigo-400">{shareUrl}</div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
