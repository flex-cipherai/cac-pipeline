import { CLASSIFICATION_THRESHOLDS, HARD_DISQUALIFIERS } from '../../lib/scoring'
import { SettingsHeading } from './SettingsLayout'

export default function ScoringSettings() {
  return (
    <div>
      <SettingsHeading title="Scoring" hint="How a lead's answers become Hot, Warm or Cold. These rules are set in the code (src/lib/scoring.js), so they are shown here for reference." />

      <div className="settings-scoring-cards">
        <div className="settings-score-card hot"><div className="settings-score-label">Hot</div><div className="settings-score-range">{CLASSIFICATION_THRESHOLDS.hot.min} – {CLASSIFICATION_THRESHOLDS.hot.max}</div></div>
        <div className="settings-score-card warm"><div className="settings-score-label">Warm</div><div className="settings-score-range">{CLASSIFICATION_THRESHOLDS.warm.min} – {CLASSIFICATION_THRESHOLDS.warm.max}</div></div>
        <div className="settings-score-card cold"><div className="settings-score-label">Cold</div><div className="settings-score-range">{CLASSIFICATION_THRESHOLDS.cold.min} – {CLASSIFICATION_THRESHOLDS.cold.max}</div></div>
      </div>
      <div className="settings-card" style={{ marginTop: 'var(--space-md)', padding: 'var(--space-lg)' }}>
        <h3 className="settings-disq-title" style={{ padding: 0 }}>Hard Disqualifiers</h3>
        {HARD_DISQUALIFIERS.map((d, i) => <p key={i} className="settings-disq-item" style={{ paddingLeft: 0 }}>• {d.question}: {d.response}</p>)}
      </div>
    </div>
  )
}
