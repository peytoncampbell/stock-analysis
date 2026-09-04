import type React from 'react';
import { ArrowRight, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import type { ScreeningCandidate, ScreeningRunDetail } from '../../api/screening';
import {
  formatScreeningPrice as formatPrice,
  formatTargetUpside as formatUpside,
  getScreeningPriceOutlook as priceOutlook,
  screeningMetric as metric,
} from '../../utils/screeningText';

interface HomeOpportunityDashboardProps {
  run: ScreeningRunDetail | null;
  loading: boolean;
  error: string;
  english: boolean;
  watchlistCount: number;
  analyzedTodayCount: number;
  activeTaskCount: number;
  onRefresh: () => void;
  onOpenScreening: () => void;
}

const FACTOR_LABELS: Record<string, string> = {
  activity: 'Activity',
  liquidity: 'Liquidity',
  momentum: 'Momentum',
  reversal: 'Reversal',
  size: 'Size',
  stability: 'Stability',
  theme_heat: 'Theme',
  topic_alignment: 'Theme fit',
  value: 'Value',
  valuation: 'Valuation',
  growth: 'Growth',
  cashGeneration: 'Free cash flow',
  quality: 'Quality',
  balanceSheet: 'Balance sheet',
  revisions: 'Revisions',
  catalysts: 'Catalysts',
  valueTrap: 'Value-trap safety',
};

const CORE_FACTOR_KEYS = new Set(['momentum', 'stability', 'liquidity', 'activity']);
const VALUE_FACTOR_KEYS = new Set(['valuation', 'growth', 'cashGeneration', 'quality', 'balanceSheet', 'revisions', 'catalysts', 'valueTrap']);

function formatRunTime(value: string | null | undefined): string {
  if (!value) return 'Latest completed run';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function topFactors(candidate: ScreeningCandidate, strategy?: string): string {
  const activeFactors = strategy === 'institutional_value' ? VALUE_FACTOR_KEYS : CORE_FACTOR_KEYS;
  return Object.entries(candidate.factorScores || {})
    .filter(([key, value]) => activeFactors.has(key) && Number.isFinite(value))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([key, value]) => `${FACTOR_LABELS[key] || key} ${Math.round(value)}`)
    .join(' · ');
}

function formatMetric(value: number | null, kind: 'multiple' | 'percent'): string {
  if (value === null) return '—';
  return `${value.toFixed(1)}${kind === 'percent' ? '%' : 'x'}`;
}

function priceTone(value: number | null, current: number | null, downside = false): string {
  if (value === null || current === null || value === current) return 'text-foreground';
  if (downside) return 'text-danger';
  return value > current ? 'text-success' : 'text-danger';
}

function scoreLevel(score: number): string {
  if (score >= 80) return 'Exceptional';
  if (score >= 65) return 'Strong';
  if (score >= 50) return 'Balanced';
  return 'Weak';
}

function metricTone(value: number | null): string {
  if (value === null || value === 0) return 'text-secondary-text';
  return value > 0 ? 'text-success' : 'text-danger';
}

const SummaryMetric: React.FC<{ label: string; value: React.ReactNode; note: string }> = ({ label, value, note }) => (
  <div className="min-w-0 py-4 pr-4 md:pr-6">
    <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-text">{label}</dt>
    <dd className="mt-1.5 font-mono text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{value}</dd>
    <p className="mt-1 truncate text-[11px] text-secondary-text">{note}</p>
  </div>
);

const EvidenceMetric: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone = 'text-foreground' }) => (
  <div className="min-w-0 border-l border-border/70 pl-3 first:border-l-0 first:pl-0 sm:pl-4">
    <dt className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-text">{label}</dt>
    <dd className={`mt-1 font-mono text-sm font-semibold ${tone}`}>{value}</dd>
  </div>
);

const PricePoint: React.FC<{ label: string; value: string; note: string; tone?: string }> = ({ label, value, note, tone = 'text-foreground' }) => (
  <div className="min-w-0 border-l border-border/70 pl-3 first:border-l-0 first:pl-0 sm:pl-4">
    <dt className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-text">{label}</dt>
    <dd className={`mt-1.5 font-mono text-base font-semibold ${tone}`}>{value}</dd>
    <p className="mt-1 text-[9px] text-muted-text">{note}</p>
  </div>
);

const ComparisonPrice: React.FC<{
  value: number | null;
  current: number | null;
  baseline?: boolean;
  downside?: boolean;
}> = ({ value, current, baseline = false, downside = false }) => {
  const tone = priceTone(value, current, downside);
  return (
    <span className="min-w-0 text-right">
      <span className={`block font-mono text-xs font-medium ${tone}`}>{formatPrice(value, '', false)}</span>
      <span className={`mt-0.5 block font-mono text-[9px] ${baseline ? 'text-muted-text' : tone}`}>
        {baseline ? 'Baseline' : formatUpside(value, current)}
      </span>
    </span>
  );
};

export const HomeOpportunityDashboard: React.FC<HomeOpportunityDashboardProps> = ({
  run,
  loading,
  error,
  onRefresh,
  onOpenScreening,
}) => {
  const candidates = run?.result.candidates?.slice(0, 10) || [];
  const leader = candidates[0];
  const alternatives = candidates.slice(1);
  const snapshotCount = run?.result.snapshotCount ?? run?.snapshotCount ?? 0;
  const filteredCount = run?.result.afterFilterCount ?? run?.afterFilterCount ?? 0;
  const filterRate = snapshotCount > 0 ? (filteredCount / snapshotCount) * 100 : 0;
  const scores = candidates.map((candidate) => Number(candidate.score ?? candidate.screenScore ?? 0));
  const sortedScores = [...scores].sort((left, right) => left - right);
  const scoreMidpoint = Math.floor(sortedScores.length / 2);
  const medianScore = sortedScores.length === 0
    ? 0
    : sortedScores.length % 2
      ? sortedScores[scoreMidpoint]
      : (sortedScores[scoreMidpoint - 1] + sortedScores[scoreMidpoint]) / 2;
  const institutional = run?.strategy === 'institutional_value';
  const leaderScore = Number(leader?.score ?? leader?.screenScore ?? 0);
  const leaderRevision = metric(leader, 'epsRevision30D');
  const leaderEpsGrowth = metric(leader, 'nextYearEpsGrowth');
  const leaderOutlook = priceOutlook(leader);
  const leaderRisk = leaderEpsGrowth !== null && leaderEpsGrowth < -15
    ? `Next-year EPS estimate is ${formatMetric(leaderEpsGrowth, 'percent')}; normalized earnings need review.`
    : leader?.riskFlags?.[0]?.replaceAll('_', ' ') || 'No material quantitative risk flag in this screen.';

  return (
    <section data-testid="home-opportunity-dashboard" className="pb-6">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="flex flex-col gap-5 border-b border-border/80 pb-5 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            Latest completed screen
            <span className="text-muted-text">· {formatRunTime(run?.createdAt)}</span>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
            {institutional ? 'U.S. value rankings' : 'Market opportunity rankings'}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">
            {institutional
              ? 'Compare valuation, cash generation, earnings revisions, business quality, and risk across the highest-ranked liquid U.S. stocks.'
              : 'Compare the strongest stocks from the latest completed market screen.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="home-surface-button inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-secondary-text transition-colors hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <button type="button" onClick={onOpenScreening} className="btn-primary inline-flex h-9 items-center gap-2 px-3 text-xs">
            Full screener
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </motion.header>

      <dl className="grid grid-cols-2 gap-x-5 border-b border-border/80 md:grid-cols-4">
        <SummaryMetric label="Stocks analyzed" value={snapshotCount ? snapshotCount.toLocaleString() : '—'} note="U.S. listings reviewed" />
        <SummaryMetric label="Passed minimums" value={filteredCount ? filteredCount.toLocaleString() : '—'} note={`${filterRate.toFixed(1)}% met size + liquidity`} />
        <SummaryMetric label="Top score" value={leader ? leaderScore.toFixed(1) : '—'} note={leader ? `${scoreLevel(leaderScore)} ranking tier` : 'Awaiting results'} />
        <SummaryMetric label="Top 10 median" value={scores.length ? medianScore.toFixed(1) : '—'} note="Fast quality check" />
      </dl>

      {loading && !run ? (
        <div className="space-y-2 py-7" aria-label="Loading ranked stocks">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex animate-pulse items-center gap-4 border-b border-border/60 py-4">
              <span className="h-5 w-8 rounded bg-hover" />
              <span className="h-10 flex-1 rounded bg-hover" />
              <span className="h-8 w-24 rounded bg-hover" />
            </div>
          ))}
        </div>
      ) : error && !run ? (
        <div className="py-10 text-center">
          <p className="text-sm font-medium text-foreground">Screening results are unavailable.</p>
          <p className="mt-1 text-xs text-secondary-text">{error}</p>
          <button type="button" className="mt-4 text-xs font-semibold text-primary hover:underline" onClick={onRefresh}>Try again</button>
        </div>
      ) : leader ? (
        <>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: 0.08 }}
            className="grid border-b border-border/80 lg:grid-cols-[minmax(0,1fr)_18rem]"
          >
            <div className="py-6 pr-0 lg:pr-8">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  #1 ranked
                </span>
                <span className="text-[11px] text-muted-text">Preliminary quantitative result</span>
              </div>

              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-3">
                    <h2 className="font-mono text-3xl font-semibold tracking-tight text-foreground">{leader.code}</h2>
                    <span className="truncate text-sm text-secondary-text">{leader.name || leader.code}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-text">
                    {[leader.exchange, leader.industry, leader.currency].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Link
                  to={`/screening/${encodeURIComponent(run?.runId || '')}/stocks/${encodeURIComponent(leader.code)}`}
                  aria-label={`View details for ${leader.code}`}
                  className="group inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  See why it ranks first
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </div>

              <dl data-testid="leader-metrics" className="mt-6 grid grid-cols-3 gap-y-5 sm:grid-cols-6">
                <EvidenceMetric label="Target upside" value={formatMetric(metric(leader, 'analystTargetUpside'), 'percent')} tone={metricTone(metric(leader, 'analystTargetUpside'))} />
                <EvidenceMetric label="Forward P/E" value={formatMetric(metric(leader, 'forwardPe'), 'multiple')} />
                <EvidenceMetric label="Next-year P/E" value={formatMetric(metric(leader, 'nextYearPe'), 'multiple')} />
                <EvidenceMetric label="FCF yield" value={formatMetric(metric(leader, 'fcfYield'), 'percent')} tone={metricTone(metric(leader, 'fcfYield'))} />
                <EvidenceMetric label="EPS revision 30d" value={formatMetric(leaderRevision, 'percent')} tone={metricTone(leaderRevision)} />
                <EvidenceMetric label="ROIC" value={formatMetric(metric(leader, 'roic'), 'percent')} tone={metricTone(metric(leader, 'roic'))} />
              </dl>

              <div data-testid="leader-price-outlook" className="mt-6 border-y border-border/70 py-4">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">Price outlook</p>
                  <p className="text-[10px] text-muted-text">Analyst-derived scenario · not a guaranteed forecast</p>
                </div>
                <dl className="grid grid-cols-2 gap-y-5 sm:grid-cols-6">
                  <PricePoint label="Current" value={formatPrice(leaderOutlook.current, leader.currency)} note="Baseline" />
                  <PricePoint label="1 month" value={formatPrice(leaderOutlook.oneMonth, leader.currency)} note={`${formatUpside(leaderOutlook.oneMonth, leaderOutlook.current)} · Interpolated`} tone={priceTone(leaderOutlook.oneMonth, leaderOutlook.current)} />
                  <PricePoint label="3 months" value={formatPrice(leaderOutlook.threeMonths, leader.currency)} note={`${formatUpside(leaderOutlook.threeMonths, leaderOutlook.current)} · Interpolated`} tone={priceTone(leaderOutlook.threeMonths, leaderOutlook.current)} />
                  <PricePoint label="1 year" value={formatPrice(leaderOutlook.oneYear, leader.currency)} note={`${formatUpside(leaderOutlook.oneYear, leaderOutlook.current)} · Mean target`} tone={priceTone(leaderOutlook.oneYear, leaderOutlook.current)} />
                  <PricePoint label="High case" value={formatPrice(leaderOutlook.highCase, leader.currency)} note={`${formatUpside(leaderOutlook.highCase, leaderOutlook.current)} · Highest target`} tone={priceTone(leaderOutlook.highCase, leaderOutlook.current)} />
                  <PricePoint label="Worst case*" value={formatPrice(leaderOutlook.worstCase, leader.currency)} note={`${formatUpside(leaderOutlook.worstCase, leaderOutlook.current)} · Lowest target`} tone={priceTone(leaderOutlook.worstCase, leaderOutlook.current, true)} />
                </dl>
              </div>

              <div className="mt-6 grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-text">Why it stands out</p>
                  <p className="mt-1.5 text-xs leading-5 text-foreground">{topFactors(leader, run?.strategy) || 'Highest combined factor score.'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-text">What still needs review</p>
                  <p className="mt-1.5 text-xs leading-5 text-secondary-text">{leaderRisk}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-border/80 bg-primary/[0.035] px-6 py-6 lg:border-t-0 lg:border-l">
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-text">Value score</p>
              <div className="mt-2 flex items-end gap-2">
                <strong className="font-mono text-6xl font-semibold leading-none tracking-[-0.08em] text-foreground">{leaderScore.toFixed(1)}</strong>
                <span className="mb-1 text-xs text-muted-text">/ 100</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-primary">{scoreLevel(leaderScore)}</p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-hover" aria-label={`Score ${leaderScore.toFixed(1)} out of 100`}>
                <motion.span
                  className="block h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(2, Math.min(100, leaderScore))}%` }}
                  transition={{ duration: 0.65, delay: 0.2, ease: 'easeOut' }}
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] text-muted-text">
                <span>50<br /><strong className="font-medium text-secondary-text">Balanced</strong></span>
                <span className="text-center">65<br /><strong className="font-medium text-secondary-text">Strong</strong></span>
                <span className="text-right">80<br /><strong className="font-medium text-secondary-text">Exceptional</strong></span>
              </div>
            </div>
          </motion.div>

          {alternatives.length > 0 ? (
            <div className="pt-6">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Ranked alternatives</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">Compare the next best scores</h2>
                </div>
                <p className="hidden text-[11px] text-muted-text sm:block">Click any row for the full score breakdown</p>
              </div>

              <div className="overflow-x-auto border-y border-border/80">
                <div className="min-w-[70rem]">
                  <div className="grid grid-cols-[2.5rem_minmax(11rem,1fr)_7rem_repeat(6,5.5rem)_5.5rem_5.5rem] gap-3 border-b border-border/70 px-2 py-2.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-text">
                    <span>Rank</span>
                    <span>Company</span>
                    <span>Score</span>
                    <span className="text-right">Current</span>
                    <span className="text-right">1 month</span>
                    <span className="text-right">3 months</span>
                    <span className="text-right">1 year</span>
                    <span className="text-right">High case</span>
                    <span className="text-right">Worst case*</span>
                    <span className="text-right">Forward P/E</span>
                    <span className="text-right">FCF yield</span>
                  </div>
                  <ol aria-label="Ranked stock opportunities">
                    {alternatives.map((candidate, index) => {
                      const score = Number(candidate.score ?? candidate.screenScore ?? 0);
                      const fcfYield = metric(candidate, 'fcfYield');
                      const outlook = priceOutlook(candidate);
                      return (
                        <motion.li
                          key={candidate.code}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.22, delay: 0.12 + index * 0.035 }}
                          className="border-b border-border/60 last:border-b-0"
                        >
                          <Link
                            to={`/screening/${encodeURIComponent(run?.runId || '')}/stocks/${encodeURIComponent(candidate.code)}`}
                            aria-label={`View details for ${candidate.code}`}
                            className="group grid grid-cols-[2.5rem_minmax(11rem,1fr)_7rem_repeat(6,5.5rem)_5.5rem_5.5rem] items-center gap-3 px-2 py-3.5 transition-colors hover:bg-primary/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                          >
                            <span className={`font-mono text-xs font-semibold ${index < 2 ? 'text-primary' : 'text-muted-text'}`}>{String(index + 2).padStart(2, '0')}</span>
                            <span className="min-w-0">
                              <span className="flex items-baseline gap-2">
                                <strong className="font-mono text-sm font-semibold text-foreground">{candidate.code}</strong>
                                <span className="truncate text-xs text-secondary-text">{candidate.name || candidate.code}</span>
                              </span>
                              <span className="mt-1 block truncate text-[10px] text-muted-text">{topFactors(candidate, run?.strategy) || 'Factor ranked'}</span>
                            </span>
                            <span className="flex items-center gap-2">
                              <strong className="w-9 font-mono text-sm font-semibold text-foreground">{score.toFixed(1)}</strong>
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                                <motion.span
                                  className="block h-full rounded-full bg-primary"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.max(2, Math.min(100, score))}%` }}
                                  transition={{ duration: 0.45, delay: 0.15 + index * 0.035 }}
                                />
                              </span>
                            </span>
                            <ComparisonPrice value={outlook.current} current={outlook.current} baseline />
                            <ComparisonPrice value={outlook.oneMonth} current={outlook.current} />
                            <ComparisonPrice value={outlook.threeMonths} current={outlook.current} />
                            <ComparisonPrice value={outlook.oneYear} current={outlook.current} />
                            <ComparisonPrice value={outlook.highCase} current={outlook.current} />
                            <ComparisonPrice value={outlook.worstCase} current={outlook.current} downside />
                            <span className="text-right font-mono text-xs font-medium text-foreground">{formatMetric(metric(candidate, 'forwardPe'), 'multiple')}</span>
                            <span className={`text-right font-mono text-xs font-medium ${metricTone(fcfYield)}`}>{formatMetric(fcfYield, 'percent')}</span>
                          </Link>
                        </motion.li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            </div>
          ) : null}

          <footer className="mt-5 text-[11px] leading-5 text-muted-text">
            <p className="flex max-w-2xl items-start gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              Scores are preliminary quantitative rankings, not buy recommendations. Open a stock to review its evidence, data gaps, and normalization risk.
            </p>
            <p className="mt-2 max-w-3xl">*One- and three-month prices interpolate toward the mean 12-month analyst target. “High case” and “Worst case” are the highest and lowest current analyst targets—not guaranteed limits.</p>
          </footer>
        </>
      ) : (
        <div className="py-10 text-center">
          <p className="text-sm font-medium text-foreground">No completed market screen yet.</p>
          <button type="button" className="mt-3 text-xs font-semibold text-primary hover:underline" onClick={onOpenScreening}>Run your first screen</button>
        </div>
      )}
    </section>
  );
};
