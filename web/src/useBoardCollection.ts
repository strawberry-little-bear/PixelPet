import { useEffect, useRef, useState } from "react";

// Saved counts survive an interruption; their short-lived celebration does not.
// Consume counts while inactive too, so resuming cannot replay an old pickup.
export function useBoardCollection(count: number, active: boolean) {
  const previous = useRef(count);
  const [collecting, setCollecting] = useState(false);
  useEffect(() => {
    const increased = count > previous.current;
    previous.current = count;
    setCollecting(active && increased);
    if (!active || !increased) return;
    const timer = setTimeout(() => setCollecting(false), 900);
    return () => clearTimeout(timer);
  }, [count, active]);
  return active && collecting;
}
