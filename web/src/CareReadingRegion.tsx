import { useId } from "react";
import type { ComponentPropsWithoutRef } from "react";
import "./care-reading-region.css";

type Props = ComponentPropsWithoutRef<"section"> & { label: string; hint?: string };

/** A native document-reading stop, not a fourth game control or scroll box. */
export function CareReadingRegion({ label, hint = "Tab 聚焦：↑/↓ 或空格滚动；A/B/C 不变。", className = "", children, ...props }: Props) {
  const hintId = useId();
  return <section {...props} className={`care-reading-region ${className}`} tabIndex={0} aria-label={label} aria-describedby={hintId}>
    <small id={hintId} className="care-reading-hint" data-care-reading-start>
      {hint}
    </small>
    {children}
  </section>;
}
