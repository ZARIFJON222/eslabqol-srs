import type { WordCard } from '../types';
import { SRS_STAGES } from '../lib/srs';

interface ScheduleViewProps {
  cards: WordCard[];
}

export function ScheduleView({ cards }: ScheduleViewProps) {
  const counts = SRS_STAGES.map(
    (spec) => cards.filter((c) => c.stage === spec.stage).length
  );
  const maxCount = Math.max(1, ...counts);

  return (
    <section aria-label="SRS takrorlash jadvali">
      <div className="section-header-row">
        <div>
          <h1 className="section-title">SRS Xotira Bosqichlari</h1>
          <p className="section-sub">
            1-kuni tezkor takrorlash (20 daq, 2 soat, 6 soat), keyin esa 2 oygacha uzoq muddatli xotiraga o‘tadi.
          </p>
        </div>
      </div>

      <div className="stage-list">
        {SRS_STAGES.map((spec, idx) => {
          const count = counts[idx];
          const pct = Math.round((count / maxCount) * 100);
          return (
            <div key={spec.stage} className="stage-card">
              <div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                  Bosqich {spec.stage}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {spec.label}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {spec.phase}
                </div>
                <div className="stage-bar-track" aria-hidden="true">
                  <div
                    className={`stage-bar-fill ${spec.stage >= 7 ? 'is-long' : ''}`}
                    style={{ width: count > 0 ? `${Math.max(5, pct)}%` : '0%' }}
                  />
                </div>
              </div>

              <div
                className="mono"
                style={{
                  textAlign: 'right',
                  fontSize: 14,
                  fontWeight: 700,
                  color: count > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {count} ta
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
