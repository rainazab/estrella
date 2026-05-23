/* Floating action button — only visible on the landing planner board.
   Opens the inbox so the planner can pick or create an urgent order. */
export default function Fab({ onClick }) {
  return (
    <button className="fab" onClick={onClick} aria-label="New urgent order">
      <span className="fab-plus">+</span>
      <span className="fab-label">New urgent order</span>
    </button>
  );
}
