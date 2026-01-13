import { useState, useCallback, useEffect } from 'react';
import { ChainTable } from './components/ChainTable';
import { ChainDetail } from './components/ChainDetail';
import { VerifierMonitor } from './components/VerifierMonitor';
import { fetchAllChainRewards } from './api/axelar';
import { fetchAxlPrice, clearPriceCache } from './api/prices';
import { clearConfigCache } from './api/config';
import type { ChainRewardsData, TimePeriod } from './types';

type Tab = 'rewards' | 'monitor';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('rewards');
  const [chains, setChains] = useState<ChainRewardsData[]>([]);
  const [selectedChain, setSelectedChain] = useState<ChainRewardsData | null>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('epoch');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [axlPrice, setAxlPrice] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Clear caches for fresh data
      clearConfigCache();
      clearPriceCache();

      const [chainsData, price] = await Promise.all([
        fetchAllChainRewards(),
        fetchAxlPrice(),
      ]);

      setChains(chainsData);
      setAxlPrice(price);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to load data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-load data on page mount
  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleChainSelect = (chain: ChainRewardsData) => {
    setSelectedChain(chain);
  };

  const handleBack = () => {
    setSelectedChain(null);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-[var(--text-primary)]">
                  Axelar Amplifier Rewards
                </h1>
                <p className="text-sm text-[var(--text-secondary)]">
                  Track verifier rewards across all chains
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* AXL Price */}
              {axlPrice !== null && (
                <div className="text-right">
                  <div className="text-sm text-[var(--text-secondary)]">AXL Price</div>
                  <div className="text-[var(--text-primary)] font-medium">
                    ${axlPrice.toFixed(4)}
                  </div>
                </div>
              )}

              {/* Last Updated */}
              {lastUpdated && activeTab === 'rewards' && (
                <div className="text-right">
                  <div className="text-sm text-[var(--text-secondary)]">Last Updated</div>
                  <div className="text-[var(--text-primary)] text-sm">
                    {lastUpdated.toLocaleTimeString()}
                  </div>
                </div>
              )}

              {/* Refresh Button - only show on rewards tab */}
              {activeTab === 'rewards' && (
                <button
                  onClick={loadData}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white font-medium hover:bg-[var(--accent-blue)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <svg
                    className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  {isLoading ? 'Loading...' : chains.length === 0 ? 'Load Data' : 'Refresh'}
                </button>
              )}
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-1 mt-4 -mb-4">
            <button
              onClick={() => { setActiveTab('rewards'); setSelectedChain(null); }}
              className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
                activeTab === 'rewards'
                  ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] border-t border-l border-r border-[var(--border-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Rewards Prediction
            </button>
            <button
              onClick={() => { setActiveTab('monitor'); setSelectedChain(null); }}
              className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
                activeTab === 'monitor'
                  ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] border-t border-l border-r border-[var(--border-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              My Performance
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'rewards' ? (
          <>
            {error && (
              <div className="mb-6 p-4 rounded-lg bg-[var(--accent-red)]/20 border border-[var(--accent-red)] text-[var(--accent-red)]">
                <div className="font-medium">Error loading data</div>
                <div className="text-sm mt-1">{error}</div>
              </div>
            )}

            {chains.length === 0 && !isLoading && !error ? (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="w-16 h-16 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-[var(--text-secondary)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
                  No Data Loaded
                </h2>
                <p className="text-[var(--text-secondary)] mb-6 text-center max-w-md">
                  Click the "Load Data" button to fetch reward pool information from the
                  Axelar network.
                </p>
                <button
                  onClick={loadData}
                  className="px-6 py-3 rounded-lg bg-[var(--accent-blue)] text-white font-medium hover:bg-[var(--accent-blue)]/90 transition-colors"
                >
                  Load Data
                </button>
              </div>
            ) : selectedChain ? (
              <ChainDetail
                chain={selectedChain}
                timePeriod={timePeriod}
                onBack={handleBack}
              />
            ) : (
              <ChainTable
                chains={chains}
                timePeriod={timePeriod}
                onTimePeriodChange={setTimePeriod}
                onChainSelect={handleChainSelect}
                isLoading={isLoading}
              />
            )}
          </>
        ) : (
          <VerifierMonitor axlPrice={axlPrice} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-color)] bg-[var(--bg-secondary)] mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <p className="text-sm text-[var(--text-secondary)] text-center">
            Data sourced from Axelar Network mainnet. Rewards are estimated based on
            current pool state and verifier count.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
