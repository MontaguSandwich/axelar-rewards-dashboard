import axios from 'axios';

const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3/simple/price';

interface PriceResponse {
  axelar: {
    usd: number;
  };
}

let cachedPrice: number | null = null;
let lastFetchTime: number = 0;
const CACHE_DURATION_MS = 60000; // 1 minute cache

export async function fetchAxlPrice(): Promise<number> {
  const now = Date.now();

  if (cachedPrice !== null && now - lastFetchTime < CACHE_DURATION_MS) {
    return cachedPrice;
  }

  try {
    const response = await axios.get<PriceResponse>(COINGECKO_API_URL, {
      params: {
        ids: 'axelar',
        vs_currencies: 'usd',
      },
    });

    cachedPrice = response.data.axelar.usd;
    lastFetchTime = now;
    return cachedPrice;
  } catch (error) {
    console.error('Failed to fetch AXL price:', error);
    // Return cached price if available, otherwise default
    return cachedPrice ?? 0.5;
  }
}

export function clearPriceCache(): void {
  cachedPrice = null;
  lastFetchTime = 0;
}
