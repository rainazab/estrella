"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DiagnosticOverview from "../../components/DiagnosticOverview";
import TransitionRankTable from "../../components/TransitionRankTable";
import TransitionDetail from "../../components/TransitionDetail";
import OrderEvidenceDrawer from "../../components/OrderEvidenceDrawer";
import {
  getDiagnosticSummary,
  getTransitions,
  getTransitionDetail,
} from "../../lib/api";
import type {
  DiagnosticSummary,
  TransitionDetailResponse,
  TransitionRankRow,
} from "../../lib/types";

const LINE_OPTIONS = ["All", "14", "17", "19"];
const MIN_CASE_OPTIONS = [3, 5, 10, 20];

export default function DiagnosticsPage() {
  const router = useRouter();
  const [line, setLine] = useState<string>("All");
  const [minCases, setMinCases] = useState<number>(3);
  const [summary, setSummary] = useState<DiagnosticSummary | null>(null);
  const [rows, setRows] = useState<TransitionRankRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransitionDetailResponse | null>(null);
  const [drawer, setDrawer] = useState<{ prev: string; cur: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getDiagnosticSummary().then(setSummary).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    setLoading(true);
    getTransitions({ line, minCases })
      .then((r) => {
        setRows(r);
        if (r.length > 0) {
          const stillThere = selected && r.some((x) => x.transition_type === selected);
          if (!stillThere) setSelected(r[0].transition_type);
        } else {
          setSelected(null);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, minCases]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    getTransitionDetail(selected).then(setDetail).catch((e) => setError(String(e)));
  }, [selected]);

  return (
    <main className="space-y-6">
      {error ? (
        <div className="card p-4 border border-damm-bad/40 text-damm-bad">{error}</div>
      ) : null}

      <DiagnosticOverview summary={summary} rows={rows} />

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <Filter label="Line">
          <select
            className="select min-w-[110px]"
            value={line}
            onChange={(e) => setLine(e.target.value)}
          >
            {LINE_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Filter>
        <Filter label="Period">
          <select className="select min-w-[110px]" disabled value="2025">
            <option value="2025">2025</option>
          </select>
        </Filter>
        <Filter label="Min cases">
          <select
            className="select min-w-[110px]"
            value={minCases}
            onChange={(e) => setMinCases(Number(e.target.value))}
          >
            {MIN_CASE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}+
              </option>
            ))}
          </select>
        </Filter>
        {loading ? (
          <span className="text-xs text-damm-muted">Loading…</span>
        ) : null}
      </div>

      <TransitionRankTable
        rows={rows}
        selectedType={selected}
        onSelect={setSelected}
      />

      {detail ? (
        <TransitionDetail
          detail={detail}
          onPickOrder={(prev, cur) => setDrawer({ prev, cur })}
          onUseInSimulator={() =>
            router.push(
              `/simulator?transition_type=${encodeURIComponent(detail.transition_type)}`,
            )
          }
        />
      ) : null}

      <OrderEvidenceDrawer
        prevOf={drawer?.prev ?? null}
        curOf={drawer?.cur ?? null}
        onClose={() => setDrawer(null)}
      />
    </main>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-damm-muted">{label}</span>
      {children}
    </div>
  );
}
