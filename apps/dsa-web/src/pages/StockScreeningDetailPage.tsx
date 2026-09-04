import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, CheckCircle2, Database, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { Link, useParams } from 'react-router-dom';
import { screeningApi, type ScreeningRunDetail } from '../api/screening';
import { AppPage, InlineAlert, Loading } from '../components/common';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import { formatEnrichmentSummary } from '../utils/screeningText';

type FactorDefinition = { key: string; weight: number; en: string; zh: string; enHelp: string; zhHelp: string };

const CORE_FACTORS: FactorDefinition[] = [
  { key: 'momentum', weight: 0.35, en: 'Momentum', zh: '动量', enHelp: 'Current price strength and direction.', zhHelp: '当前价格强度与方向。' },
  { key: 'stability', weight: 0.30, en: 'Stability', zh: '稳定性', enHelp: 'Rewards steadier price action and smaller shocks.', zhHelp: '奖励更平稳的价格走势与较小波动。' },
  { key: 'liquidity', weight: 0.20, en: 'Liquidity', zh: '流动性', enHelp: 'Measures how easily the listing trades.', zhHelp: '衡量标的成交与进出便利度。' },
  { key: 'activity', weight: 0.15, en: 'Activity', zh: '活跃度', enHelp: 'Measures trading activity relative to normal.', zhHelp: '衡量相对日常水平的交易活跃度。' },
];

const VALUE_FACTORS: FactorDefinition[] = [
  { key: 'valuation', weight: 0.25, en: 'Valuation', zh: '估值', enHelp: 'Relative earnings, cash-flow, and enterprise-value multiples.', zhHelp: '相对盈利、现金流与企业价值倍数。' },
  { key: 'growth', weight: 0.15, en: 'Growth', zh: '增长', enHelp: 'EPS, revenue, EBITDA, and free-cash-flow growth.', zhHelp: '每股收益、收入、EBITDA 与自由现金流增长。' },
  { key: 'cashGeneration', weight: 0.15, en: 'Free cash flow', zh: '自由现金流', enHelp: 'Free-cash-flow yield and margin.', zhHelp: '自由现金流收益率与利润率。' },
  { key: 'quality', weight: 0.15, en: 'Business quality', zh: '业务质量', enHelp: 'Returns on capital and operating margins.', zhHelp: '资本回报率与经营利润率。' },
  { key: 'balanceSheet', weight: 0.10, en: 'Balance sheet', zh: '资产负债表', enHelp: 'Leverage, coverage, and liquidity; financial firms are treated neutrally.', zhHelp: '杠杆、偿债与流动性；金融公司按中性处理。' },
  { key: 'revisions', weight: 0.10, en: 'Estimate revisions', zh: '预期修正', enHelp: '30-, 60-, and 90-day analyst estimate changes when available.', zhHelp: '可用时采用 30、60 与 90 天分析师预期变化。' },
  { key: 'catalysts', weight: 0.05, en: 'Catalysts', zh: '催化剂', enHelp: 'Neutral until filing and news research is completed.', zhHelp: '完成财报与新闻研究前保持中性。' },
  { key: 'valueTrap', weight: 0.05, en: 'Value-trap safety', zh: '价值陷阱防护', enHelp: 'Neutral until normalized earnings and qualitative risks are reviewed.', zhHelp: '完成正常化盈利与定性风险审查前保持中性。' },
];

const FUNDAMENTAL_METRICS = [
  ['totalMv', 'Market cap', 'money'], ['forwardPe', 'Forward P/E', 'multiple'],
  ['nextYearPe', 'Next-year P/E', 'multiple'], ['peRatio', 'Trailing P/E', 'multiple'],
  ['evEbitda', 'EV/EBITDA', 'multiple'], ['evEbit', 'EV/EBIT', 'multiple'],
  ['priceFcf', 'Price/FCF', 'multiple'], ['fcfYield', 'FCF yield', 'percent'],
  ['earningsYield', 'Earnings yield', 'percent'], ['pegRatio', 'PEG ratio', 'multiple'],
  ['pbRatio', 'Price/book', 'multiple'], ['priceSales', 'Price/sales', 'multiple'],
  ['currentYearEps', 'Current-year EPS', 'number'], ['nextYearEps', 'Next-year EPS', 'number'],
  ['nextYearEpsGrowth', 'Next-year EPS growth', 'percent'], ['epsRevision30D', 'EPS revision — 30d', 'percent'],
  ['epsRevision60D', 'EPS revision — 60d', 'percent'], ['epsRevision90D', 'EPS revision — 90d', 'percent'],
  ['epsGrowth', 'Trailing EPS growth', 'percent'], ['revenueGrowth', 'Trailing revenue growth', 'percent'],
  ['currentYearRevenueGrowth', 'Current-year revenue growth', 'percent'], ['nextYearRevenueGrowth', 'Next-year revenue growth', 'percent'],
  ['ebitdaGrowth', 'EBITDA growth', 'percent'], ['fcfGrowth', 'FCF growth', 'percent'],
  ['longTermEpsGrowth', 'Long-term EPS growth', 'percent'], ['earningsSurpriseAvg', 'Average earnings surprise', 'percent'],
  ['earningsBeatRate', 'Four-quarter beat rate', 'percent'], ['analystTargetUpside', 'Consensus target upside', 'percent'],
  ['priceEstimate1M', 'One-month price estimate', 'money'], ['priceEstimate3M', 'Three-month price estimate', 'money'],
  ['priceEstimate1Y', 'One-year mean target', 'money'], ['analystTargetHigh', 'High case (highest target)', 'money'],
  ['worstCasePrice', 'Worst case (lowest target)', 'money'],
  ['analystCount', 'Analysts', 'number'], ['roic', 'ROIC', 'percent'],
  ['roe', 'ROE', 'percent'], ['roa', 'ROA', 'percent'], ['grossMargin', 'Gross margin', 'percent'],
  ['operatingMargin', 'Operating margin', 'percent'], ['fcfMargin', 'FCF margin', 'percent'],
  ['debtToEquity', 'Debt/equity', 'multiple'],
  ['netDebtEbitda', 'Net debt/EBITDA', 'multiple'], ['interestCoverage', 'Interest coverage', 'multiple'],
  ['currentRatio', 'Current ratio', 'multiple'], ['cash', 'Cash', 'money'],
  ['fundamentalDataCoverage', 'Data coverage', 'percent'],
] as const;

const numberValue = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const formatMoney = (value: unknown, currency = '') => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  if (Math.abs(amount) >= 1_000_000_000) return `${currency} ${(amount / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(amount) >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(2)}M`;
  return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim();
};

const formatMetric = (value: unknown, kind: string, currency = '') => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (kind === 'money') return formatMoney(number, currency);
  if (kind === 'percent') return `${number.toFixed(1)}%`;
  if (kind === 'number') return number.toFixed(2);
  return `${number.toFixed(1)}x`;
};

const formatFlag = (value: string) => value
  .replace(/^portfolio_/, '')
  .replaceAll('_', ' ')
  .replace(':', ' — ')
  .replace(/^./, (character) => character.toUpperCase());

const scoreLevel = (score: number, english: boolean) => {
  if (score >= 80) return english ? 'Exceptional' : '突出';
  if (score >= 65) return english ? 'Strong' : '较强';
  if (score >= 50) return english ? 'Balanced' : '均衡';
  return english ? 'Weak' : '较弱';
};

const StockScreeningDetailPage: React.FC = () => {
  const { runId = '', code = '' } = useParams();
  const { language } = useUiLanguage();
  const english = language === 'en';
  const [run, setRun] = useState<ScreeningRunDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    screeningApi.getRun(runId)
      .then((result) => {
        if (active) {
          setError('');
          setRun(result);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, [runId]);

  const candidate = useMemo(() => run?.result.candidates.find(
    (item) => item.code.toUpperCase() === code.toUpperCase(),
  ) || null, [code, run]);

  if (!run && !error) {
    return <AppPage><Loading label={english ? 'Loading screening evidence' : '正在加载筛选依据'} /></AppPage>;
  }

  if (error || !run || !candidate) {
    return (
      <AppPage className="max-w-4xl py-8">
        <InlineAlert
          variant="danger"
          title={english ? 'Stock detail unavailable' : '股票详情不可用'}
          message={error || (english ? 'This stock is not part of the selected screening run.' : '该股票不在所选筛选记录中。')}
          action={<Link className="font-semibold underline" to="/">{english ? 'Back home' : '返回首页'}</Link>}
        />
      </AppPage>
    );
  }

  const score = numberValue(candidate.score ?? candidate.screenScore);
  const screenScore = numberValue(candidate.screenScore ?? candidate.score);
  const adjustment = score - screenScore;
  const change = numberValue(candidate.changePct);
  const factorDefinitions = run.strategy === 'institutional_value' ? VALUE_FACTORS : CORE_FACTORS;
  const factors = factorDefinitions.map((factor) => ({
    ...factor,
    score: numberValue(candidate.factorScores?.[factor.key]),
    contribution: numberValue(candidate.factorScores?.[factor.key]) * factor.weight,
  }));
  const strengths = [...factors].sort((left, right) => right.score - left.score).slice(0, 2);
  const risks = [...(candidate.riskFlags || []), ...(candidate.llmRisks || [])];
  const evidence = [...(candidate.dsaNews || []), ...(candidate.dsaEvents || [])].slice(0, 5);
  const passedCount = run.result.afterFilterCount ?? run.afterFilterCount ?? 0;

  return (
    <AppPage className="max-w-6xl pb-12 pt-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
        <Link className="inline-flex items-center gap-2 text-xs font-semibold text-secondary-text transition-colors hover:text-foreground" to="/">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {english ? 'Back to top stocks' : '返回优选股票'}
        </Link>

        <header className="mt-5 grid gap-6 border-b border-border/80 pb-7 md:grid-cols-[minmax(0,1fr)_12rem] md:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              <span>#{candidate.rank}</span>
              <span aria-hidden="true">·</span>
              <span>{[candidate.exchange, candidate.currency, candidate.assetType?.toUpperCase()].filter(Boolean).join(' · ')}</span>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {candidate.code}
              <span className="mt-1 block text-lg font-normal text-secondary-text sm:inline sm:ml-3 sm:mt-0">{candidate.name}</span>
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-secondary-text">
              {english
                ? `${candidate.code} ranks highly because its strongest measured inputs are ${strengths[0].en.toLowerCase()} (${strengths[0].score.toFixed(0)}) and ${strengths[1].en.toLowerCase()} (${strengths[1].score.toFixed(0)}).`
                : `${candidate.code} 排名靠前，最强的量化因子是${strengths[0].zh}（${strengths[0].score.toFixed(0)}）和${strengths[1].zh}（${strengths[1].score.toFixed(0)}）。`}
            </p>
          </div>
          <div className="border-l-2 border-primary pl-5 md:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-text">{english ? (run.strategy === 'institutional_value' ? 'Preliminary score' : 'Final score') : (run.strategy === 'institutional_value' ? '初步评分' : '最终评分')}</p>
            <p className="mt-1 font-mono text-5xl font-semibold tracking-tighter text-foreground">{score.toFixed(1)}</p>
            <p className="mt-1 text-xs font-semibold text-primary">{scoreLevel(score, english)}</p>
          </div>
        </header>
      </motion.div>

      <section className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,.65fr)]">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08, duration: 0.3 }}>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">{english ? 'How the score was built' : '评分如何构成'}</h2>
          </div>
          <p className="mt-2 text-xs leading-5 text-secondary-text">
            {english ? 'Each factor is scored from 0–100, then multiplied by the active strategy weight.' : '每个因子按 0–100 评分，再乘以当前策略权重。'}
          </p>
          <div className="mt-5 divide-y divide-border/70 border-y border-border/80">
            {factors.map((factor, index) => (
              <div key={factor.key} className="grid gap-3 py-4 sm:grid-cols-[8rem_minmax(0,1fr)_5rem_6rem] sm:items-center">
                <div>
                  <p className="text-sm font-semibold text-foreground">{english ? factor.en : factor.zh}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-text">{english ? factor.enHelp : factor.zhHelp}</p>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-hover" aria-label={`${english ? factor.en : factor.zh} ${factor.score.toFixed(1)}`}>
                  <motion.span
                    className="block h-full rounded-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(2, Math.min(100, factor.score))}%` }}
                    transition={{ delay: 0.12 + index * 0.07, duration: 0.45 }}
                  />
                </div>
                <p className="font-mono text-sm font-semibold text-foreground sm:text-right">{factor.score.toFixed(1)}</p>
                <p className="text-xs text-secondary-text sm:text-right">{Math.round(factor.weight * 100)}% → {factor.contribution.toFixed(1)}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-secondary-text">{english ? 'Weighted screen score' : '加权筛选评分'}</span>
            <strong className="font-mono text-foreground">{screenScore.toFixed(1)}</strong>
          </div>
          {Math.abs(adjustment) >= 0.05 ? (
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-secondary-text">{english ? 'Risk / diversification adjustment' : '风险 / 分散度调整'}</span>
              <strong className={adjustment < 0 ? 'font-mono text-danger' : 'font-mono text-success'}>{adjustment > 0 ? '+' : ''}{adjustment.toFixed(1)}</strong>
            </div>
          ) : null}
        </motion.div>

        <aside className="space-y-7 border-t border-border/80 pt-7 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">{english ? 'Why it ranks here' : '为何排名靠前'}</h2>
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-5 text-secondary-text">
              <li><strong className="text-foreground">#{candidate.rank}</strong> {english ? `among ${Number(passedCount).toLocaleString()} listings that passed the hard filters.` : `，在 ${Number(passedCount).toLocaleString()} 个通过硬筛选的标的中。`}</li>
              <li>{english ? `${run.strategy === 'institutional_value' ? 'Estimated 30-day average' : 'Daily'} trading value is ${formatMoney(candidate.amount, candidate.currency)}, above the strategy's ${candidate.currency} 5M minimum.` : `估算成交额为 ${formatMoney(candidate.amount, candidate.currency)}，高于策略 500 万门槛。`}</li>
              <li>{run.strategy === 'institutional_value'
                ? (english ? `Market capitalization is ${formatMoney(candidate.screeningMetrics?.totalMv, candidate.currency)}, above the ${candidate.currency} 2B eligibility floor.` : `市值为 ${formatMoney(candidate.screeningMetrics?.totalMv, candidate.currency)}，高于 20 亿门槛。`)
                : (english ? `The latest move is ${change >= 0 ? '+' : ''}${change.toFixed(2)}%, within the strategy's ±15% risk guardrail.` : `最新涨跌为 ${change >= 0 ? '+' : ''}${change.toFixed(2)}%，处于策略 ±15% 风控区间内。`)}</li>
            </ul>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">{english ? 'Risk checks' : '风险检查'}</h2>
            </div>
            {risks.length ? (
              <ul className="mt-3 space-y-2 text-sm text-secondary-text">
                {risks.map((risk) => <li key={risk}>• {formatFlag(risk)}</li>)}
              </ul>
            ) : (
              <p className="mt-3 text-sm leading-5 text-secondary-text">{english ? 'No automatic risk penalty was applied in this run.' : '本次运行未应用自动风险扣分。'}</p>
            )}
          </div>

          <dl className="divide-y divide-border/70 border-y border-border/80 text-xs">
            <div className="flex justify-between gap-4 py-3"><dt className="text-secondary-text">{english ? 'Price' : '价格'}</dt><dd className="font-mono font-semibold text-foreground">{candidate.currency} {numberValue(candidate.price).toFixed(2)}</dd></div>
            <div className="flex justify-between gap-4 py-3"><dt className="text-secondary-text">{english ? 'Risk level' : '风险等级'}</dt><dd className="font-semibold capitalize text-foreground">{candidate.riskLevel || (english ? 'Pending' : '待确认')}</dd></div>
            <div className="flex justify-between gap-4 py-3"><dt className="text-secondary-text">Wealthsimple</dt><dd className="font-semibold capitalize text-foreground">{candidate.wealthsimpleStatus || 'likely'}</dd></div>
          </dl>
        </aside>
      </section>

      {run.strategy === 'institutional_value' ? (
        <section className="border-t border-border/80 py-8">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">{english ? 'Fundamental evidence' : '基本面依据'}</h2>
          </div>
          <p className="mt-2 text-xs leading-5 text-secondary-text">
            {english ? 'A dash means the broad-market provider did not supply that field; missing values receive a neutral score.' : '破折号表示市场数据源未提供该字段；缺失值按中性计分。'}
          </p>
          <dl className="mt-5 grid border-l border-t border-border/70 sm:grid-cols-3 lg:grid-cols-5">
            {FUNDAMENTAL_METRICS.map(([key, label, kind]) => (
              <div key={key} className="border-b border-r border-border/70 p-4">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">{label}</dt>
                <dd className="mt-2 font-mono text-sm font-semibold text-foreground">{formatMetric(candidate.screeningMetrics?.[key], kind, candidate.currency)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="border-t border-border/80 pt-7">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">{english ? 'Supporting evidence' : '补充依据'}</h2>
        </div>
        {candidate.dsaAnalysisSummary ? <p className="mt-3 max-w-4xl text-sm leading-6 text-secondary-text">{formatEnrichmentSummary(candidate.dsaAnalysisSummary, english)}</p> : null}
        {evidence.length ? (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {evidence.map((item, index) => (
              <li key={`${item.url || item.title}-${index}`} className="border-l border-border pl-4">
                {item.url ? <a className="text-sm font-semibold text-foreground hover:text-primary" href={item.url} target="_blank" rel="noreferrer">{item.title || item.snippet}</a> : <p className="text-sm font-semibold text-foreground">{item.title || item.snippet}</p>}
                <p className="mt-1 text-xs text-muted-text">{[item.source, item.publishedDate].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-secondary-text">{english ? 'No supplemental news or event evidence was available. This rank comes from the market factors shown above.' : '暂无补充新闻或事件依据；该排名来自上方量化因子。'}</p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-sm" to="/screening">
            {english ? 'Open full screener' : '打开完整筛选'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link className="inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm font-semibold text-secondary-text transition-colors hover:bg-hover hover:text-foreground" to="/stocks">
            {english ? 'Browse all stocks' : '浏览全部股票'}
          </Link>
        </div>
        <p className="mt-5 text-[11px] leading-5 text-muted-text">
          {english ? 'Scores are relative screening signals, not expected returns or investment advice. Confirm availability and current pricing in Wealthsimple before trading.' : '评分是相对筛选信号，不代表预期收益或投资建议。交易前请在 Wealthsimple 中确认可用性与当前价格。'}
        </p>
      </section>
    </AppPage>
  );
};

export default StockScreeningDetailPage;
