"use client";
import { motion } from "framer-motion";
import clsx from "clsx";

type Props = {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad" | "accent";
  delay?: number;
};

const toneClass = {
  default: "border-white/5",
  good: "border-damm-ok/40 shadow-[0_0_0_1px_rgba(40,199,111,0.3),0_8px_32px_rgba(40,199,111,0.10)]",
  warn: "border-damm-warn/40",
  bad: "border-damm-bad/40",
  accent:
    "border-damm-accent/40 shadow-[0_0_0_1px_rgba(78,163,255,0.5),0_8px_32px_rgba(78,163,255,0.15)]",
};

export default function MetricCard({
  label,
  value,
  sub,
  tone = "default",
  delay = 0,
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={clsx(
        "card p-5 border",
        toneClass[tone],
      )}
    >
      <div className="text-xs uppercase tracking-wider text-damm-muted">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
      {sub ? (
        <div className="mt-1 text-sm text-damm-muted">{sub}</div>
      ) : null}
    </motion.div>
  );
}
