/** Three stars, the first `n` lit (co-op results). */
export function Stars({ n, size = 48 }: { n: number; size?: number }) {
  return (
    <div class="stars" style={{ fontSize: size }}>
      {[0, 1, 2].map((i) => (
        <span class={i < n ? 'on' : ''} style={{ animationDelay: `${300 + i * 350}ms` }}>
          ★
        </span>
      ))}
    </div>
  );
}
