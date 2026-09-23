import { Link } from 'react-router-dom';
import { Card } from '../../ui/Layout';
import { Money } from '../../glyphs';
import { percent } from '../../lib/format';
import type { HomeData } from './homeData';

/**
 * Your quarter. Won against quota is the headline; open and weighted sit under
 * it, labelled, because weighted and unweighted are never confused.
 */
export function QuarterCard({ quarter }: { quarter: HomeData['quarter'] }) {
  const target = quarter.target ?? 0;
  const share = target > 0 ? quarter.won / target : 0;
  const gap = Math.max(0, target - quarter.won);
  const covered = target > 0 ? (quarter.won + quarter.weighted) / target : 0;
  // With no quota, no open deals and nothing won, the hero figure is a 44px "$0" —
  // the biggest thing on Home saying nothing. Say it in a sentence instead.
  const nothingYet = target === 0 && quarter.won === 0 && quarter.open === 0 && quarter.openCount === 0;

  if (nothingYet) {
    return (
      <Card padded className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-title font-semibold text-ink">Your quarter</h2>
          <span className="text-meta text-ink-3">{quarter.label}</span>
        </div>
        <p className="text-ui text-ink-2 text-pretty">No deals of your own yet. Once you own one, what it is worth and how it tracks against your quota show up here.</p>
        <Link to="/reports/forecast" className="mt-1 self-start text-ui font-medium text-accent hover:underline">
          See the team forecast →
        </Link>
      </Card>
    );
  }

  return (
    <Card padded className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-title font-semibold text-ink">Your quarter</h2>
        <span className="text-meta text-ink-3">{quarter.label}</span>
      </div>

      <div>
        <div className="tabular font-display text-display-lg leading-none text-ink">
          <Money value={quarter.won} compact />
        </div>
        <p className="mt-1.5 text-meta text-ink-2">
          {target > 0 ? (
            <>
              won of <Money value={target} compact className="text-ink" /> quota · {percent(share)}
            </>
          ) : (
            <>won this quarter · no quota set</>
          )}
        </p>
      </div>

      {target > 0 && (
        <div className="flex flex-col gap-1.5">
          {/* Won is solid; the weighted pipeline that could still land is the same ink, half strength. */}
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${percent(share)} of quota won, weighted pipeline covers ${percent(Math.min(1.5, covered))}`}>
            <div className="bg-success" style={{ width: `${Math.min(100, (quarter.won / target) * 100)}%` }} />
            <div className="bg-accent/35" style={{ width: `${Math.min(100 - Math.min(100, (quarter.won / target) * 100), (Math.min(quarter.weighted, gap) / target) * 100)}%` }} />
          </div>
          <p className="text-meta text-ink-3">
            {gap > 0 ? (
              <>
                <Money value={gap} compact className="text-ink-2" /> to go · weighted pipeline covers {percent(Math.min(1.5, covered))}
              </>
            ) : (
              <>Quota met. Everything from here is upside.</>
            )}
          </p>
        </div>
      )}

      {/* Three figures, so the link that used to sit in the fourth cell now has its own line. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
        <Figure label="Open pipeline" value={<Money value={quarter.open} compact />} hint={`${quarter.openCount} open ${quarter.openCount === 1 ? 'deal' : 'deals'}`} />
        <Figure label="Weighted" value={<Money value={quarter.weighted} compact />} hint="By stage probability" />
        <Figure
          label={target > 0 ? 'Quota' : 'Deals won'}
          value={target > 0 ? <Money value={target} compact /> : quarter.wonCount}
          hint={target > 0 ? `${quarter.wonCount} ${quarter.wonCount === 1 ? 'deal' : 'deals'} won so far` : 'Set a quota in settings'}
        />
      </dl>
      <Link to="/reports/forecast" className="-mt-1 self-start text-ui font-medium text-accent hover:underline">
        Forecast →
      </Link>
    </Card>
  );
}

function Figure({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div>
      <dt className="text-micro font-semibold uppercase text-ink-3">{label}</dt>
      <dd className="tabular mt-0.5 text-title font-semibold text-ink">{value}</dd>
      <p className="text-meta text-ink-3">{hint}</p>
    </div>
  );
}
