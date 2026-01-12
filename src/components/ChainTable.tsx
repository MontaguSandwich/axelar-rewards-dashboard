import { useState, useEffect } from 'react';
import type { ChainRewardsData, TimePeriod } from '../types';

interface ChainTableProps {
  chains: ChainRewardsData[];
  timePeriod: TimePeriod;
  onTimePeriodChange: (period: TimePeriod) => void;
  onChainSelect: (chain: ChainRewardsData) => void;
  isLoading: boolean;
}

const STORAGE_KEY = 'axelar-node-costs';

function formatNumber(num: number, decimals: number = 2): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(decimals) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(decimals) + 'K';
  }
  return num.toFixed(decimals);
}

function formatUsd(num: number): string {
  return '$' + formatNumber(num, 2);
}

export function ChainTable({
  chains,
  timePeriod,
  onTimePeriodChange,
  onChainSelect,
  isLoading,
}: ChainTableProps) {
  // Node costs state: { chainId: costInUsd }
  const [nodeCosts, setNodeCosts] = useState<Record<string, number>>({});

  // Load node costs from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setNodeCosts(JSON.parse(saved));
      } catch (e) {
        console.warn('Failed to load node costs from localStorage');
      }
    }
  }, []);

  // Save node costs to localStorage when they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodeCosts));
  }, [nodeCosts]);

  const handleCostChange = (chainId: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    setNodeCosts((prev) => ({
      ...prev,
      [chainId]: numValue,
    }));
  };

  const getRewardsForPeriod = (chain: ChainRewardsData) => {
    switch (timePeriod) {
      case 'epoch':
        return {
          axl: chain.totalRewardsPerEpoch,
          usd: chain.totalRewardsPerEpochUsd,
        };
      case 'weekly':
        return {
          axl: chain.totalWeeklyRewards,
          usd: chain.totalWeeklyRewardsUsd,
        };
      case 'monthly':
        return {
          axl: chain.totalMonthlyRewards,
          usd: chain.totalMonthlyRewardsUsd,
        };
    }
  };

  const periodLabels: Record<TimePeriod, string> = {
    epoch: 'Per Epoch',
    weekly: 'Weekly',
    monthly: 'Monthly',
  };

  return (
    <div className="w-full">
      {/* Time Period Toggle */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">
          Amplifier Chain Rewards
        </h2>
        <div className="flex gap-1 p-1 rounded-lg bg-[var(--bg-tertiary)]">
          {(['epoch', 'weekly', 'monthly'] as TimePeriod[]).map((period) => (
            <button
              key={period}
              onClick={() => onTimePeriodChange(period)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                timePeriod === period
                  ? 'bg-[var(--accent-blue)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {periodLabels[period]}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-[var(--border-color)]">
        <table className="w-full">
          <thead>
            <tr className="bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
              <th className="text-left px-6 py-4 text-sm font-medium text-[var(--text-secondary)]">
                Chain
              </th>
              <th className="text-right px-6 py-4 text-sm font-medium text-[var(--text-secondary)]">
                Pool Balance
              </th>
              <th className="text-right px-6 py-4 text-sm font-medium text-[var(--text-secondary)]">
                Rewards/Epoch
              </th>
              <th className="text-right px-6 py-4 text-sm font-medium text-[var(--text-secondary)]">
                Verifiers
              </th>
              <th className="text-right px-6 py-4 text-sm font-medium text-[var(--text-secondary)]">
                Your Rewards ({periodLabels[timePeriod]})
              </th>
              <th className="text-right px-6 py-4 text-sm font-medium text-[var(--text-secondary)]">
                USD Value
              </th>
              <th className="text-right px-6 py-4 text-sm font-medium text-[var(--text-secondary)]">
                Node Cost
              </th>
              <th className="text-right px-6 py-4 text-sm font-medium text-[var(--text-secondary)]">
                Net Profit
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center">
                  <div className="flex items-center justify-center gap-3">
                    <div className="w-5 h-5 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin" />
                    <span className="text-[var(--text-secondary)]">
                      Loading chain data...
                    </span>
                  </div>
                </td>
              </tr>
            ) : chains.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-6 py-12 text-center text-[var(--text-secondary)]"
                >
                  No chains found
                </td>
              </tr>
            ) : (
              chains.map((chain) => {
                const rewards = getRewardsForPeriod(chain);
                const verifierCount =
                  chain.votingPool?.activeVerifiers ??
                  chain.signingPool?.activeVerifiers ??
                  0;
                const nodeCost = nodeCosts[chain.chainId] || 0;
                const netProfit = chain.status === 'active' ? rewards.usd - nodeCost : 0;

                return (
                  <tr
                    key={chain.chainId}
                    className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <td
                      className="px-6 py-4 cursor-pointer"
                      onClick={() => onChainSelect(chain)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm font-medium">
                          {chain.chainName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-[var(--text-primary)]">
                            {chain.chainName}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {chain.status === 'active' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--accent-green)]/20 text-[var(--accent-green)]">
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--text-secondary)]/20 text-[var(--text-secondary)]">
                                Inactive
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="text-[var(--text-primary)]">
                        {formatNumber(chain.totalPoolBalance)} AXL
                      </div>
                      <div className="text-sm text-[var(--text-secondary)]">
                        {formatUsd(chain.totalPoolBalanceUsd)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {chain.status === 'active' ? (
                        <>
                          <div className="text-[var(--text-primary)]">
                            {formatNumber(chain.poolRewardsPerEpoch)} AXL
                          </div>
                          <div className="text-sm text-[var(--text-secondary)]">
                            {formatUsd(chain.poolRewardsPerEpochUsd)}
                          </div>
                        </>
                      ) : (
                        <div className="text-[var(--text-secondary)]">-</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right text-[var(--text-primary)]">
                      {verifierCount > 0 ? verifierCount : '-'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {chain.status === 'active' ? (
                        <div className="text-[var(--accent-green)] font-medium">
                          {formatNumber(rewards.axl, 4)} AXL
                        </div>
                      ) : (
                        <div className="text-[var(--text-secondary)]">-</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {chain.status === 'active' ? (
                        <div className="text-[var(--text-primary)]">
                          {formatUsd(rewards.usd)}
                        </div>
                      ) : (
                        <div className="text-[var(--text-secondary)]">-</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end">
                        <span className="text-[var(--text-secondary)] mr-1">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={nodeCost || ''}
                          onChange={(e) => handleCostChange(chain.chainId, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="0.00"
                          className="w-20 px-2 py-1 text-right bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-blue)]"
                        />
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {chain.status === 'active' ? (
                        <div
                          className={`font-medium ${
                            netProfit >= 0
                              ? 'text-[var(--accent-green)]'
                              : 'text-[var(--accent-red)]'
                          }`}
                        >
                          {netProfit >= 0 ? '+' : '-'}${Math.abs(netProfit).toFixed(2)}
                        </div>
                      ) : (
                        <div className="text-[var(--text-secondary)]">-</div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Info Note */}
      <p className="mt-4 text-sm text-[var(--text-secondary)]">
        * "Your Rewards" shows estimated earnings if you join as a new verifier
        (rewards divided by current verifiers + 1)
      </p>
    </div>
  );
}
