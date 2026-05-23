"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function TopBar() {
  const [ordersAnalyzed, setOrdersAnalyzed] = useState<number | null>(null);

  useEffect(() => {
    // Pull the orders-analyzed number from the static contract if it's served.
    fetch("/data.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.metadata?.master_rows) setOrdersAnalyzed(d.metadata.master_rows);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="topbar">
      <Link href="/" className="mark">
        <span className="dot" />
        LineWise <em>· El Prat planning</em>
      </Link>

      <div className="provenance">
        <span className="pulse-dot" />
        grounded in <b>{ordersAnalyzed ?? "—"}</b> executed blocks · lines{" "}
        <b>14 / 17 / 19</b> · 2025
      </div>
    </div>
  );
}
