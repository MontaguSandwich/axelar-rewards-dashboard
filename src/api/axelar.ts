import axios from 'axios';
import type { ChainConfig, ChainRewardsData, RewardsPoolData, RewardsPoolResponse } from '../types';
import { getRewardsContractAddress, getChainConfigs, getServiceRegistryAddress, getGlobalMultisigAddress } from './config';
import { fetchAxlPrice } from './prices';

// Use LCD (REST) API - more reliable and CORS-friendly
const LCD_ENDPOINT = 'https://axelar-lcd.publicnode.com';

// Axelar block time is ~1.84 seconds (verified on-chain)
const BLOCK_TIME_SECONDS = 1.84;
const BLOCKS_PER_DAY = (24 * 60 * 60) / BLOCK_TIME_SECONDS; // ~46,956
const BLOCKS_PER_WEEK = BLOCKS_PER_DAY * 7;
const BLOCKS_PER_MONTH = BLOCKS_PER_DAY * 30;

async function queryRewardsPool(
  rewardsContract: string,
  chainName: string,
  contractAddress: string
): Promise<RewardsPoolResponse | null> {
  try {
    const query = {
      rewards_pool: {
        pool_id: {
          chain_name: chainName,
          contract: contractAddress,
        },
      },
    };

    const queryBase64 = btoa(JSON.stringify(query));
    const url = `${LCD_ENDPOINT}/cosmwasm/wasm/v1/contract/${rewardsContract}/smart/${queryBase64}`;

    console.log(`Querying rewards pool for ${chainName}: ${contractAddress}`);
    const response = await axios.get(url);

    if (response.data && response.data.data) {
      console.log(`Rewards pool response for ${chainName}:`, response.data.data);
      return response.data.data;
    }
    return null;
  } catch (error) {
    console.warn(`Failed to query rewards pool ${chainName} (${contractAddress}):`, error);
    return null;
  }
}

// Cached service registry address (fetched dynamically from config)
let cachedServiceRegistry: string | null = null;

async function getServiceRegistry(): Promise<string> {
  if (!cachedServiceRegistry) {
    cachedServiceRegistry = await getServiceRegistryAddress();
  }
  return cachedServiceRegistry;
}

async function queryActiveVerifiers(chainName: string): Promise<number> {
  try {
    const serviceRegistry = await getServiceRegistry();
    const query = {
      active_verifiers: {
        service_name: 'amplifier',
        chain_name: chainName,
      },
    };

    const queryBase64 = btoa(JSON.stringify(query));
    const url = `${LCD_ENDPOINT}/cosmwasm/wasm/v1/contract/${serviceRegistry}/smart/${queryBase64}`;

    console.log(`Querying active verifiers for ${chainName}`);
    const response = await axios.get(url);

    if (response.data && Array.isArray(response.data.data)) {
      const count = response.data.data.length;
      console.log(`Active verifiers for ${chainName}: ${count}`);
      return count;
    }
    return 0;
  } catch (error) {
    console.warn(`Failed to query active verifiers for ${chainName}:`, error);
    return 0;
  }
}

function calculatePoolMetrics(
  poolResponse: RewardsPoolResponse,
  activeVerifiers: number,
  axlPrice: number,
  chainName: string,
  poolType: 'voting' | 'signing',
  poolAddress: string
): RewardsPoolData {
  const balance = parseInt(poolResponse.balance) / 1e6;
  const rewardsPerEpoch = parseInt(poolResponse.rewards_per_epoch) / 1e6;
  const epochDurationBlocks = parseInt(poolResponse.epoch_duration);
  const currentEpoch = parseInt(poolResponse.current_epoch_num);
  const participationThreshold =
    parseInt(poolResponse.participation_threshold[0]) /
    parseInt(poolResponse.participation_threshold[1]);

  // REWARD DISTRIBUTION MECHANICS:
  // - rewards_per_epoch is split equally among all QUALIFYING verifiers each epoch
  // - A verifier qualifies if they participate in >= participationThreshold% of EVENTS
  //   (e.g., 80% threshold means verifier must vote/sign on 80% of messages that epoch)
  // - This is NOT "80% of verifiers qualify" - it's "each verifier must hit 80% participation"
  // - In practice, most active verifiers meet the threshold (or they get deregistered)
  // - Show actual rewards per verifier based on current verifier count
  const rewardsPerVerifierPerEpoch = activeVerifiers > 0
    ? rewardsPerEpoch / activeVerifiers
    : rewardsPerEpoch; // If no verifiers, one would get full rewards

  // Calculate epochs per time period based on block time
  const epochsPerWeek = BLOCKS_PER_WEEK / epochDurationBlocks;
  const epochsPerMonth = BLOCKS_PER_MONTH / epochDurationBlocks;

  const estimatedWeeklyRewards = rewardsPerVerifierPerEpoch * epochsPerWeek;
  const estimatedMonthlyRewards = rewardsPerVerifierPerEpoch * epochsPerMonth;

  return {
    chainName,
    poolType,
    poolAddress,
    balance,
    rewardsPerEpoch,
    epochDurationBlocks,
    currentEpoch,
    participationThreshold,
    activeVerifiers,
    rewardsPerVerifierPerEpoch,
    estimatedWeeklyRewards,
    estimatedMonthlyRewards,
    balanceUsd: balance * axlPrice,
    epochRewardsUsd: rewardsPerVerifierPerEpoch * axlPrice,
    weeklyRewardsUsd: estimatedWeeklyRewards * axlPrice,
    monthlyRewardsUsd: estimatedMonthlyRewards * axlPrice,
  };
}

export async function fetchAllChainRewards(): Promise<ChainRewardsData[]> {
  console.log('Fetching all chain rewards...');

  const [chainConfigs, rewardsContract, axlPrice, globalMultisig] = await Promise.all([
    getChainConfigs(),
    getRewardsContractAddress(),
    fetchAxlPrice(),
    getGlobalMultisigAddress(),
  ]);

  console.log('Chain configs:', chainConfigs);
  console.log('Rewards contract:', rewardsContract);
  console.log('Global Multisig:', globalMultisig);
  console.log('AXL price:', axlPrice);

  const chainRewardsPromises = chainConfigs.map(async (chain) => {
    return fetchChainRewards(chain, rewardsContract, axlPrice, globalMultisig);
  });

  const results = await Promise.all(chainRewardsPromises);

  // Sort by active status first, then by total monthly rewards
  return results.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'active' ? -1 : 1;
    }
    return b.totalMonthlyRewards - a.totalMonthlyRewards;
  });
}

async function fetchChainRewards(
  chain: ChainConfig,
  rewardsContract: string,
  axlPrice: number,
  globalMultisig: string | null
): Promise<ChainRewardsData> {
  let votingPool: RewardsPoolData | null = null;
  let signingPool: RewardsPoolData | null = null;

  // Query voting pool
  if (chain.votingVerifierAddress) {
    const votingResponse = await queryRewardsPool(
      rewardsContract,
      chain.chainKey,
      chain.votingVerifierAddress
    );
    if (votingResponse && parseInt(votingResponse.balance) > 0) {
      const activeVerifiers = await queryActiveVerifiers(chain.chainKey);
      votingPool = calculatePoolMetrics(
        votingResponse,
        activeVerifiers,
        axlPrice,
        chain.chainName,
        'voting',
        chain.votingVerifierAddress
      );
    }
  }

  // Query signing pool - use global Multisig FIRST (per governance),
  // then fall back to chain-specific MultisigProver
  let signingResponse = null;
  let signingContractUsed = null;

  // Try global Multisig first (governance proposals configure pools here)
  if (globalMultisig) {
    signingResponse = await queryRewardsPool(
      rewardsContract,
      chain.chainKey,
      globalMultisig
    );
    if (signingResponse && parseInt(signingResponse.balance) > 0) {
      signingContractUsed = globalMultisig;
    }
  }

  // Fall back to chain-specific MultisigProver (legacy pools)
  if (!signingContractUsed && chain.multisigProverAddress) {
    signingResponse = await queryRewardsPool(
      rewardsContract,
      chain.chainKey,
      chain.multisigProverAddress
    );
    if (signingResponse && parseInt(signingResponse.balance) > 0) {
      signingContractUsed = chain.multisigProverAddress;
    }
  }

  if (signingResponse && signingContractUsed) {
    const activeVerifiers = await queryActiveVerifiers(chain.chainKey);
    signingPool = calculatePoolMetrics(
      signingResponse,
      activeVerifiers,
      axlPrice,
      chain.chainName,
      'signing',
      signingContractUsed
    );
  }

  const hasActivePools = votingPool !== null || signingPool !== null;

  // Calculate combined totals
  const poolRewardsPerEpoch =
    (votingPool?.rewardsPerEpoch ?? 0) +
    (signingPool?.rewardsPerEpoch ?? 0);
  const totalRewardsPerEpoch =
    (votingPool?.rewardsPerVerifierPerEpoch ?? 0) +
    (signingPool?.rewardsPerVerifierPerEpoch ?? 0);
  const totalWeeklyRewards =
    (votingPool?.estimatedWeeklyRewards ?? 0) +
    (signingPool?.estimatedWeeklyRewards ?? 0);
  const totalMonthlyRewards =
    (votingPool?.estimatedMonthlyRewards ?? 0) +
    (signingPool?.estimatedMonthlyRewards ?? 0);
  const totalPoolBalance =
    (votingPool?.balance ?? 0) + (signingPool?.balance ?? 0);

  return {
    chainName: chain.chainName,
    chainId: chain.chainId,
    status: hasActivePools ? 'active' : 'inactive',
    votingPool,
    signingPool,
    poolRewardsPerEpoch,
    poolRewardsPerEpochUsd: poolRewardsPerEpoch * axlPrice,
    totalRewardsPerEpoch,
    totalRewardsPerEpochUsd: totalRewardsPerEpoch * axlPrice,
    totalWeeklyRewards,
    totalWeeklyRewardsUsd: totalWeeklyRewards * axlPrice,
    totalMonthlyRewards,
    totalMonthlyRewardsUsd: totalMonthlyRewards * axlPrice,
    totalPoolBalance,
    totalPoolBalanceUsd: totalPoolBalance * axlPrice,
  };
}
