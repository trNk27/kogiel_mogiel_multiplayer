import { useEffect, useRef } from 'preact/hooks';

/** Shrinking bar until a host deadline (`offset` converts host time to phone time). */
export function TimeBar({ endsAt, offset }: { endsAt: number; offset: number }) {
  const fill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const deadline = endsAt + offset;
    const total = Math.max(1, deadline - Date.now());
    let raf = 0;
    const loop = () => {
      const left = Math.max(0, deadline - Date.now());
      if (fill.current) fill.current.style.transform = `scaleX(${left / total})`;
      if (left > 0) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [endsAt, offset]);
  return (
    <div class="timebar">
      <div class="timebar-fill" ref={fill} />
    </div>
  );
}
