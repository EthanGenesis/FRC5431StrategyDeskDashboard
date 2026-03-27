'use client';

type SparklineCellProps = {
  values: (number | string | null | undefined)[];
  width?: number;
  height?: number;
  color?: string;
};

export default function SparklineCell({
  values,
  width = 96,
  height = 28,
  color = '#4bb3fd',
}: SparklineCellProps) {
  const numeric = (values ?? [])
    .map((value) => (Number.isFinite(Number(value)) ? Number(value) : null))
    .filter((value): value is number => value != null);

  if (!numeric.length) {
    return <span className="muted">-</span>;
  }

  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const spread = Math.max(1e-6, max - min);
  const points = values
    .map((value, index) => {
      const parsed = Number.isFinite(Number(value)) ? Number(value) : null;
      if (parsed == null) {
        return null;
      }
      const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((parsed - min) / spread) * height;
      return `${x},${y}`;
    })
    .filter((value): value is string => Boolean(value))
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="sparkline"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
