"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";

const NAV = [
  { href: "/plan-review", label: "Plan Review" },
  { href: "/simulator", label: "Rush Order" },
  { href: "/diagnostics", label: "Diagnostics" },
  { href: "/learning", label: "Learning" },
  { href: "/about-model", label: "Model Flow" },
];

export default function AppHeader() {
  const pathname = usePathname();
  const [fallback, setFallback] = useState<boolean | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
    fetch(`${base}/api/health`)
      .then((r) => r.json())
      .then((d) => setFallback(Boolean(d.using_fallback_data)))
      .catch(() => setFallback(null));
  }, []);

  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
      <div className="flex items-center gap-3">
        <Link href="/diagnostics" className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-damm-red grid place-items-center font-semibold text-white shadow-red">
            LW
          </div>
          <div>
            <div className="text-lg font-semibold text-white">LineWise</div>
            <div className="text-xs text-damm-muted -mt-0.5">
              Damm canning lines 14 / 17 / 19 · execution intelligence
            </div>
          </div>
        </Link>
        {fallback ? (
          <span className="chip chip-warn ml-3">Demo fallback data</span>
        ) : null}
      </div>
      <nav className="flex gap-2">
        {NAV.map((n) => {
          const active =
            pathname === n.href ||
            (n.href !== "/" && pathname.startsWith(n.href));
          return (
            <Link
              key={n.href}
              href={n.href}
              className={clsx(
                "px-3 py-2 rounded-xl text-sm border transition",
                active
                  ? "border-damm-accent/60 bg-damm-accent/10 text-white shadow-glow"
                  : "border-white/10 text-damm-muted hover:text-white hover:border-white/20",
              )}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
