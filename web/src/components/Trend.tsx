export interface TrendPoint {
  date: string;
  total: number;
}

/**
 * Score trend. Rendered as inline SVG rather than a chart dependency — it has
 * one job, and the direction of "better" differs by instrument, so the axis is
 * labelled explicitly instead of relying on the reader's assumption.
 */
export function Trend({
  points,
  min,
  max,
  higherIsBetter,
}: {
  points: TrendPoint[];
  min: number;
  max: number;
  higherIsBetter: boolean;
}): JSX.Element {
  if (points.length === 0) {
    return <p className="small muted">No prior scores recorded for this patient.</p>;
  }

  const width = 520;
  const height = 130;
  const padX = 34;
  const padY = 16;
  const span = Math.max(max - min, 1);

  const x = (index: number) =>
    points.length === 1
      ? padX
      : padX + (index / (points.length - 1)) * (width - padX * 2);
  const y = (value: number) =>
    height - padY - ((value - min) / span) * (height - padY * 2);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.total)}`).join(' ');
  const latest = points[points.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img"
        aria-label={`Score trend, latest ${latest?.total}`}>
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#e2e5ea" />
        <text x={4} y={padY + 4} fontSize="10" fill="#656b76">{max}</text>
        <text x={4} y={height - padY} fontSize="10" fill="#656b76">{min}</text>
        {points.length > 1 && <path d={path} fill="none" stroke="#1f6feb" strokeWidth="2" />}
        {points.map((p, i) => (
          <g key={`${p.date}-${i}`}>
            <circle cx={x(i)} cy={y(p.total)} r="4" fill="#1f6feb" />
            <text x={x(i)} y={y(p.total) - 10} fontSize="11" fill="#16181d" textAnchor="middle">
              {p.total}
            </text>
            <text x={x(i)} y={height - 3} fontSize="9" fill="#656b76" textAnchor="middle">
              {p.date.slice(0, 10)}
            </text>
          </g>
        ))}
      </svg>
      <p className="small muted">
        {higherIsBetter ? 'Higher is better control.' : 'Higher means more severe symptoms.'}
      </p>
    </div>
  );
}
