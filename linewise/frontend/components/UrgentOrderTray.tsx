"use client";
import type { UrgentOrder } from "../lib/contract";

type Props = {
  orders: UrgentOrder[];
  selected: UrgentOrder | null;
  onSelect: (o: UrgentOrder) => void;
};

/**
 * Inline tray that lives ABOVE the timeline in Rush Order mode.
 * The selected urgent order is the one the planner will drag onto a line.
 */
export default function UrgentOrderTray({ orders, selected, onSelect }: Props) {
  return (
    <div className="urgent-tray">
      <div className="urgent-tray-label">
        <span className="eyebrow">Urgent orders</span>
        <span className="dp-fine">Pick one, then drag onto a line below.</span>
      </div>
      <div className="urgent-tray-list">
        {orders.map((o) => {
          const isSel = selected?.of === o.of;
          return (
            <button
              key={o.of}
              className={`urgent-card ${isSel ? "sel" : ""} ${o.status === "queued" ? "queued" : ""}`}
              onClick={() => onSelect(o)}
              draggable={isSel}
              onDragStart={(e) => {
                if (!isSel) return;
                e.dataTransfer.setData("text/plain", o.of);
                e.dataTransfer.effectAllowed = "move";
                document.querySelectorAll(".drop-hint").forEach((d) => d.classList.add("armed"));
              }}
              onDragEnd={() => {
                document
                  .querySelectorAll(".drop-hint")
                  .forEach((d) => d.classList.remove("armed", "over"));
              }}
            >
              <div className="urgent-card-top">
                <span className="urgent-of">{o.of}</span>
                <span className={`urgent-tag tag-${o.status === "urgent" ? "urgent" : "queued"}`}>
                  {o.status}
                </span>
              </div>
              <div className="urgent-sku">{o.sku}</div>
              <div className="urgent-meta">
                <span><strong>{o.hl}</strong> HL</span>
                <span>·</span>
                <span>{o.format_key ?? "—"}</span>
                <span>·</span>
                <span>due {o.due}</span>
              </div>
              {isSel ? <div className="urgent-grip">⠿ drag onto a line</div> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
