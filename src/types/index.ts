export interface ChainConfig {
  chainName: string;
  chainId: string;
  chainKey: string; // lowercase key used in contract queries (e.g., "flow", "sui")
  votingVerifierAddress: string | null;
  multisigProverAddress: string | null;
  status: 'active' | 'inactive';
}

export interface RewardsPoolResponse {
  balance: string;
  epoch_duration: string;
  rewards_per_epoch: string;
  current_epoch_num: string;
  participation_threshold: [string, string];
}

export interface RewardsPoolData {
  chainName: string;
  poolType: 'voting' | 'signing';
  poolAddress: string;

  // From contract query
  balance: number;
  rewardsPerEpoch: number;
  epochDurationBlocks: number;
  currentEpoch: number;
  participationThreshold: number;

  // Calculated
  activeVerifiers: number;
  // Estimated verifiers who meet participation threshold and qualify for rewards
  estimatedQualifyingVerifiers: number;
  rewardsPerNewVerifierPerEpoch: number;
  estimatedWeeklyRewards: number;
  estimatedMonthlyRewards: number;

  // USD values
  balanceUsd: number;
  epochRewardsUsd: number;
  weeklyRewardsUsd: number;
  monthlyRewardsUsd: number;
}

export interface ChainRewardsData {
  chainName: string;
  chainId: string;
  status: 'active' | 'inactive';
  votingPool: RewardsPoolData | null;
  signingPool: RewardsPoolData | null;

  // Pool rewards per epoch (raw, before dividing by verifiers)
  poolRewardsPerEpoch: number;
  poolRewardsPerEpochUsd: number;

  // Your rewards (divided by verifiers + 1)
  totalRewardsPerEpoch: number;
  totalRewardsPerEpochUsd: number;
  totalWeeklyRewards: number;
  totalWeeklyRewardsUsd: number;
  totalMonthlyRewards: number;
  totalMonthlyRewardsUsd: number;
  totalPoolBalance: number;
  totalPoolBalanceUsd: number;
}

export type TimePeriod = 'epoch' | 'weekly' | 'monthly';

interface VotingVerifierConfig {
  address: string;
  serviceName?: string;
  [key: string]: unknown;
}

interface MultisigProverConfig {
  address: string;
  [key: string]: unknown;
}

export interface MainnetConfig {
  axelar: {
    contracts: {
      Rewards: {
        address: string;
      };
      ServiceRegistry: {
        address: string;
      };
      VotingVerifier?: Record<string, VotingVerifierConfig>;
      MultisigProver?: Record<string, MultisigProverConfig>;
      // XRPL uses separate contract types
      XrplVotingVerifier?: Record<string, VotingVerifierConfig>;
      XrplMultisigProver?: Record<string, MultisigProverConfig>;
    };
  };
  chains: Record<string, {
    name: string;
    id: string;
    axelarId?: string;
  }>;
}
