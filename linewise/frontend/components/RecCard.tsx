"use client";
import { useState } from "react";
import type { Recommendation } from "../lib/contract";

export type ObjectiveKey = "oee" | "time" | "dis";

type Props = {
  rec: Recommendation;
  lineKey: string; // "14" / "17" / "19"
  isBest?: boolean;
  isManual?: boolean;
  objectiveLabel?: string;
  objectiveNote?: string;
  selected?: boolean;
  onClick?: () => void;
};

export default function RecCard({
  rec,
  lineKey,
  isBest = false,
  isManual = false,
  objectiveLabel = "OEE",
  objectiveNote,
  selected = false,
  onClick,
}: Props) {
  const [open, setOpen] = useState(isBest);

  const oeeGood = rec.oeeGood;
  const ev = rec.evidence;
  const note = objectiveNote ?? rec.reasoning?.[2] ?? rec.topFactors?.[0] ?? "";

  return (
    <div className={`rcard ${selected ? "sel" : ""}`}>
      <div className="rcard-body" onClick={onClick}>
        {isBest && !isManual ? (
          <div className="rbadge">
            <span className="star">★</span>RECOMMENDED FOR{" "}
            {objectiveLabel.toUpperCase()}
          </div>
        ) : null}
        {isManual ? (
          <div className="rbadge">
            <span className="star">▦</span>EVALUATED — YOUR CHOSEN SLOT
          </div>
        ) : null}
        <div className="rcard-head">
          <span className="rcard-line">{rec.line}</span>
          <span className={`rcard-oee ${oeeGood ? "oee-pos" : "oee-neg"}`}>
            {rec.oeeDelta}
            <small> OEE</small>
          </span>
        </div>
        <div className="rcard-pos">insert {rec.position}</div>
        <div className="rcard-axes">
          <span className="lw-chip">
            <span className="ci">⏱</span>
            {rec.ordersMoved === 0 ? "on time" : rec.deadline}
          </span>
          <span className="lw-chip">
            <span className="ci">↩</span>~{rec.recovery.hours}h to recover
          </span>
          <span className="lw-chip">
            <span className="ci">▦</span>
            {ev.n} analogues
          </span>
          {rec.decision ? (
            <span
              className="lw-chip"
              style={{ background: "var(--brand)", color: "#f1f0ec" }}
            >
              {rec.decision.replace(/_/g, " ")}
            </span>
          ) : null}
        </div>
        {note ? <div className="rcard-note">{note}</div> : null}
      </div>

      <div
        className={`why ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Why this recommendation</span>
        <span className="caret">▾</span>
      </div>

      <div className={`evidence ${open ? "open" : ""}`}>
        {ev.reason ? (
          <div
            className="ev-reason"
            dangerouslySetInnerHTML={{ __html: ev.reason }}
          />
        ) : null}

        {ev.breakdown && ev.breakdown.length > 0 ? (
          <div className="ev-block">
            <div className="ev-h">Changeover breakdown — this insertion</div>
            {ev.breakdown.map((b, i) => (
              <div key={i} className="bar-row">
                <span className="bar-name">{b.name}</span>
                <div className="bar-track">
                  <div className={`bar-fill ${b.band}`} style={{ width: `${b.pct}%` }} />
                </div>
                <span
                  className="bar-val"
                  style={{ color: b.band === "lo" ? "var(--good)" : "var(--bad)" }}
                >
                  {b.val}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {ev.analogues && ev.analogues.length > 0 ? (
          <div className="ev-block">
            <div className="ev-h">Historical analogues — same transition type</div>
            <table className="ana">
              <thead>
                <tr>
                  <th>OF</th>
                  <th>Date</th>
                  <th>Line</th>
                  <th>Changeover</th>
                  <th>OEE</th>
                </tr>
              </thead>
              <tbody>
                {ev.analogues.slice(0, 5).map((a, i) => (
                  <tr key={i}>
                    <td className="of">{a.of}</td>
                    <td>{a.date}</td>
                    <td>L{a.line}</td>
                    <td>{a.type}</td>
                    <td style={{ color: "var(--good)" }}>{a.oee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="stat-row">
          <div className="stat">
            <div className="s-lbl">analogue mean OEE</div>
            <div className="s-val">{ev.analogueMean}</div>
          </div>
          <div className="stat">
            <div className="s-lbl">naive-slot mean OEE</div>
            <div className="s-val neg">{ev.naiveMean}</div>
          </div>
          <div className="stat hero">
            <div className="s-lbl">predicted gain</div>
            <div className="s-val">{ev.gain}</div>
          </div>
        </div>

        <div className="caveat">
          <div className="cv-h">⚠ What this estimate cannot see</div>
          <div className="cv-b">
            {ev.limitations && ev.limitations.length > 0
              ? ev.limitations.join(" · ")
              : "Crew experience, shift staffing and downstream micro-stoppages are not in the data."}
            {ev.n ? ` Based on n=${ev.n} analogues.` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
