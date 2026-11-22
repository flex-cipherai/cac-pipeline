import { useEffect, useRef, useState } from 'react'
import { fmtValue } from './waUtils'

// Main trend chart: one metric over time, with the comparison period drawn as
// a dashed grey line aligned bucket-for-bucket. Crosshair + tooltip on hover
// or touch. Plain SVG sized to its container (no chart library).
//   points  [{ key, label, longLabel, value, prev, prevLabel }]
//   reverse true for metrics where lower is better and the axis should flip
//           (Search Console position: 1 at the top).
export default function WaChart({ points, fmt = 'num', metricLabel, compareLabel, reverse = false, height = 260 }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width)
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const compactAxis = width < 480
  const pad = { top: 16, right: 12, bottom: 28, left: compactAxis ? 36 : 48 }
  const innerW = Math.max(10, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const n = points.length
  const hasPrev = points.some(p => p.prev != null)

  const values = points.flatMap(p => [p.value, hasPrev ? p.prev : null]).filter(v => v != null)
  const rawMax = values.length ? Math.max(...values) : 0
  const { max, ticks } = niceScale(rawMax, fmt)
  const min = 0
  const span = (max - min) || 1

  const x = i => pad.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = v => {
    const t = (v - min) / span
    return pad.top + (reverse ? t : 1 - t) * innerH
  }

  const line = key => {
    let d = ''
    let open = false
    points.forEach((p, i) => {
      const v = p[key]
      if (v == null) { open = false; return }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      open = true
    })
    return d
  }
  const cur = line('value')
  const area = !reverse && cur
    ? `${cur}L${x(lastIndex(points, 'value')).toFixed(1)},${(pad.top + innerH).toFixed(1)}L${x(firstIndex(points, 'value')).toFixed(1)},${(pad.top + innerH).toFixed(1)}Z`
    : null

  // About six x labels, never overlapping.
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 70))))

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - rect.left) * (width / rect.width)
    const i = n <= 1 ? 0 : Math.round(((px - pad.left) / innerW) * (n - 1))
    setHover(Math.min(n - 1, Math.max(0, i)))
  }

  const hp = hover != null ? points[hover] : null
  const tipLeft = hp ? Math.min(Math.max(x(hover), 90), width - 90) : 0

  return (
    <div className="wa-chart" ref={wrapRef}>
      {n === 0 ? (
        <div className="wa-chart-empty" style={{ height }}>No data in this period yet.</div>
      ) : (
        <>
          <svg
            width={width} height={height} viewBox={`0 0 ${width} ${height}`}
            role="img" aria-label={`${metricLabel} over time`}
            onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}
          >
            {ticks.map(t => (
              <g key={t}>
                <line className="wa-gridline" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
                <text className="wa-axis" x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{axisLabel(t, fmt)}</text>
              </g>
            ))}
            {points.map((p, i) => (i % labelEvery === 0 || i === n - 1) && (n - 1 - i >= labelEvery / 2 || i === n - 1) ? (
              <text key={p.key} className="wa-axis" x={x(i)} y={height - 8} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}>{p.label}</text>
            ) : null)}
            {hasPrev && <path className="wa-line-prev" d={line('prev')} />}
            {area && <path className="wa-area" d={area} />}
            <path className="wa-line" d={cur} />
            {n === 1 && points[0].value != null && <circle className="wa-dot" cx={x(0)} cy={y(points[0].value)} r={4} />}
            {hp && (
              <g>
                <line className="wa-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} />
                {hasPrev && hp.prev != null && <circle className="wa-dot-prev" cx={x(hover)} cy={y(hp.prev)} r={4} />}
                {hp.value != null && <circle className="wa-dot" cx={x(hover)} cy={y(hp.value)} r={5} />}
              </g>
            )}
          </svg>
          {hp && (
            <div className="wa-tooltip" style={{ left: tipLeft }} role="status">
              <div className="wa-tooltip-row">
                <span className="wa-swatch" />
                <span className="wa-tooltip-label">{hp.longLabel}</span>
                <strong>{hp.value == null ? '—' : fmtValue(hp.value, fmt)}</strong>
              </div>
              {hasPrev && (
                <div className="wa-tooltip-row wa-tooltip-prev">
                  <span className="wa-swatch wa-swatch-prev" />
                  <span className="wa-tooltip-label">{hp.prevLabel || compareLabel}</span>
                  <strong>{hp.prev == null ? '—' : fmtValue(hp.prev, fmt)}</strong>
                </div>
              )}
            </div>
          )}
          {hasPrev && (
            <div className="wa-legend">
              <span><span className="wa-swatch" />{metricLabel}</span>
              <span><span className="wa-swatch wa-swatch-prev" />{compareLabel}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function firstIndex(points, key) { return Math.max(0, points.findIndex(p => p[key] != null)) }
function lastIndex(points, key) {
  for (let i = points.length - 1; i >= 0; i--) if (points[i][key] != null) return i
  return 0
}

function niceScale(rawMax, fmt) {
  if (fmt === 'pct' && rawMax > 50) return { max: 100, ticks: [0, 25, 50, 75, 100] }
  if (!rawMax || rawMax <= 0) return { max: 4, ticks: [0, 1, 2, 3, 4] }
  const steps = 4
  const rough = rawMax / steps
  const mag = 10 ** Math.floor(Math.log10(rough))
  const norm = rough / mag
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  if (fmt === 'num' && step < 1) step = 1
  const max = step * Math.ceil(rawMax / step)
  const ticks = []
  for (let t = 0; t <= max + step / 2; t += step) ticks.push(Math.round(t * 1000) / 1000)
  return { max, ticks }
}

function axisLabel(v, fmt) {
  if (fmt === 'dur') return v >= 60 ? `${Math.round(v / 60)}m` : `${v}s`
  if (fmt === 'pct' || fmt === 'pct2') return `${v}%`
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`
  return String(v)
}
