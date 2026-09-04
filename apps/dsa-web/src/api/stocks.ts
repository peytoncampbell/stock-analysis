import apiClient from './index';
import { toCamelCase } from './utils';

export type ExtractItem = {
  code?: string | null;
  name?: string | null;
  confidence: string;
};

export type ExtractFromImageResponse = {
  codes: string[];
  items?: ExtractItem[];
  rawText?: string;
};

export type StockCatalogueItem = {
  symbol: string;
  displaySymbol: string;
  name: string;
  market: 'ca' | 'us';
  exchange: string;
  currency: 'CAD' | 'USD';
  assetType: 'stock' | 'etf';
  wealthsimpleStatus: 'likely';
  price?: number | null;
  changePct?: number | null;
  volume?: number | null;
  quoteAsOf?: string | null;
  source: string;
};

export type StockCatalogueResponse = {
  items: StockCatalogueItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  refreshedAt: string;
  stale: boolean;
  sourceErrors: string[];
  sources: string[];
  eligibilityNote: string;
};

export const stocksApi = {
  async getCatalogue(payload: {
    query?: string;
    market?: 'all' | 'ca' | 'us';
    assetType?: 'all' | 'stock' | 'etf';
    page?: number;
    pageSize?: number;
    refresh?: boolean;
  } = {}): Promise<StockCatalogueResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/stocks/catalogue', {
      params: {
        query: payload.query || undefined,
        market: payload.market || 'all',
        asset_type: payload.assetType || 'all',
        page: payload.page || 1,
        page_size: payload.pageSize || 25,
        refresh: payload.refresh || false,
      },
      timeout: 120000,
    });
    return toCamelCase<StockCatalogueResponse>(response.data);
  },

  async extractFromImage(file: File): Promise<ExtractFromImageResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: { [key: string]: string | undefined } = { 'Content-Type': undefined };
    const response = await apiClient.post(
      '/api/v1/stocks/extract-from-image',
      formData,
      {
        headers,
        timeout: 60000, // Vision API can be slow; 60s
      },
    );

    const data = response.data as { codes?: string[]; items?: ExtractItem[]; raw_text?: string };
    return {
      codes: data.codes ?? [],
      items: data.items,
      rawText: data.raw_text,
    };
  },

  async parseImport(file?: File, text?: string): Promise<ExtractFromImageResponse> {
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      const headers: { [key: string]: string | undefined } = { 'Content-Type': undefined };
      const response = await apiClient.post('/api/v1/stocks/parse-import', formData, { headers });
      const data = response.data as { codes?: string[]; items?: ExtractItem[] };
      return { codes: data.codes ?? [], items: data.items };
    }
    if (text) {
      const response = await apiClient.post('/api/v1/stocks/parse-import', { text });
      const data = response.data as { codes?: string[]; items?: ExtractItem[] };
      return { codes: data.codes ?? [], items: data.items };
    }
    throw new Error('请提供文件或粘贴文本');
  },
};
