import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import StockUniversePage from '../StockUniversePage';

const { getCatalogue, getHistory, getRun } = vi.hoisted(() => ({
  getCatalogue: vi.fn(),
  getHistory: vi.fn(),
  getRun: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/stocks', () => ({ stocksApi: { getCatalogue } }));
vi.mock('../../api/screening', () => ({ screeningApi: { getHistory, getRun } }));
vi.mock('../../api/systemConfig', () => ({
  systemConfigApi: { addToWatchlist: vi.fn() },
}));

beforeEach(() => {
  localStorage.setItem('dsa.uiLanguage', 'en');
  getHistory.mockImplementation(({ market }: { market: string }) => Promise.resolve({ runs: [{ runId: `${market}-run` }] }));
  getRun.mockImplementation((runId: string) => Promise.resolve({
    runId,
    market: runId === 'ca-run' ? 'ca' : 'us',
    result: {
      candidates: runId === 'ca-run' ? [
        {
          rank: 1, code: 'CTS.TO', name: 'Converge Technology', currency: 'CAD', price: 10, score: 75,
          screeningMetrics: { priceEstimate1M: 10.8, priceEstimate3M: 12.5, priceEstimate1Y: 20, analystTargetHigh: 24, worstCasePrice: 8 },
        },
      ] : [
        {
          rank: 1, code: 'AAA', name: 'Alpha Inc.', currency: 'USD', price: 100, score: 80,
          screeningMetrics: { priceEstimate1M: 102, priceEstimate3M: 106, priceEstimate1Y: 120, analystTargetHigh: 140, worstCasePrice: 75 },
        },
        {
          rank: 2, code: 'BBB', name: 'Beta Inc.', currency: 'USD', price: 100, score: 70,
          screeningMetrics: { priceEstimate1M: 104, priceEstimate3M: 112, priceEstimate1Y: 150, analystTargetHigh: 180, worstCasePrice: 60 },
        },
      ],
    },
  }));
  getCatalogue.mockResolvedValue({
    items: [
      {
        symbol: 'SHOP.TO',
        displaySymbol: 'SHOP',
        name: 'Shopify Inc.',
        market: 'ca',
        exchange: 'TSX',
        currency: 'CAD',
        assetType: 'stock',
        wealthsimpleStatus: 'likely',
        price: 220.5,
        changePct: 1.25,
        volume: 1_200_000,
        quoteAsOf: '2026-09-02T20:00:00Z',
        source: 'TMX',
      },
    ],
    total: 15_234,
    page: 1,
    pageSize: 25,
    totalPages: 610,
    refreshedAt: '2026-09-02T20:00:00Z',
    stale: false,
    sourceErrors: [],
    sources: ['Nasdaq Trader', 'TMX TSX/TSXV', 'Yahoo Finance quotes'],
    eligibilityNote: 'Confirm current order eligibility in Wealthsimple before trading.',
  });
});

it('shows North American listings and their quote data', async () => {
  render(<UiLanguageProvider><StockUniversePage /></UiLanguageProvider>);

  expect(await screen.findByText('SHOP.TO')).toBeInTheDocument();
  expect(screen.getByText('Shopify Inc.')).toBeInTheDocument();
  expect(screen.getByText('$220.50')).toBeInTheDocument();
  expect(screen.getByText('+1.25%')).toBeInTheDocument();
  expect(screen.queryByText(/China|A-share/i)).not.toBeInTheDocument();
});

it('sorts every target-covered stock by the selected upside column', async () => {
  render(<UiLanguageProvider><StockUniversePage /></UiLanguageProvider>);

  const table = await screen.findByRole('table', { name: 'Target upside rankings table' });
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('CTS.TO');
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Canada');
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('+100.0%');

  fireEvent.click(screen.getByRole('button', { name: 'Sort by 1Y upside' }));

  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('AAA');
});
