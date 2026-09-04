import type { ScreeningCandidate } from '../api/screening';

export type ScreeningPriceOutlook = {
  current: number | null;
  oneMonth: number | null;
  threeMonths: number | null;
  oneYear: number | null;
  highCase: number | null;
  worstCase: number | null;
};

export const screeningMetric = (candidate: ScreeningCandidate | undefined, key: string): number | null => {
  const value = Number(candidate?.screeningMetrics?.[key]);
  return Number.isFinite(value) ? value : null;
};

export const getScreeningPriceOutlook = (candidate: ScreeningCandidate | undefined): ScreeningPriceOutlook => {
  const current = candidate?.price != null && Number.isFinite(candidate.price) && candidate.price > 0 ? candidate.price : null;
  const oneYear = screeningMetric(candidate, 'priceEstimate1Y') ?? screeningMetric(candidate, 'analystTargetMean');
  return {
    current,
    oneMonth: screeningMetric(candidate, 'priceEstimate1M') ?? (current !== null && oneYear !== null ? current + (oneYear - current) / 12 : null),
    threeMonths: screeningMetric(candidate, 'priceEstimate3M') ?? (current !== null && oneYear !== null ? current + (oneYear - current) / 4 : null),
    oneYear,
    highCase: screeningMetric(candidate, 'analystTargetHigh'),
    worstCase: screeningMetric(candidate, 'worstCasePrice') ?? screeningMetric(candidate, 'analystTargetLow'),
  };
};

export const formatScreeningPrice = (value: number | null, currency = '', includeCurrency = true): string => {
  if (value === null) return '—';
  return `${includeCurrency && currency ? `${currency} ` : ''}${value.toFixed(2)}`;
};

export const formatTargetUpside = (value: number | null, current: number | null): string => {
  if (value === null || current === null || current <= 0) return '—';
  const upside = (value / current - 1) * 100;
  return `${upside > 0 ? '+' : ''}${upside.toFixed(1)}%`;
};

export const formatEnrichmentSummary = (value: string, english = false) => {
  if (english) {
    const translated = value
      .replace(/DSA行情\s*[:：]\s*/gi, 'Quote: ')
      .replace(/DSA新闻\s*[:：]\s*/gi, 'News: ')
      .replace(/DSA事件\s*[:：]\s*/gi, 'Events: ')
      .replace(/现价/g, 'price')
      .replace(/涨跌幅/g, 'change')
      .replaceAll('，', ', ');
    return translated.replace(/\b(price|change)\s+(-?\d+(?:\.\d+)?)(%?)/gi, (_match, label, number, suffix) => (
      `${label} ${Number(number).toFixed(2)}${suffix}`
    ));
  }
  return value
    .replace(/DSA行情\s*[:：]\s*/gi, '行情：')
    .replace(/DSA新闻\s*[:：]\s*/gi, '新闻：')
    .replace(/DSA事件\s*[:：]\s*/gi, '事件：');
};
