"use client";
import type { UrgentOrder } from "./QueuePanel";

export default function CalculatingPanel({ order }: { order: UrgentOrder }) {
  return (
    <div className="panel-pad">
      <div className="eyebrow">Selected</div>
      <div className="panel-title">{order.of}</div>
      <div className="panel-desc">{order.sku}</div>
      <div className="summary">
        <div className="summary-grid">
          <div>
            <b>{order.units.toLocaleString()}</b>units
          </div>
          <div>
            <b>{order.hl}</b>hl
          </div>
          <div>
            <b>{order.due}</b>due date
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        <span className="spinner" /> Ranking line and sequence options…
      </div>
    </div>
  );
}
