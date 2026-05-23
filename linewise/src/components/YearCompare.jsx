/* YearCompare — STUB.
   Receives the yearCompare slice of the plan via props so it stays
   decoupled from the data source. */
export default function YearCompare({ data, onClose }) {
  return (
    <div className="yearcompare open">
      <div className="yc-head">
        <span className="yc-title">{data ? data.weekLabel + ' — this year vs. 2025' : 'Year-on-year comparison — placeholder'}</span>
        <span className="yc-close" onClick={onClose}>✕</span>
      </div>
    </div>
  );
}
