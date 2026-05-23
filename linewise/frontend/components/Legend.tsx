"use client";

export default function Legend({ showCond = false }: { showCond?: boolean }) {
  return (
    <div className="legend">
      <span className="grp">OEE band</span>
      <span>
        <span className="sw sw-hi" />
        strong ≥ 0.56
      </span>
      <span>
        <span className="sw sw-mid" />
        mid 0.52–0.55
      </span>
      <span>
        <span className="sw sw-lo" />
        weak &lt; 0.52
      </span>
      <span className="leg-sep">
        <span className="sw sw-clean" />
        cleaning / maint
      </span>
      {showCond ? (
        <>
          <span className="leg-sep">
            <span className="sw sw-ins" />
            urgent insertion
          </span>
          <span>
            <span className="sw sw-ghost" />
            original position
          </span>
          <span>
            <span className="sw sw-rec" />
            line recovering
          </span>
        </>
      ) : null}
    </div>
  );
}
