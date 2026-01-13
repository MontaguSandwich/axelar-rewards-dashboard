import type { ChainRewardsData, RewardsPoolData, TimePeriod } from '../types';

interface ChainDetailProps {
  chain: ChainRewardsData;
  timePeriod: TimePeriod;
  onBack: () => void;
}

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

function truncateAddress(address: string): string {
  return address.slice(0, 12) + '...' + address.slice(-8);
}

interface PoolCardProps {
  pool: RewardsPoolData;
  timePeriod: TimePeriod;
}

function PoolCard({ pool, timePeriod }: PoolCardProps) {
  const getRewardsForPeriod = () => {
    switch (timePeriod) {
      case 'epoch':
        return {
          axl: pool.rewardsPerVerifierPerEpoch,
          usd: pool.epochRewardsUsd,
          label: 'Per Epoch',
        };
      case 'weekly':
        return {
          axl: pool.estimatedWeeklyRewards,
          usd: pool.weeklyRewardsUsd,
          label: 'Weekly',
        };
      case 'monthly':
        return {
          axl: pool.estimatedMonthlyRewards,
          usd: pool.monthlyRewardsUsd,
          label: 'Monthly',
        };
    }
  };

  const rewards = getRewardsForPeriod();

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] capitalize">
          {pool.poolType} Pool
        </h3>
        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-[var(--accent-green)]/20 text-[var(--accent-green)]">
          Active
        </span>
      </div>

      <div className="space-y-4">
        {/* Pool Address */}
        <div>
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Pool Address
          </div>
          <div className="text-[var(--text-primary)] font-mono text-sm">
            {truncateAddress(pool.poolAddress)}
          </div>
        </div>

        {/* Pool Balance */}
        <div>
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Pool Balance
          </div>
          <div className="text-[var(--text-primary)] text-xl font-medium">
            {formatNumber(pool.balance)} AXL
          </div>
          <div className="text-sm text-[var(--text-secondary)]">
            {formatUsd(pool.balanceUsd)}
          </div>
        </div>

        {/* Rewards Per Epoch */}
        <div>
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Pool Rewards/Epoch
          </div>
          <div className="text-[var(--text-primary)]">
            {formatNumber(pool.rewardsPerEpoch)} AXL
          </div>
        </div>

        {/* Epoch Duration */}
        <div>
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Epoch Duration
          </div>
          <div className="text-[var(--text-primary)]">
            {pool.epochDurationBlocks.toLocaleString()} blocks (~
            {Math.round((pool.epochDurationBlocks * 1.84) / 3600)} hours)
          </div>
        </div>

        {/* Current Epoch */}
        <div>
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Current Epoch
          </div>
          <div className="text-[var(--text-primary)]">{pool.currentEpoch}</div>
        </div>

        {/* Active Verifiers */}
        <div>
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Active Verifiers
          </div>
          <div className="text-[var(--text-primary)]">
            {pool.activeVerifiers}
          </div>
        </div>

        {/* Participation Threshold */}
        <div>
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Participation Threshold
          </div>
          <div className="text-[var(--text-primary)]">
            {(pool.participationThreshold * 100).toFixed(0)}%
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            (min % of events you must participate in)
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-[var(--border-color)] my-4" />

        {/* Your Estimated Rewards */}
        <div className="bg-[var(--bg-tertiary)] rounded-lg p-4">
          <div className="text-sm text-[var(--text-secondary)] mb-2">
            Your Estimated Rewards ({rewards.label})
          </div>
          <div className="text-2xl font-bold text-[var(--accent-green)]">
            {formatNumber(rewards.axl, 4)} AXL
          </div>
          <div className="text-[var(--text-secondary)]">
            {formatUsd(rewards.usd)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChainDetail({ chain, timePeriod, onBack }: ChainDetailProps) {
  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
        >
          <svg
            className="w-5 h-5 text-[var(--text-secondary)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-lg font-medium">
            {chain.chainName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">
              {chain.chainName}
            </h1>
            <div className="flex items-center gap-2">
              {chain.status === 'active' ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--accent-green)]/20 text-[var(--accent-green)]">
                  Active
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--text-secondary)]/20 text-[var(--text-secondary)]">
                  Inactive
                </span>
              )}
              <span className="text-sm text-[var(--text-secondary)]">
                {chain.chainId}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-4">
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Total Pool Balance
          </div>
          <div className="text-xl font-medium text-[var(--text-primary)]">
            {formatNumber(chain.totalPoolBalance)} AXL
          </div>
          <div className="text-sm text-[var(--text-secondary)]">
            {formatUsd(chain.totalPoolBalanceUsd)}
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-4">
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Combined {timePeriod === 'epoch' ? 'Epoch' : timePeriod === 'weekly' ? 'Weekly' : 'Monthly'} Rewards
          </div>
          <div className="text-xl font-medium text-[var(--accent-green)]">
            {formatNumber(
              timePeriod === 'epoch'
                ? chain.totalRewardsPerEpoch
                : timePeriod === 'weekly'
                ? chain.totalWeeklyRewards
                : chain.totalMonthlyRewards,
              4
            )}{' '}
            AXL
          </div>
          <div className="text-sm text-[var(--text-secondary)]">
            {formatUsd(
              timePeriod === 'epoch'
                ? chain.totalRewardsPerEpochUsd
                : timePeriod === 'weekly'
                ? chain.totalWeeklyRewardsUsd
                : chain.totalMonthlyRewardsUsd
            )}
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-4">
          <div className="text-sm text-[var(--text-secondary)] mb-1">
            Active Pools
          </div>
          <div className="text-xl font-medium text-[var(--text-primary)]">
            {(chain.votingPool ? 1 : 0) + (chain.signingPool ? 1 : 0)} / 2
          </div>
          <div className="text-sm text-[var(--text-secondary)]">
            {chain.votingPool ? 'Voting' : ''}{' '}
            {chain.votingPool && chain.signingPool ? '+ ' : ''}
            {chain.signingPool ? 'Signing' : ''}
            {!chain.votingPool && !chain.signingPool ? 'None' : ''}
          </div>
        </div>
      </div>

      {/* Pool Cards */}
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        Reward Pools
      </h2>

      {chain.status === 'inactive' ? (
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-8 text-center">
          <div className="text-[var(--text-secondary)]">
            No active reward pools for this chain
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          {chain.votingPool && (
            <PoolCard pool={chain.votingPool} timePeriod={timePeriod} />
          )}
          {chain.signingPool && (
            <PoolCard pool={chain.signingPool} timePeriod={timePeriod} />
          )}
          {!chain.votingPool && chain.signingPool && (
            <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] border-dashed p-6 flex items-center justify-center">
              <div className="text-center text-[var(--text-secondary)]">
                <div className="text-lg mb-1">Voting Pool</div>
                <div className="text-sm">Not available</div>
              </div>
            </div>
          )}
          {chain.votingPool && !chain.signingPool && (
            <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] border-dashed p-6 flex items-center justify-center">
              <div className="text-center text-[var(--text-secondary)]">
                <div className="text-lg mb-1">Signing Pool</div>
                <div className="text-sm">Not available</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
