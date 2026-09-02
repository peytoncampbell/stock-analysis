import type React from 'react';
import { ArrowRight, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react';
import type { ScreeningCandidate, ScreeningRunDetail } from '../../api/screening';

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
  onAnalyze: (candidate: ScreeningCandidate) => void;
}

const FACTOR_LABELS: Record<string, [string, string]> = {
  activity: ['Activity', '活跃度'],
  liquidity: ['Liquidity', '流动性'],
  momentum: ['Momentum', '动量'],
  reversal: ['Reversal', '反转'],
  size: ['Size', '规模'],
  stability: ['Stability', '稳定性'],
  theme_heat: ['Theme', '题材热度'],
  topic_alignment: ['Theme fit', '题材匹配'],
  value: ['Value', '价值'],
};

function formatRunTime(value: string | null | undefined, english: boolean): string {
  if (!value) return english ? 'Latest completed run' : '最近一次已完成运行';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(english ? 'en-CA' : 'zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function topFactors(candidate: ScreeningCandidate, english: boolean): string {
  return Object.entries(candidate.factorScores || {})
    .filter(([, value]) => Number.isFinite(value))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([key, value]) => `${FACTOR_LABELS[key]?.[english ? 0 : 1] || key} ${Math.round(value)}`)
    .join(' · ');
}

const Metric: React.FC<{ label: string; value: React.ReactNode; note: string }> = ({ label, value, note }) => (
  <div className="min-w-0 px-4 py-4 first:pl-0 last:pr-0 md:px-6">
    <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-text">{label}</dt>
    <dd className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">{value}</dd>
    <p className="mt-1 truncate text-xs text-secondary-text">{note}</p>
  </div>
);

export const HomeOpportunityDashboard: React.FC<HomeOpportunityDashboardProps> = ({
  run,
  loading,
  error,
  english,
  watchlistCount,
  analyzedTodayCount,
  activeTaskCount,
  onRefresh,
  onOpenScreening,
  onAnalyze,
}) => {
  const candidates = run?.result.candidates?.slice(0, 10) || [];
  const snapshotCount = run?.result.snapshotCount ?? run?.snapshotCount ?? 0;
  const filteredCount = run?.result.afterFilterCount ?? run?.afterFilterCount ?? 0;
  const advancingCount = candidates.filter((candidate) => Number(candidate.changePct) > 0).length;
  const decliningCount = candidates.filter((candidate) => Number(candidate.changePct) < 0).length;
  const coverage = snapshotCount > 0 ? Math.round((filteredCount / snapshotCount) * 100) : 0;

  return (
    <section className="animate-fade-in" data-testid="home-opportunity-dashboard">
      <header className="flex flex-col gap-5 border-b border-border/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            {english ? 'Market intelligence' : '市场情报'}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {english ? 'Top opportunities' : '优选机会'}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-secondary-text">
            {english
              ? 'The latest Wealthsimple-focused screen, ranked by liquidity, momentum, stability, activity, and size.'
              : '最新 Wealthsimple 股票筛选结果，按流动性、动量、稳定性、活跃度和规模排序。'}
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
            {english ? 'Refresh' : '刷新'}
          </button>
          <button
            type="button"
            onClick={onOpenScreening}
            className="btn-primary inline-flex h-9 items-center gap-2 px-3 text-xs"
          >
            {english ? 'Open screener' : '打开选股'}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <dl className="grid grid-cols-2 divide-x divide-y divide-border/70 border-b border-border/80 md:grid-cols-4 md:divide-y-0">
        <Metric
          label={english ? 'Universe' : '股票池'}
          value={snapshotCount || '—'}
          note={english ? 'Canadian + U.S. listings' : '加拿大与美国上市标的'}
        />
        <Metric
          label={english ? 'Passed filters' : '通过筛选'}
          value={filteredCount || '—'}
          note={english ? `${coverage}% of the universe` : `占股票池 ${coverage}%`}
        />
        <Metric
          label={english ? 'Ranked picks' : '入选标的'}
          value={candidates.length || '—'}
          note={english ? 'Highest factor scores' : '因子评分最高'}
        />
        <Metric
          label={english ? 'Watchlist today' : '今日自选'}
          value={`${analyzedTodayCount}/${watchlistCount}`}
          note={activeTaskCount > 0
            ? (english ? `${activeTaskCount} analyses running` : `${activeTaskCount} 个分析运行中`)
            : (english ? 'No analyses running' : '当前无运行中分析')}
        />
      </dl>

      {loading && !run ? (
        <div className="grid gap-7 py-7 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="space-y-1" aria-label={english ? 'Loading ranked stocks' : '正在加载优选股票'}>
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex animate-pulse items-center gap-4 border-b border-border/60 py-4">
                <span className="h-5 w-6 rounded bg-hover" />
                <span className="h-9 flex-1 rounded bg-hover" />
                <span className="h-7 w-20 rounded bg-hover" />
              </div>
            ))}
          </div>
        </div>
      ) : error && !run ? (
        <div className="py-10 text-center">
          <p className="text-sm font-medium text-foreground">{english ? 'Screening results are unavailable.' : '暂时无法加载选股结果。'}</p>
          <p className="mt-1 text-xs text-secondary-text">{error}</p>
          <button type="button" className="mt-4 text-xs font-semibold text-primary hover:underline" onClick={onRefresh}>
            {english ? 'Try again' : '重试'}
          </button>
        </div>
      ) : candidates.length > 0 ? (
        <div className="grid gap-7 py-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="min-w-0">
            <div className="mb-2 grid grid-cols-[2rem_minmax(0,1fr)_5.5rem] gap-3 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-text md:grid-cols-[2rem_minmax(0,1.25fr)_minmax(8rem,.8fr)_6.5rem_5.5rem]">
              <span>#</span>
              <span>{english ? 'Stock' : '股票'}</span>
              <span className="hidden md:block">{english ? 'Signal' : '信号'}</span>
              <span className="hidden text-right md:block">{english ? 'Price' : '价格'}</span>
              <span className="text-right">{english ? 'Score' : '评分'}</span>
            </div>
            <ol className="divide-y divide-border/70 border-y border-border/80" aria-label={english ? 'Ranked stock opportunities' : '股票机会排名'}>
              {candidates.map((candidate, index) => {
                const score = Number(candidate.score ?? candidate.screenScore ?? 0);
                const change = Number(candidate.changePct ?? 0);
                const currency = candidate.currency || '';
                const factors = topFactors(candidate, english);
                return (
                  <li key={candidate.code} className="animate-fade-in" style={{ animationDelay: `${Math.min(index * 35, 280)}ms` }}>
                    <button
                      type="button"
                      onClick={() => onAnalyze(candidate)}
                      aria-label={`${english ? 'Analyze' : '分析'} ${candidate.code}`}
                      className={`group grid w-full grid-cols-[2rem_minmax(0,1fr)_5.5rem] items-center gap-3 px-2 py-3.5 text-left transition-all duration-200 hover:bg-primary/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 md:grid-cols-[2rem_minmax(0,1.25fr)_minmax(8rem,.8fr)_6.5rem_5.5rem] ${index === 0 ? 'bg-primary/[0.04]' : ''}`}
                    >
                      <span className={`font-mono text-sm ${index < 3 ? 'font-semibold text-primary' : 'text-muted-text'}`}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-baseline gap-2">
                          <strong className="font-mono text-sm font-semibold text-foreground">{candidate.code}</strong>
                          <span className="truncate text-xs text-secondary-text">{candidate.name || candidate.code}</span>
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-text">
                          {[candidate.exchange, currency, candidate.assetType?.toUpperCase()].filter(Boolean).join(' · ')}
                          <span className="md:hidden">{currency ? ` · ${currency} ` : ' · '}{candidate.price?.toFixed(2) ?? '—'}</span>
                        </span>
                      </span>
                      <span className="hidden truncate text-xs text-secondary-text md:block">{factors || (english ? 'Factor ranked' : '因子排序')}</span>
                      <span className="hidden text-right md:block">
                        <span className="block font-mono text-xs font-medium text-foreground">
                          {currency ? `${currency} ` : ''}{candidate.price?.toFixed(2) ?? '—'}
                        </span>
                        <span className={`mt-0.5 block text-[11px] ${change > 0 ? 'text-success' : change < 0 ? 'text-danger' : 'text-muted-text'}`}>
                          {change > 0 ? '+' : ''}{change.toFixed(2)}%
                        </span>
                      </span>
                      <span className="min-w-0 text-right">
                        <span className="flex items-center justify-end gap-1.5">
                          <strong className="font-mono text-sm font-semibold text-foreground">{score.toFixed(1)}</strong>
                          <ArrowRight className="h-3.5 w-3.5 -translate-x-1 text-primary opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" aria-hidden="true" />
                        </span>
                        <span className="mt-1 ml-auto block h-1 w-14 overflow-hidden rounded-full bg-hover">
                          <span className="block h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <aside className="border-t border-border/80 pt-5 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              {english ? 'Screening context' : '筛选概况'}
            </div>
            <dl className="mt-4 divide-y divide-border/70 border-y border-border/80 text-xs">
              <div className="flex items-center justify-between py-3">
                <dt className="text-secondary-text">{english ? 'Advancing' : '上涨'}</dt>
                <dd className="font-mono font-semibold text-success">{advancingCount}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="text-secondary-text">{english ? 'Declining' : '下跌'}</dt>
                <dd className="font-mono font-semibold text-danger">{decliningCount}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="text-secondary-text">{english ? 'Ranking' : '排序方式'}</dt>
                <dd className="font-medium text-foreground">{run?.result.llmRanked ? (english ? 'Model + factors' : '模型 + 因子') : (english ? 'Factor score' : '因子评分')}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-3">
                <dt className="text-secondary-text">{english ? 'Updated' : '更新时间'}</dt>
                <dd className="text-right font-medium text-foreground">{formatRunTime(run?.createdAt, english)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-[11px] leading-5 text-muted-text">
              {english
                ? '“Likely” eligibility is inferred from the listing exchange. Confirm the symbol in Wealthsimple before placing an order.'
                : '“可能支持”基于上市交易所推断。下单前请在 Wealthsimple 中确认该代码。'}
            </p>
          </aside>
        </div>
      ) : (
        <div className="py-10 text-center">
          <p className="text-sm font-medium text-foreground">{english ? 'No completed Wealthsimple screen yet.' : '暂无已完成的 Wealthsimple 选股结果。'}</p>
          <button type="button" className="mt-3 text-xs font-semibold text-primary hover:underline" onClick={onOpenScreening}>
            {english ? 'Run your first screen' : '开始第一次选股'}
          </button>
        </div>
      )}
    </section>
  );
};
