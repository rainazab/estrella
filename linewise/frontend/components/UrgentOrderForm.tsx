"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { Product } from "../lib/types";
import { getProducts } from "../lib/api";

type Priority = "low" | "medium" | "high";

type Props = {
  onSubmit: (req: {
    sku: string;
    volume: number;
    deadline: string;
    priority: Priority;
  }) => void;
  loading?: boolean;
};

function defaultDeadlineISO(): string {
  const d = new Date();
  // next Friday 18:00 local
  const day = d.getDay(); // 0=Sun, 5=Fri
  const diff = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(18, 0, 0, 0);
  return d.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
}

export default function UrgentOrderForm({ onSubmit, loading }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [sku, setSku] = useState("");
  const [volume, setVolume] = useState<number>(100000);
  const [deadline, setDeadline] = useState<string>(defaultDeadlineISO());
  const [priority, setPriority] = useState<Priority>("high");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getProducts()
      .then((p) => {
        setProducts(p);
        if (p.length > 0) setSku(p[0].sku);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="card p-6 md:p-8"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="h-3 w-3 rounded-full bg-damm-red animate-pulse" />
        <div className="text-xs uppercase tracking-[0.2em] text-damm-muted">
          Urgent demand event
        </div>
      </div>

      <h1 className="text-3xl md:text-4xl font-semibold text-white">
        Where should this urgent order go?
      </h1>
      <p className="mt-2 text-damm-muted max-w-xl">
        LineWise simulates insertion across canning lines 14, 17 and 19 — and
        recommends the slot that protects OEE based on historical execution.
      </p>

      <div className="mt-8 grid md:grid-cols-2 gap-5">
        <div>
          <label className="text-xs uppercase tracking-wider text-damm-muted">
            Product / SKU
          </label>
          <select
            className="select mt-2"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            disabled={loading}
          >
            {products.map((p) => (
              <option key={p.sku} value={p.sku}>
                {p.name} — {p.sku}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-damm-muted">
            Volume (HL)
          </label>
          <input
            type="number"
            min={0}
            className="input mt-2"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            disabled={loading}
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-damm-muted">
            Deadline
          </label>
          <input
            type="datetime-local"
            className="input mt-2"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            disabled={loading}
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-damm-muted">
            Priority
          </label>
          <select
            className="select mt-2"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            disabled={loading}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {err ? (
        <div className="mt-4 text-sm text-damm-bad">Error: {err}</div>
      ) : null}

      <div className="mt-8 flex items-center gap-3">
        <button
          className="btn btn-primary text-base disabled:opacity-60"
          disabled={!sku || loading}
          onClick={() =>
            onSubmit({
              sku,
              volume,
              deadline: deadline.length === 16 ? deadline + ":00" : deadline,
              priority,
            })
          }
        >
          {loading ? "Running…" : "Run LineWise Simulation →"}
        </button>
        <div className="text-xs text-damm-muted">
          Hybrid model: history-aware similarity + GradientBoosting OEE.
        </div>
      </div>
    </motion.div>
  );
}
