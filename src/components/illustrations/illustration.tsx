import { ILLUSTRATIONS, type IllustrationId } from "./library";

/**
 * One of the Attract Studio illustrations (docs/illustration-library.md), by ID. Ink follows the text colour, orange is
 * the brand orange, and the fill behind outlined shapes is the card surface. `decorative` hides it from screen readers
 * when the nearby text already says the same thing.
 */
export function Illustration({ id, className = "", decorative = false }: { id: IllustrationId; className?: string; decorative?: boolean }) {
  const item = ILLUSTRATIONS[id];
  const Art = item.art;
  return (
    <svg
      data-illustration={id}
      className={`il ${className}`.trim()}
      viewBox={item.viewBox}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": item.label })}
    >
      <Art />
    </svg>
  );
}
