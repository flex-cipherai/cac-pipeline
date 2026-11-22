// Shared building blocks for the Social Media pages (Metricool-style):
// platform badges, account avatars, the account bar, stat tiles, the
// best-time heatmap and a small trend chart. Plain SVG/CSS, no chart library.
import { Link } from 'react-router-dom'
import { PLATFORM_LIST, platformOf, accountKindLabel } from '../../lib/platforms'
import { isPersonal } from '../../lib/socialAccounts'
import './SocialUI.css'

export function PlatformIcon({ platform, size = 16 }) {
  const p = typeof platform === 'string' ? PLATFORM_LIST.find(x => x.key === platform) : platform
  if (!p) return null
  return (
    <span className="sm-platform-icon" style={{ width: size, height: size, background: p.color, fontSize: Math.max(8, size * 0.5) }} title={p.name} aria-label={p.name}>
      {p.short}
    </span>
  )
}

function initials(name = '') {
  return name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

export function AccountAvatar({ account, size = 32 }) {
  const p = platformOf(account)
  return (
    <span className={`sm-avatar ${isPersonal(account) ? 'sm-avatar-round' : ''}`} style={{ width: size, height: size }}>
      {account.avatar_url
        ? <img src={account.avatar_url} alt="" />
        : <span className="sm-avatar-initials" style={{ fontSize: size * 0.36 }}>{initials(account.account_name)}</span>}
      <span className="sm-avatar-badge"><PlatformIcon platform={p} size={Math.max(12, size * 0.42)} /></span>
    </span>
  )
}

// Account chips: "All" + one per connected account; multi-select. Coming-soon
// platforms are shown greyed, linking to Integrations, so the team sees what's next.
export function AccountBar({ accounts, selected, onChange, showComingSoon = true }) {
  const toggle = (id) => {
    const next = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
    onChange(next.length === accounts.length ? [] : next)
  }
  const connectedPlatforms = new Set(accounts.map(a => a.platform))
  return (
    <div className="sm-account-bar" role="toolbar" aria-label="Accounts">
      <button className={`sm-chip ${selected.length === 0 ? 'active' : ''}`} onClick={() => onChange([])}>All accounts</button>
      {accounts.map(a => (
        <button
          key={a.id}
          className={`sm-chip ${selected.includes(a.id) ? 'active' : ''}`}
          onClick={() => toggle(a.id)}
          title={`${platformOf(a).name} ${accountKindLabel(a)}`}
        >
          <AccountAvatar account={a} size={22} />
          <span className="sm-chip-label">{a.account_name}</span>
        </button>
      ))}
      {showComingSoon && PLATFORM_LIST.filter(p => p.status !== 'live' && !connectedPlatforms.has(p.key)).length > 0 && (
        <Link to="/settings/integrations" className="sm-chip sm-chip-ghost" title="More networks are on the way">
          {PLATFORM_LIST.filter(p => p.status !== 'live').map(p => <PlatformIcon key={p.key} platform={p} size={16} />)}
          <span className="sm-chip-label">Soon</span>
        </Link>
      )}
    </div>
  )
}

export function SocialHeader({ title, subtitle, children }) {
  return (
    <div className="sm-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      <div className="sm-header-actions">{children}</div>
    </div>
  )
}

export function pctChange(cur, prev) {
  if (!prev) return cur ? null : 0
  return ((cur - prev) / prev) * 100
}

export function StatTile({ label, value, previous, format = v => Math.round(v).toLocaleString(), hint }) {
  const change = previous === undefined ? undefined : pctChange(value, previous)
  return (
    <div className="sm-stat">
      <div className="sm-stat-label">{label}</div>
      <div className="sm-stat-value">{format(value || 0)}</div>
      {change !== undefined && (
        <div className={`sm-stat-delta ${change === null ? 'up' : change >= 0 ? 'up' : 'down'}`}>
          {change === null ? 'New' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(0)}%`}
          <span> vs previous</span>
        </div>
      )}
      {hint && <div className="sm-stat-hint">{hint}</div>}
    </div>
  )
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// cells: [{ weekday 1-7, hour 0-23, value }] — darker = better.
export function Heatmap({ cells, hours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], valueLabel = v => `${v.toFixed(1)}%`, emptyNote }) {
  const max = Math.max(0, ...cells.map(c => c.value || 0))
  const get = (d, h) => cells.find(c => c.weekday === d && c.hour === h)
  return (
    <div className="sm-heatmap">
      <div className="sm-heatmap-grid" style={{ gridTemplateColumns: `40px repeat(${hours.length}, 1fr)` }}>
        <span />
        {hours.map(h => <span key={h} className="sm-heatmap-hour">{String(h).padStart(2, '0')}</span>)}
        {DAY_LABELS.map((label, i) => (
          <FragmentRow key={label} label={label} hours={hours} get={h => get(i + 1, h)} max={max} valueLabel={valueLabel} />
        ))}
      </div>
      {emptyNote && <p className="sm-heatmap-note">{emptyNote}</p>}
    </div>
  )
}

function FragmentRow({ label, hours, get, max, valueLabel }) {
  return (
    <>
      <span className="sm-heatmap-day">{label}</span>
      {hours.map(h => {
        const c = get(h)
        const strength = c && max > 0 ? Math.max(0.12, (c.value || 0) / max) : 0
        return (
          <span
            key={h}
            className="sm-heatmap-cell"
            style={{ background: strength ? `rgba(236, 48, 19, ${strength})` : undefined }}
            title={c ? `${label} ${String(h).padStart(2, '0')}:00 — ${valueLabel(c.value || 0)}${c.posts ? ` · ${c.posts} post${c.posts === 1 ? '' : 's'}` : ''}` : `${label} ${String(h).padStart(2, '0')}:00`}
          />
        )
      })}
    </>
  )
}

// Simple line/area chart. series: [{ label, values: number[], color }], labels: string[]
export function TrendChart({ labels, series, height = 180 }) {
  const width = 640
  const pad = { l: 36, r: 8, t: 10, b: 22 }
  const all = series.flatMap(s => s.values)
  const max = Math.max(1, ...all)
  const x = i => pad.l + (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * (width - pad.l - pad.r))
  const y = v => pad.t + (1 - v / max) * (height - pad.t - pad.b)
  const ticks = [0, max / 2, max]
  const step = Math.max(1, Math.ceil(labels.length / 8))
  if (!labels.length) return <div className="sm-chart-empty">No data in this period yet.</div>
  return (
    <svg className="sm-trend" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="sm-trend-grid" />
          <text x={pad.l - 6} y={y(t) + 3} className="sm-trend-axis" textAnchor="end">{t >= 1000 ? `${(t / 1000).toFixed(1)}k` : Math.round(t)}</text>
        </g>
      ))}
      {labels.map((l, i) => i % step === 0 && <text key={l + i} x={x(i)} y={height - 6} className="sm-trend-axis" textAnchor="middle">{l}</text>)}
      {series.map(s => {
        const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
        return (
          <g key={s.label}>
            <polygon points={`${x(0)},${y(0)} ${pts} ${x(s.values.length - 1)},${y(0)}`} fill={s.color} opacity="0.08" />
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </g>
        )
      })}
    </svg>
  )
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="sm-empty">
      <div className="sm-empty-title">{title}</div>
      {children && <p className="sm-empty-desc">{children}</p>}
      {action}
    </div>
  )
}
