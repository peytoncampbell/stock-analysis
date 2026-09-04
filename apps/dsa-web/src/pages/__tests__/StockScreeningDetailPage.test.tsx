import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { screeningApi, type ScreeningRunDetail } from '../../api/screening';
import { HomeOpportunityDashboard } from '../../components/dashboard/HomeOpportunityDashboard';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import StockScreeningDetailPage from '../StockScreeningDetailPage';

vi.mock('../../api/screening', () => ({ screeningApi: { getRun: vi.fn() } }));

const run: ScreeningRunDetail = {
  enabled: true,
  runId: 'run-1',
  strategy: 'wealthsimple_core',
  market: 'wealthsimple',
  candidateCount: 1,
  snapshotCount: 15_234,
  afterFilterCount: 4_511,
  createdAt: '2026-09-02T21:34:38Z',
  result: {
    enabled: true,
    candidateCount: 1,
    afterFilterCount: 4_511,
    llmRanked: false,
    candidates: [{
      rank: 1,
      code: 'WFC',
      name: 'Wells Fargo & Company',
      exchange: 'NYSE',
      currency: 'USD',
      assetType: 'stock',
      wealthsimpleStatus: 'likely',
      score: 72.38,
      screenScore: 72.38,
      reason: '',
      riskLevel: 'low',
      price: 89.27,
      changePct: 2.56,
      amount: 1_000_000_000,
      factorScores: { momentum: 70, stability: 66, liquidity: 98, activity: 58 },
      screeningMetrics: {
        forwardPe: 9.4, nextYearPe: 8.8, fcfYield: 7.2, epsRevision30D: 3.1, roic: 14.5,
        analystTargetUpside: 23.2, priceEstimate1M: 91, priceEstimate3M: 94, priceEstimate1Y: 110,
        analystTargetHigh: 125, worstCasePrice: 70,
      },
      dsaAnalysisSummary: 'DSA行情：现价 89.27，涨跌幅 2.56%',
      raw: {},
    }],
  },
};

beforeEach(() => {
  localStorage.setItem('dsa.uiLanguage', 'en');
  vi.mocked(screeningApi.getRun).mockResolvedValue(run);
});

it('links a dashboard pick to a run-specific explanation with weighted factors', async () => {
  const { unmount } = render(
    <UiLanguageProvider>
      <MemoryRouter>
        <HomeOpportunityDashboard
          run={run}
          loading={false}
          error=""
          english
          watchlistCount={0}
          analyzedTodayCount={0}
          activeTaskCount={0}
          onRefresh={() => undefined}
          onOpenScreening={() => undefined}
        />
      </MemoryRouter>
    </UiLanguageProvider>,
  );

  expect(screen.getByRole('link', { name: 'View details for WFC' })).toHaveAttribute('href', '/screening/run-1/stocks/WFC');
  expect(screen.getByTestId('leader-metrics')).toHaveTextContent('9.4x');
  expect(screen.getByTestId('leader-metrics')).toHaveTextContent('7.2%');
  expect(screen.getByTestId('leader-price-outlook')).toHaveTextContent('USD 91.00');
  expect(screen.getByTestId('leader-price-outlook')).toHaveTextContent('USD 110.00');
  expect(screen.getByTestId('leader-price-outlook')).toHaveTextContent('USD 125.00');
  expect(screen.getByTestId('leader-price-outlook')).toHaveTextContent('USD 70.00');
  expect(screen.getByTestId('leader-price-outlook')).toHaveTextContent('+23.2%');
  expect(screen.getByTestId('leader-price-outlook')).toHaveTextContent('+40.0%');
  expect(screen.getByTestId('leader-price-outlook')).toHaveTextContent('-21.6%');
  unmount();

  render(
    <UiLanguageProvider>
      <MemoryRouter initialEntries={['/screening/run-1/stocks/WFC']}>
        <Routes><Route path="/screening/:runId/stocks/:code" element={<StockScreeningDetailPage />} /></Routes>
      </MemoryRouter>
    </UiLanguageProvider>,
  );

  expect(await screen.findByRole('heading', { name: /WFC/ })).toBeInTheDocument();
  expect(screen.getByText('How the score was built')).toBeInTheDocument();
  expect(screen.getByText('Momentum')).toBeInTheDocument();
  expect(screen.getByText(/among 4,511 listings/)).toBeInTheDocument();
  expect(screen.getByText('Quote: price 89.27, change 2.56%')).toBeInTheDocument();
});
