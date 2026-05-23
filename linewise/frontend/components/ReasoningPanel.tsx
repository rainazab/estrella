"use client";
import { motion } from "framer-motion";

type Props = {
  reasoning: string[];
};

export default function ReasoningPanel({ reasoning }: Props) {
  if (!reasoning || reasoning.length === 0) return null;
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-[0.2em] text-damm-muted mb-3">
        Reasoning
      </div>
      <ol className="space-y-2.5">
        {reasoning.map((r, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex gap-3 text-sm text-damm-ink"
          >
            <span className="text-damm-accent font-mono text-xs mt-0.5">
              {i + 1}.
            </span>
            <span>{r}</span>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
