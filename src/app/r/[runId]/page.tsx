"use client";

import { useEffect, useMemo, useState } from "react";

type CommentRow = {
  id: string;
  post_id: string;
  author: string;
  body: string;
  permalink: string;
  payer: string;
  beneficiary: string;
  spots: number;
  is_tab: boolean;
  needs_review: boolean;

  skipped: boolean;
  overrideSpots: number | null;
  overridePayer: string | null;
  overrideBeneficiary: string | null;
  overrideVersion: number; // 0 if no override row yet
};

function normalizeName(s: string) {
  return (s || "").replace(/[^a-z0-9_]/gi, "").toLowerCase();
}

// raffle-tool display-only helper (optional)
function extractRaffleToolBlockSummary(block: string | null) {
  if (!block) return { lines: 0 };
  return { lines: block.split("\n").filter((l) => l.trim()).length };
}

export default function RunPage({ params }: { params: { runId: string } }) {
  const runId = params.runId;

  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<any>(null);
  const [rows, setRows] = useState<CommentRow[]>([]);

  // Editing auth
  const [role, setRole] = useState<"viewer" | "editor" | "admin" | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");

  const canEdit = role === "editor" || role === "admin";

  // load token from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`run:${runId}:token`);
    const storedRole = localStorage.getItem(`run:${runId}:role`) as any;
    if (stored) setToken(stored);
    if (storedRole) setRole(storedRole);
  }, [runId]);

  const loadRun = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/runs/${runId}`);
      const json = await res.json();
      if (!res.ok) return alert(json?.error || "Failed to load run");
      setRun(json.run);
      setRows(json.comments);
    } catch (e) {
      console.error(e);
      alert("Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const effective = (r: CommentRow) => {
    const spots =
      typeof r.overrideSpots === "number" ? r.overrideSpots : r.spots;

    const payer = (r.overridePayer ?? r.payer ?? "").trim() || "unknown";
    const beneficiary = (r.overrideBeneficiary ?? r.beneficiary ?? "").trim();

    return {
      spots: Math.max(0, spots),
      payer,
      beneficiary,
    };
  };

  const redeemCode = async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeInput }),
      });
      const json = await res.json();
      if (!res.ok) return alert(json?.error || "Invalid code");

      setToken(json.token);
      setRole(json.role);

      localStorage.setItem(`run:${runId}:token`, json.token);
      localStorage.setItem(`run:${runId}:role`, json.role);

      setCodeInput("");
      alert(`Unlocked as ${json.role}`);
    } catch (e) {
      console.error(e);
      alert("Failed to redeem code");
    }
  };

  const saveOverride = async (
    commentId: string,
    patch: Partial<{
      skipped: boolean;
      override_spots: number | null;
      override_payer: string | null;
      override_beneficiary: string | null;
    }>
  ) => {
    if (!token) return alert("Enter an edit code first.");
    const row = rows.find((r) => r.id === commentId);
    if (!row) return;

    const expectedVersion = row.overrideVersion ?? 0;

    const res = await fetch(`/api/runs/${runId}/comments/${commentId}/override`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...patch, expectedVersion }),
    });

    const json = await res.json();

    if (res.status === 409) {
      // conflict; refresh that row from latest
      alert("Someone else updated this row. Reloading latest values.");
      await loadRun();
      return;
    }

    if (!res.ok) {
      alert(json?.error || "Failed to save");
      return;
    }

    // update local row + bump version
    setRows((prev) =>
      prev.map((r) =>
        r.id === commentId
          ? {
              ...r,
              skipped: patch.skipped ?? r.skipped,
              overrideSpots:
                patch.override_spots !== undefined
                  ? patch.override_spots
                  : r.overrideSpots,
              overridePayer:
                patch.override_payer !== undefined
                  ? patch.override_payer
                  : r.overridePayer,
              overrideBeneficiary:
                patch.override_beneficiary !== undefined
                  ? patch.override_beneficiary
                  : r.overrideBeneficiary,
              overrideVersion: json.version,
            }
          : r
      )
    );
  };

  // comments-only tally
  const tally = useMemo(() => {
    const acc: Record<string, { selfClaimed: number; owesFor: number }> = {};
    for (const r of rows) {
      if (r.skipped) continue;
      const e = effective(r);
      const payerKey = normalizeName(e.payer) || "unknown";
      const authorKey = normalizeName(r.author);

      if (!acc[payerKey]) acc[payerKey] = { selfClaimed: 0, owesFor: 0 };

      if (payerKey === authorKey) acc[payerKey].selfClaimed += e.spots;
      else acc[payerKey].owesFor += e.spots;
    }

    return Object.entries(acc)
      .map(([user, v]) => ({ user, ...v }))
      .sort((a, b) => a.user.localeCompare(b.user));
  }, [rows]);

  const raffleSummary = useMemo(
    () => extractRaffleToolBlockSummary(run?.raffleToolBlock ?? null),
    [run]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
        <div className="max-w-3xl mx-auto text-zinc-400">Loading…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{run?.title || "Run"}</h1>
              <div className="text-sm text-zinc-400">
                Parser: <span className="text-zinc-200">{run?.parserVersion}</span>
                {" · "}
                Title spots:{" "}
                <span className="text-zinc-200">{run?.totalSpotsFromTitle ?? "—"}</span>
                {" · "}
                raffle-tool lines: <span className="text-zinc-200">{raffleSummary.lines}</span>
              </div>
              <a className="text-sm text-indigo-400 hover:underline" href={run?.post_url} target="_blank">
                open reddit post
              </a>
            </div>

            {/* Editing unlock */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 w-full max-w-sm space-y-2">
              <div className="text-sm font-medium">
                Editing:{" "}
                <span className={canEdit ? "text-emerald-300" : "text-zinc-300"}>
                  {canEdit ? `enabled (${role})` : "view-only"}
                </span>
              </div>

              {!canEdit ? (
                <>
                  <div className="text-xs text-zinc-400">
                    Enter an invite code to enable editing.
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm"
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value)}
                      placeholder="ABCD-EF12-3456"
                    />
                    <button
                      className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-sm"
                      onClick={redeemCode}
                    >
                      Unlock
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-xs text-zinc-400">
                  Changes are saved and shared. Conflicts auto-reload.
                </div>
              )}
            </div>
          </div>
        </header>

        {/* 2 responsive columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Comments */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Comments</h2>
              <div className="text-sm text-zinc-400">{rows.length} loaded</div>
            </div>

            <div className="divide-y divide-zinc-800">
              {rows.map((r) => {
                const e = effective(r);

                return (
                  <div key={r.id} className={`p-5 ${r.skipped ? "opacity-40" : ""} ${r.needs_review ? "bg-red-950/40" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-medium truncate">{r.author}</div>
                          {r.needs_review ? (
                            <span className="text-xs rounded-full bg-red-900/60 border border-red-700 px-2 py-0.5">
                              needs review
                            </span>
                          ) : null}
                          {r.is_tab ? (
                            <span className="text-xs rounded-full bg-zinc-800 border border-zinc-700 px-2 py-0.5">
                              tab
                            </span>
                          ) : null}
                        </div>

                        <a className="text-xs text-indigo-400 hover:underline" href={r.permalink} target="_blank">
                          open comment
                        </a>
                      </div>

                      <label className="flex items-center gap-2 text-sm text-zinc-300">
                        <input
                          type="checkbox"
                          checked={!!r.skipped}
                          disabled={!canEdit}
                          onChange={() => saveOverride(r.id, { skipped: !r.skipped })}
                        />
                        Skip
                      </label>
                    </div>

                    {/* Overrides */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                      <div>
                        <div className="text-xs text-zinc-400 mb-1">Spots</div>
                        <input
                          type="number"
                          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm disabled:opacity-60"
                          value={e.spots}
                          disabled={!canEdit}
                          onChange={(ev) =>
                            saveOverride(r.id, {
                              override_spots: parseInt(ev.target.value || "0", 10),
                            })
                          }
                        />
                      </div>

                      <div>
                        <div className="text-xs text-zinc-400 mb-1">Payer</div>
                        <input
                          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm disabled:opacity-60"
                          value={e.payer}
                          disabled={!canEdit}
                          onChange={(ev) => saveOverride(r.id, { override_payer: ev.target.value })}
                        />
                      </div>

                      <div>
                        <div className="text-xs text-zinc-400 mb-1">Beneficiary</div>
                        <input
                          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm disabled:opacity-60"
                          value={e.beneficiary}
                          disabled={!canEdit}
                          onChange={(ev) => saveOverride(r.id, { override_beneficiary: ev.target.value })}
                        />
                      </div>
                    </div>

                    {/* Raw always visible */}
                    <div className="mt-4 rounded-xl bg-zinc-950 border border-zinc-800 p-4">
                      <div className="text-xs text-zinc-400 mb-2">Raw comment</div>
                      <pre className="whitespace-pre-wrap text-sm text-zinc-200">{r.body}</pre>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Tally (read-only) */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Tally</h2>
              <div className="text-sm text-zinc-400">comments only</div>
            </div>

            <div className="p-5">
              <table className="w-full text-sm">
                <thead className="text-zinc-400">
                  <tr>
                    <th className="text-left py-2">User</th>
                    <th className="text-center py-2">Claimed for self</th>
                    <th className="text-center py-2">Owes for others</th>
                  </tr>
                </thead>
                <tbody>
                  {tally.map((t) => (
                    <tr key={t.user} className="border-t border-zinc-800">
                      <td className="py-3">{t.user}</td>
                      <td className="py-3 text-center font-semibold">{t.selfClaimed}</td>
                      <td className="py-3 text-center font-semibold">{t.owesFor}</td>
                    </tr>
                  ))}
                  {!tally.length ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-zinc-500">
                        No tally yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="text-xs text-zinc-400">How it’s computed</div>
                <div className="mt-1 text-sm text-zinc-300 space-y-1">
                  <div>
                    <b>Claimed for self</b>: spots where payer = author
                  </div>
                  <div>
                    <b>Owes for others</b>: spots where payer ≠ author
                  </div>
                  <div className="text-zinc-500">
                    Skips + overrides update this instantly. Conflicts are prevented with version checks.
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
