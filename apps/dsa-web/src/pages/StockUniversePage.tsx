import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Check,
  CircleAlert,
  Database,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { screeningApi, type ScreeningCandidate, type ScreeningRunDetail } from '../api/screening';
import { stocksApi, type StockCatalogueItem, type StockCatalogueResponse } from '../api/stocks';
import { systemConfigApi } from '../api/systemConfig';
import { toApiErrorMessage } from '../api/error';
import { AppPage, Button, Pagination, Select } from '../components/common';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import { formatScreeningPrice, formatTargetUpside, getScreeningPriceOutlook } from '../utils/screeningText';

type TargetSortKey = 'score' | 'oneMonth' | 'threeMonths' | 'oneYear' | 'highCase' | 'worstCase';
type TargetSort = { key: TargetSortKey; direction: 'asc' | 'desc' };
type TargetCandidateRow = { candidate: ScreeningCandidate; runId: string; market: string };

const formatNumber = (value?: number | null) => (
  value == null ? '—' : new Intl.NumberFormat('en-CA', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
);

const formatPrice = (item: StockCatalogueItem) => (
  item.price == null
    ? '—'
    : new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: item.currency,
        minimumFractionDigits: 2,
      }).format(item.price)
);

const formatUpdatedAt = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const targetSortValue = (candidate: ScreeningCandidate, key: TargetSortKey): number | null => {
  if (key === 'score') {
    const score = Number(candidate.score ?? candidate.screenScore);
    return Number.isFinite(score) ? score : null;
  }
  const outlook = getScreeningPriceOutlook(candidate);
  const target = outlook[key];
  return outlook.current !== null && target !== null ? (target / outlook.current - 1) * 100 : null;
};

const TargetReturn: React.FC<{ candidate: ScreeningCandidate; horizon: Exclude<TargetSortKey, 'score'>; downside?: boolean }> = ({
  candidate,
  horizon,
  downside = false,
}) => {
  const outlook = getScreeningPriceOutlook(candidate);
  const value = outlook[horizon];
  const upside = formatTargetUpside(value, outlook.current);
  const positive = value !== null && outlook.current !== null && value >= outlook.current;
  const tone = value === null ? 'text-muted-text' : downside || !positive ? 'text-danger' : 'text-success';
  return (
    <td className="px-3 py-3 text-right">
      <span className={`block font-mono text-sm font-semibold ${tone}`}>{upside}</span>
      <span className="mt-0.5 block font-mono text-[10px] text-muted-text">{formatScreeningPrice(value, candidate.currency)}</span>
    </td>
  );
};

const StockUniversePage: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useUiLanguage();
  const english = language === 'en';
  const requestIdRef = useRef(0);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [market, setMarket] = useState<'all' | 'ca' | 'us'>('all');
  const [assetType, setAssetType] = useState<'all' | 'stock' | 'etf'>('all');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<StockCatalogueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addingSymbol, setAddingSymbol] = useState('');
  const [addedSymbols, setAddedSymbols] = useState<Set<string>>(new Set());
  const [targetRuns, setTargetRuns] = useState<ScreeningRunDetail[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [targetError, setTargetError] = useState('');
  const [targetSort, setTargetSort] = useState<TargetSort>({ key: 'oneYear', direction: 'desc' });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadCatalogue = useCallback(async (refresh = false) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const next = await stocksApi.getCatalogue({
        query: debouncedQuery,
        market,
        assetType,
        page,
        pageSize: 25,
        refresh,
      });
      if (requestId === requestIdRef.current) {
        setResult(next);
        if (next.page !== page) setPage(next.page);
      }
    } catch (caught) {
      if (requestId === requestIdRef.current) {
        setError(toApiErrorMessage(caught, english ? 'Could not load the stock catalogue.' : '无法加载股票目录。'));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [assetType, debouncedQuery, english, market, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalogue());
    return () => window.clearTimeout(timer);
  }, [loadCatalogue]);

  useEffect(() => {
    let active = true;
    const latestRun = (market: 'us' | 'ca') => screeningApi.getHistory({ limit: 1, market, strategy: 'institutional_value' })
      .then((history) => history.runs[0] ? screeningApi.getRun(history.runs[0].runId) : null);
    Promise.allSettled([latestRun('us'), latestRun('ca')])
      .then((results) => {
        if (!active) return;
        const runs = results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
        setTargetRuns(runs);
        if (runs.length === 0) setTargetError('Target estimates are temporarily unavailable.');
      })
      .finally(() => {
        if (active) setTargetsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const analyze = (item: StockCatalogueItem) => {
    navigate('/', {
      state: {
        stockCode: item.symbol,
        stockName: item.name,
        autoAnalyze: true,
        selectionSource: 'screening_result',
      },
    });
  };

  const addToWatchlist = async (item: StockCatalogueItem) => {
    setAddingSymbol(item.symbol);
    try {
      await systemConfigApi.addToWatchlist(item.symbol);
      setAddedSymbols((current) => new Set(current).add(item.symbol));
    } catch (caught) {
      setError(toApiErrorMessage(caught, `Could not add ${item.symbol} to the watchlist.`));
    } finally {
      setAddingSymbol('');
    }
  };

  const items = result?.items ?? [];
  const targetCandidates = useMemo(() => {
    const candidates: TargetCandidateRow[] = targetRuns.flatMap((run) => (
      run.result.candidates.map((candidate) => ({ candidate, runId: run.runId, market: run.market }))
    ));
    return candidates.sort((left, right) => {
      const leftValue = targetSortValue(left.candidate, targetSort.key);
      const rightValue = targetSortValue(right.candidate, targetSort.key);
      if (leftValue === null) return rightValue === null ? left.candidate.rank - right.candidate.rank : 1;
      if (rightValue === null) return -1;
      const difference = targetSort.direction === 'desc' ? rightValue - leftValue : leftValue - rightValue;
      return difference || left.candidate.rank - right.candidate.rank;
    });
  }, [targetRuns, targetSort]);

  const changeTargetSort = (key: TargetSortKey) => {
    setTargetSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const sortHeader = (key: TargetSortKey, label: string) => {
    const active = targetSort.key === key;
    const Icon = active ? (targetSort.direction === 'desc' ? ArrowDown : ArrowUp) : ArrowUpDown;
    return (
      <button
        type="button"
        onClick={() => changeTargetSort(key)}
        aria-label={`Sort by ${label}`}
        className={`ml-auto inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground ${active ? 'text-cyan' : ''}`}
      >
        {label}
        <Icon className="h-3 w-3" aria-hidden="true" />
      </button>
    );
  };

  return (
    <AppPage className="max-w-[1500px] pb-14 pt-6">
      <header className="border-b border-border/70 pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-cyan">
              {english ? 'Wealthsimple universe' : 'Wealthsimple 股票池'}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {english ? 'Stocks you can research' : '可研究股票'}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-secondary-text">
              {english
                ? 'Browse active Canadian and U.S. stocks and ETFs from major Wealthsimple-supported exchange families, with current quote data when available.'
                : '浏览 Wealthsimple 主要支持交易所中的加拿大和美国股票与 ETF，并查看可用的最新行情。'}
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-secondary-text">
            <Database className="h-4 w-4 text-cyan" aria-hidden="true" />
            <span>
              <strong className="font-mono text-xl font-semibold text-foreground">{formatNumber(result?.total)}</strong>
              {' '}{english ? 'matching listings' : '个匹配标的'}
            </span>
          </div>
        </div>
      </header>

      <section className="border-b border-border/70 py-6" aria-labelledby="target-upside-heading">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan">Latest value screen</p>
            <h2 id="target-upside-heading" className="mt-1 text-xl font-semibold tracking-tight text-foreground">Target upside rankings</h2>
            <p className="mt-1 text-xs text-secondary-text">Click any score or target column to sort every stock with current analyst coverage.</p>
          </div>
          {targetRuns.length ? <p className="text-[11px] text-muted-text">{targetCandidates.length} screened stocks · U.S. + Canada</p> : null}
        </div>

        {targetsLoading ? (
          <div className="h-28 animate-pulse rounded-lg bg-surface" aria-label="Loading target upside rankings" />
        ) : targetError ? (
          <p className="border-l-2 border-warning px-3 py-2 text-xs text-warning">{targetError}</p>
        ) : targetCandidates.length > 0 ? (
          <div className="overflow-x-auto border-y border-border/70">
            <table aria-label="Target upside rankings table" className="w-full min-w-[1060px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border/70 text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-text">
                  <th className="px-3 py-3">Company</th>
                  <th className="px-3 py-3 text-right" aria-sort={targetSort.key === 'score' ? (targetSort.direction === 'desc' ? 'descending' : 'ascending') : 'none'}>{sortHeader('score', 'Score')}</th>
                  <th className="px-3 py-3 text-right">Current</th>
                  {([
                    ['oneMonth', '1M upside'],
                    ['threeMonths', '3M upside'],
                    ['oneYear', '1Y upside'],
                    ['highCase', 'High upside'],
                    ['worstCase', 'Worst case'],
                  ] as const).map(([key, label]) => (
                    <th key={key} className="px-3 py-3 text-right" aria-sort={targetSort.key === key ? (targetSort.direction === 'desc' ? 'descending' : 'ascending') : 'none'}>
                      {sortHeader(key, label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {targetCandidates.map(({ candidate, runId, market: candidateMarket }) => {
                  const outlook = getScreeningPriceOutlook(candidate);
                  const score = Number(candidate.score ?? candidate.screenScore ?? 0);
                  return (
                    <tr key={`${runId}:${candidate.code}`} className="group border-b border-border/55 last:border-b-0 hover:bg-cyan/[0.035]">
                      <td className="px-3 py-3">
                        <button type="button" className="max-w-xs text-left" onClick={() => navigate(`/screening/${runId}/stocks/${candidate.code}`)}>
                          <span className="font-mono text-sm font-semibold text-cyan">{candidate.code}</span>
                          <span className="ml-2 rounded border border-border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-muted-text">{candidateMarket === 'ca' ? 'Canada' : 'U.S.'}</span>
                          <span className="ml-2 text-xs text-secondary-text">{candidate.name}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-semibold text-foreground">{score.toFixed(1)}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-semibold text-foreground">{formatScreeningPrice(outlook.current, candidate.currency)}</td>
                      <TargetReturn candidate={candidate} horizon="oneMonth" />
                      <TargetReturn candidate={candidate} horizon="threeMonths" />
                      <TargetReturn candidate={candidate} horizon="oneYear" />
                      <TargetReturn candidate={candidate} horizon="highCase" />
                      <TargetReturn candidate={candidate} horizon="worstCase" downside />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-5 text-xs text-muted-text">Run the Institutional Value screen to populate analyst targets.</p>
        )}
        <p className="mt-3 text-[10px] leading-4 text-muted-text">One- and three-month values interpolate toward the mean 12-month target. High and worst cases use the highest and lowest current analyst targets. Missing coverage sorts last.</p>
      </section>

      <section className="border-b border-border/70 py-5" aria-label={english ? 'Catalogue filters' : '目录筛选'}>
        <div className="grid gap-3 md:grid-cols-[minmax(16rem,1fr)_12rem_12rem_auto]">
          <label className="relative block">
            <span className="sr-only">{english ? 'Search by ticker or company' : '按代码或公司搜索'}</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-text" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder={english ? 'Search ticker or company' : '搜索代码或公司'}
              className="h-11 w-full rounded-xl border border-border bg-surface/65 pl-10 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-text focus:border-cyan"
            />
          </label>
          <Select
            value={market}
            onChange={(value) => {
              setMarket(value as typeof market);
              setPage(1);
            }}
            options={[
              { value: 'all', label: english ? 'Canada + U.S.' : '加拿大 + 美国' },
              { value: 'ca', label: english ? 'Canada' : '加拿大' },
              { value: 'us', label: english ? 'United States' : '美国' },
            ]}
          />
          <Select
            value={assetType}
            onChange={(value) => {
              setAssetType(value as typeof assetType);
              setPage(1);
            }}
            options={[
              { value: 'all', label: english ? 'Stocks + ETFs' : '股票 + ETF' },
              { value: 'stock', label: english ? 'Stocks' : '股票' },
              { value: 'etf', label: 'ETFs' },
            ]}
          />
          <Button
            variant="secondary"
            className="h-11"
            isLoading={loading}
            loadingText={english ? 'Refreshing' : '刷新中'}
            onClick={() => void loadCatalogue(true)}
          >
            <RefreshCw className="h-4 w-4" />
            {english ? 'Refresh data' : '刷新数据'}
          </Button>
        </div>
      </section>

      {error ? (
        <div className="my-5 flex items-start gap-3 border-l-2 border-danger bg-danger/5 px-4 py-3 text-sm text-danger">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <section aria-label={english ? 'Stock catalogue' : '股票目录'}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-text">
                <th className="px-3 py-3">{english ? 'Company' : '公司'}</th>
                <th className="px-3 py-3">{english ? 'Listing' : '上市信息'}</th>
                <th className="px-3 py-3 text-right">{english ? 'Price' : '价格'}</th>
                <th className="px-3 py-3 text-right">{english ? 'Day' : '当日'}</th>
                <th className="px-3 py-3 text-right">{english ? 'Volume' : '成交量'}</th>
                <th className="px-3 py-3">{english ? 'Availability' : '可用性'}</th>
                <th className="px-3 py-3 text-right">{english ? 'Actions' : '操作'}</th>
              </tr>
            </thead>
            <tbody>
              {loading && !result
                ? Array.from({ length: 8 }, (_, index) => (
                    <tr key={index} className="border-b border-border/50">
                      <td colSpan={7} className="px-3 py-4">
                        <div className="h-8 animate-pulse rounded bg-surface" />
                      </td>
                    </tr>
                  ))
                : items.map((item) => {
                    const change = item.changePct;
                    const added = addedSymbols.has(item.symbol);
                    return (
                      <tr
                        key={item.symbol}
                        className="group border-b border-border/55 transition-colors hover:bg-cyan/[0.035]"
                      >
                        <td className="px-3 py-4">
                          <button type="button" className="text-left" onClick={() => analyze(item)}>
                            <span className="block font-mono text-sm font-semibold text-cyan">{item.symbol}</span>
                            <span className="mt-1 block max-w-sm truncate text-sm text-foreground">{item.name}</span>
                          </button>
                        </td>
                        <td className="px-3 py-4">
                          <span className="block text-sm text-foreground">{item.exchange}</span>
                          <span className="mt-1 block text-xs uppercase text-muted-text">
                            {item.market === 'ca' ? (english ? 'Canada' : '加拿大') : (english ? 'United States' : '美国')} · {item.assetType.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-4 text-right font-mono text-sm font-semibold text-foreground">
                          {formatPrice(item)}
                        </td>
                        <td className={`px-3 py-4 text-right font-mono text-sm font-semibold ${
                          change == null ? 'text-muted-text' : change >= 0 ? 'text-success' : 'text-danger'
                        }`}>
                          {change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
                        </td>
                        <td className="px-3 py-4 text-right font-mono text-sm text-secondary-text">
                          {formatNumber(item.volume)}
                        </td>
                        <td className="px-3 py-4">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary-text">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" />
                            {english ? 'Likely eligible' : '可能可交易'}
                          </span>
                          <span className="mt-1 block text-[11px] text-muted-text">
                            {item.price == null ? (english ? 'Quote unavailable' : '暂无行情') : `${item.currency} · ${formatUpdatedAt(item.quoteAsOf)}`}
                          </span>
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex justify-end gap-1 opacity-80 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`${english ? 'Add' : '添加'} ${item.symbol}`}
                              disabled={added}
                              isLoading={addingSymbol === item.symbol}
                              onClick={() => void addToWatchlist(item)}
                            >
                              {added ? <Check className="h-4 w-4 text-success" /> : <Plus className="h-4 w-4" />}
                              {added ? (english ? 'Added' : '已添加') : (english ? 'Watchlist' : '自选')}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => analyze(item)}>
                              {english ? 'Analyze' : '分析'}
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>

        {!loading && items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-base font-semibold text-foreground">{english ? 'No matching listings' : '没有匹配标的'}</p>
            <p className="mt-2 text-sm text-secondary-text">{english ? 'Try a ticker, company name, or broader filter.' : '请尝试股票代码、公司名称或更宽泛的筛选。'}</p>
          </div>
        ) : null}

        {result ? (
          <Pagination
            className="mt-6"
            currentPage={result.page}
            totalPages={result.totalPages}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      <footer className="mt-8 grid gap-4 border-t border-border/70 pt-5 text-xs leading-5 text-muted-text lg:grid-cols-[1fr_auto]">
        <div>
          <p>{result?.eligibilityNote || (english
            ? 'Eligibility is estimated from supported exchanges and security types.'
            : '可用性根据支持的交易所和证券类型估算。')}</p>
          <p className="mt-1">
            {english ? 'Directory sources: ' : '目录来源：'}{result?.sources.join(' · ') || 'Nasdaq Trader · TMX'}
            {result?.stale ? ` · ${english ? 'cached data' : '缓存数据'}` : ''}
          </p>
          {result?.sourceErrors.length ? (
            <p className="mt-1 text-warning">{english ? 'Some quote or directory data is temporarily unavailable.' : '部分行情或目录数据暂不可用。'}</p>
          ) : null}
        </div>
        <a
          className="inline-flex items-center gap-1.5 font-medium text-cyan hover:text-foreground"
          href="https://help.wealthsimple.com/hc/en-ca/articles/360056580834-Why-can-t-I-find-the-particular-stock-or-ETF-I-m-looking-for-"
          target="_blank"
          rel="noreferrer"
        >
          {english ? 'Wealthsimple eligibility rules' : 'Wealthsimple 资格规则'}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </footer>
    </AppPage>
  );
};

export default StockUniversePage;
