import type { OutingScenery as Scenery } from './outing';
import './outing-scenery.css';

// Decorative paths inherit the parent SVG's aria-hidden and never animate.
export function OutingSky({ scenery }: { scenery: Scenery }) {
  if (!scenery) return null;
  return <g className="outing-sky" data-weather={scenery.weather.id} data-light={scenery.light.id}>
    {scenery.light.id === 'night'
      ? <path d="M92 5h10v4h-6v8h9v4H92v-4h-4V9h4zM129 8h3v3h-3zm14 10h3v3h-3z" fill="#eee6be" stroke="#6b7b65" />
      : <path d="M92 7h10v10H92zM96 2v3m0 14v3M87 11h3m14 0h3" fill="#e8d9a5" stroke="#8b875c" />}
    {scenery.weather.id !== 'clear' && <path d="M125 14h7V8h14v6h9v10h-30z" fill="#dfe4d0" stroke="#84917e" />}
    {scenery.weather.id === 'rain' && <path d="M128 28l-3 5m14-5l-3 5m14-5l-3 5" stroke="#687f7c" strokeWidth="2" />}
  </g>;
}
export function OutingCaption({ scenery, compact = false }: { scenery: Scenery; compact?: boolean }) {
  if (!scenery) return null;
  return <small className={`outing-caption${compact ? " outing-compact" : ""}`} data-scenery={scenery.key}>
    <span className="outing-label">虚构风景 · {scenery.label}</span>
    {!compact && <span>{scenery.story}</span>}
  </small>;
}
