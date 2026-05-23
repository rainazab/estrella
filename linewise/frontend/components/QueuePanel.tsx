"use client";
import type { Product } from "../lib/types";

export type UrgentOrder = {
  of: string;
  status: "urgent" | "queued";
  sku: string;
  units: number;
  hl: number;
  due: string;
  productSku: string;
  volume: number;
  format_key?: string | null;
};

type Props = {
  orders: UrgentOrder[];
  onSelect: (o: UrgentOrder) => void;
  onCreate: () => void;
};

export default function QueuePanel({ orders, onSelect, onCreate }: Props) {
  return (
    <div className="panel-pad">
      <div className="eyebrow">Inbox</div>
      <div className="panel-title">Urgent orders</div>
      <div className="panel-desc">
        Requests routed from the operations manager.
      </div>

      <div className="queue">
        {orders.map((o) => (
          <div
            key={o.of}
            className={`ocard ${o.status === "urgent" ? "" : "muted"}`}
            onClick={() => o.status === "urgent" && onSelect(o)}
          >
            <div className="ocard-top">
              <span className="ocode">{o.of}</span>
              <span
                className={`tag ${
                  o.status === "urgent" ? "tag-urgent" : "tag-queued"
                }`}
              >
                {o.status}
              </span>
            </div>
            <div className="ocard-sku">{o.sku}</div>
            <div className="ocard-meta">
              <span>
                <b>{o.units.toLocaleString()}</b> units
              </span>
              <span>
                <b>{o.hl}</b> hl
              </span>
              <span>
                due <b>{o.due}</b>
              </span>
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn btn-ghost"
        style={{ marginTop: 10 }}
        onClick={onCreate}
      >
        <span>+</span> Create order manually
      </button>

      <div className="panel-foot bordered">
        Select an urgent order and LineWise will rank every line and insertion
        point against 2025&apos;s executed changeover history.
      </div>
    </div>
  );
}
