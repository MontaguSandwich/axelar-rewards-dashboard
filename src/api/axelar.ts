import axios from 'axios';
import type { ChainConfig, ChainRewardsData, RewardsPoolData, RewardsPoolResponse } from '../types';
import { getRewardsContractAddress, getChainConfigs, getServiceRegistryAddress } from './config';
import { fetchAxlPrice } from './prices';

// Use LCD (REST) API - more reliable and CORS-friendly
const LCD_ENDPOINT = 'https://axelar-lcd.publicnode.com';

// Axelar block time is ~5 seconds (verified from docs.axelar.dev)
const BLOCK_TIME_SECONDS = 5;
const BLOCKS_PER_DAY = (24 * 60 * 60) / BLOCK_TIME_SECONDS; // ~17,280
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

  // IMPORTANT: Rewards are only distributed to verifiers who meet the participation threshold.
  // Not all active verifiers qualify - only those meeting the threshold (e.g., 80%) receive rewards.
  // We estimate the number of qualifying verifiers based on the participation threshold.
  // This provides a more accurate reward estimate than dividing by all active verifiers.
  const estimatedQualifyingVerifiers = Math.max(1, Math.ceil(activeVerifiers * participationThreshold));

  // Calculate for a NEW verifier joining (assuming they will meet the threshold)
  const qualifyingWithNewVerifier = estimatedQualifyingVerifiers + 1;
  const rewardsPerNewVerifierPerEpoch = rewardsPerEpoch / qualifyingWithNewVerifier;

  // Calculate epochs per time period
  const epochsPerWeek = BLOCKS_PER_WEEK / epochDurationBlocks;
  const epochsPerMonth = BLOCKS_PER_MONTH / epochDurationBlocks;

  const estimatedWeeklyRewards = rewardsPerNewVerifierPerEpoch * epochsPerWeek;
  const estimatedMonthlyRewards = rewardsPerNewVerifierPerEpoch * epochsPerMonth;

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
    estimatedQualifyingVerifiers,
    rewardsPerNewVerifierPerEpoch,
    estimatedWeeklyRewards,
    estimatedMonthlyRewards,
    balanceUsd: balance * axlPrice,
    epochRewardsUsd: rewardsPerNewVerifierPerEpoch * axlPrice,
    weeklyRewardsUsd: estimatedWeeklyRewards * axlPrice,
    monthlyRewardsUsd: estimatedMonthlyRewards * axlPrice,
  };
}

export async function fetchAllChainRewards(): Promise<ChainRewardsData[]> {
  console.log('Fetching all chain rewards...');

  const [chainConfigs, rewardsContract, axlPrice] = await Promise.all([
    getChainConfigs(),
    getRewardsContractAddress(),
    fetchAxlPrice(),
  ]);

  console.log('Chain configs:', chainConfigs);
  console.log('Rewards contract:', rewardsContract);
  console.log('AXL price:', axlPrice);

  const chainRewardsPromises = chainConfigs.map(async (chain) => {
    return fetchChainRewards(chain, rewardsContract, axlPrice);
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
  axlPrice: number
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

  // Query signing pool
  if (chain.multisigProverAddress) {
    const signingResponse = await queryRewardsPool(
      rewardsContract,
      chain.chainKey,
      chain.multisigProverAddress
    );
    if (signingResponse && parseInt(signingResponse.balance) > 0) {
      const activeVerifiers = await queryActiveVerifiers(chain.chainKey);
      signingPool = calculatePoolMetrics(
        signingResponse,
        activeVerifiers,
        axlPrice,
        chain.chainName,
        'signing',
        chain.multisigProverAddress
      );
    }
  }

  const hasActivePools = votingPool !== null || signingPool !== null;

  // Calculate combined totals
  const poolRewardsPerEpoch =
    (votingPool?.rewardsPerEpoch ?? 0) +
    (signingPool?.rewardsPerEpoch ?? 0);
  const totalRewardsPerEpoch =
    (votingPool?.rewardsPerNewVerifierPerEpoch ?? 0) +
    (signingPool?.rewardsPerNewVerifierPerEpoch ?? 0);
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
