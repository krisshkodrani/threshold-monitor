import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
} from "recharts";
import { metric } from "../config";
import {
  toChartData,
  type ChartMarker,
  type ChartRow,
} from "../domain/chartData";
import type { DetectorConfig } from "../domain/types";
import type { ReadingsStore } from "../data/readingsStore";
import { formatReading, formatThreshold, withUnit } from "../format";
import { useReadings } from "../hooks/useReadings";

type Props = {
  readings: ReadingsStore;
  markers: readonly ChartMarker[];
  cfg: DetectorConfig;
};

const formatTime = (t: number) => (t === 0 ? "now" : `−${Math.abs(t)} s`);

/**
 * Renders what toChartData returns and nothing more: all chart math is in the
 * pure domain function. Animations are off because Recharts would re-animate
 * the whole line on every new reading, so the line would never be where the data is.
 */
export function LiveChart({ readings, markers, cfg }: Props) {
  const data = toChartData(useReadings(readings), markers, cfg);
  const latest = data.rows.at(-1);
  const summary =
    `${metric.label} chart. ` +
    (latest
      ? `Current ${withUnit(formatReading(latest.value))}, `
      : "No readings yet, ") +
    `threshold ${withUnit(formatThreshold(data.threshold))}.`;

  return (
    <figure className="chart" aria-label={summary}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 600, height: 300 }}
      >
        <ComposedChart
          data={data.rows}
          margin={{ top: 12, right: 16, bottom: 4, left: 0 }}
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", 0]}
            ticks={data.timeTicks}
            tickFormatter={formatTime}
            stroke="var(--text-muted)"
          />
          <YAxis
            domain={data.domain}
            allowDataOverflow
            width={44}
            tickFormatter={(v: number) => v.toFixed(0)}
            stroke="var(--text-muted)"
          />
          <ReferenceArea
            y1={data.band.lower}
            y2={data.band.upper}
            fill="var(--band)"
            fillOpacity={1}
            ifOverflow="extendDomain"
          />
          <ReferenceLine
            y={data.threshold}
            stroke="var(--threshold)"
            strokeDasharray="6 4"
          />
          <Tooltip
            isAnimationActive={false}
            labelFormatter={(t) => formatTime(Number(t))}
            formatter={(value) => [
              withUnit(formatReading(Number(value))),
              metric.label,
            ]}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke="var(--line)"
            strokeWidth={2}
            dot={CrossingMarker}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Triangles for crossings: up and down differ by shape, not only by color. */
function CrossingMarker({ cx, cy, payload }: DotItemDotProps) {
  const marker = (payload as ChartRow).marker;
  if (!marker || cx === undefined || cy === undefined) return null;
  const path =
    marker === "up"
      ? `M ${cx} ${cy - 8} L ${cx + 7} ${cy + 5} L ${cx - 7} ${cy + 5} Z`
      : `M ${cx} ${cy + 8} L ${cx + 7} ${cy - 5} L ${cx - 7} ${cy - 5} Z`;
  return <path d={path} className={`marker marker--${marker}`} />;
}
