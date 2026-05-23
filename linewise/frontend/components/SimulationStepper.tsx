"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import type { SimulationStep } from "../lib/types";
import clsx from "clsx";

type Props = {
  steps: SimulationStep[];
  onDone?: () => void;
  perStepMs?: number;
};

export default function SimulationStepper({
  steps,
  onDone,
  perStepMs = 380,
}: Props) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (steps.length === 0) return;
    if (active >= steps.length) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => setActive((a) => a + 1), perStepMs);
    return () => clearTimeout(t);
  }, [active, steps.length, perStepMs, onDone]);

  return (
    <div className="card p-6 md:p-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-2 w-2 rounded-full bg-damm-accent animate-pulse" />
        <div className="text-xs uppercase tracking-[0.2em] text-damm-muted">
          LineWise hybrid pipeline
        </div>
      </div>
      <ol className="space-y-3">
        <AnimatePresence>
          {steps.map((s, i) => {
            const isActive = i < active;
            return (
              <motion.li
                key={s.step}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: isActive ? 1 : 0.35, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className={clsx(
                  "flex items-start gap-3 rounded-xl px-3 py-2 border",
                  isActive
                    ? "border-damm-accent/40 bg-damm-accent/5"
                    : "border-white/5",
                )}
              >
                <div
                  className={clsx(
                    "mt-0.5 h-6 w-6 shrink-0 rounded-full grid place-items-center text-[10px] font-mono",
                    isActive
                      ? "bg-damm-accent text-damm-dark"
                      : "bg-white/10 text-damm-muted",
                  )}
                >
                  {s.step}
                </div>
                <div className="flex-1">
                  <div className="text-sm text-white font-medium">{s.name}</div>
                  <div className="text-xs text-damm-muted">{s.detail}</div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </div>
  );
}
