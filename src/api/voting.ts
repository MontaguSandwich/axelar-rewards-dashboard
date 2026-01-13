import axios from 'axios';
import type { VotingEpochPerformance, VotingChainData } from '../types';
import { fetchMainnetConfig, getRewardsContractAddress } from './config';

const LCD_ENDPOINT = 'https://axelar-lcd.publicnode.com';
const EPOCH_DURATION = 47250; // blocks

// Query contract helper
async function queryContract(contract: string, query: object): Promise<any> {
  try {
    const queryBase64 = btoa(JSON.stringify(query));
    const url = `${LCD_ENDPOINT}/cosmwasm/wasm/v1/contract/${contract}/smart/${queryBase64}`;
    const response = await axios.get(url, { timeout: 15000 });
    return response.data?.data ?? null;
  } catch (error) {
    console.warn('Query failed:', error);
    return null;
  }
}

// Get current block height
async function getCurrentBlockHeight(): Promise<number> {
  const response = await axios.get(`${LCD_ENDPOINT}/cosmos/base/tendermint/v1beta1/blocks/latest`);
  return parseInt(response.data.block.header.height);
}

// Get voting verifier address for a chain
export async function getVotingVerifierAddress(chainName: string): Promise<string | null> {
  const config = await fetchMainnetConfig();

  // Check regular VotingVerifier
  const votingVerifiers = config.axelar.contracts.VotingVerifier || {};
  if (votingVerifiers[chainName]?.address) {
    return votingVerifiers[chainName].address;
  }

  // Check XRPL VotingVerifier
  const xrplVotingVerifiers = config.axelar.contracts.XrplVotingVerifier || {};
  if (xrplVotingVerifiers[chainName]?.address) {
    return xrplVotingVerifiers[chainName].address;
  }

  return null;
}

// Get voting rewards pool info
export async function fetchVotingRewardsPoolInfo(chainName: string): Promise<{
  currentEpoch: number;
  lastDistributionEpoch: number;
  rewardsPerEpoch: number;
} | null> {
  const [rewardsContract, votingVerifierAddress] = await Promise.all([
    getRewardsContractAddress(),
    getVotingVerifierAddress(chainName)
  ]);

  if (!votingVerifierAddress) return null;

  const result = await queryContract(rewardsContract, {
    rewards_pool: {
      pool_id: { chain_name: chainName, contract: votingVerifierAddress }
    }
  });

  if (!result) return null;

  return {
    currentEpoch: parseInt(result.current_epoch_num),
    lastDistributionEpoch: result.last_distribution_epoch ? parseInt(result.last_distribution_epoch) : 0,
    rewardsPerEpoch: parseInt(result.rewards_per_epoch) / 1e6
  };
}

// Find latest poll ID via binary search
async function findLatestPollId(votingVerifierContract: string): Promise<number> {
  // First try the poll_id query which returns the current poll count
  const pollIdResult = await queryContract(votingVerifierContract, { poll_id: {} });
  if (pollIdResult && typeof pollIdResult === 'number') {
    return pollIdResult;
  }
  if (pollIdResult && typeof pollIdResult === 'string') {
    return parseInt(pollIdResult);
  }

  // Fallback to binary search if poll_id query doesn't work
  let low = 1;
  let high = 100000;
  let latestPoll = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const result = await queryContract(votingVerifierContract, { poll: { poll_id: mid.toString() } });
    if (result && result.poll) {
      latestPoll = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return latestPoll;
}

// Get poll details
async function getPollDetails(votingVerifierContract: string, pollId: number): Promise<{
  expiresAt: number;
  finished: boolean;
  participation: string[]; // verifier addresses that participated
} | null> {
  const result = await queryContract(votingVerifierContract, { poll: { poll_id: pollId.toString() } });
  if (!result || !result.poll) return null;

  const poll = result.poll;
  const participation = poll.participation ? Object.keys(poll.participation) : [];

  return {
    expiresAt: parseInt(poll.expires_at) || 0,
    finished: poll.finished || false,
    participation
  };
}

// Get verifier's voting performance for epochs
export async function fetchVotingPerformance(
  verifierAddress: string,
  chainName: string,
  epochsToCheck: number = 5,
  onProgress?: (message: string) => void
): Promise<VotingChainData | null> {
  const log = onProgress || console.log;

  try {
    const votingVerifierAddress = await getVotingVerifierAddress(chainName);
    if (!votingVerifierAddress) {
      log('No VotingVerifier contract for this chain');
      return null;
    }

    const [poolInfo, currentBlock] = await Promise.all([
      fetchVotingRewardsPoolInfo(chainName),
      getCurrentBlockHeight()
    ]);

    if (!poolInfo) {
      log('No voting rewards pool for this chain');
      return null;
    }

    // Get active verifiers count from the latest poll
    log('Finding latest poll...');
    const latestPollId = await findLatestPollId(votingVerifierAddress);
    log(`Latest poll: ${latestPollId}`);

    // Get latest poll to estimate active verifiers
    const latestPoll = await getPollDetails(votingVerifierAddress, latestPollId);
    const activeVerifiers = latestPoll ? latestPoll.participation.length : 30; // estimate

    const rewardsPerVerifierPerEpoch = activeVerifiers > 0
      ? poolInfo.rewardsPerEpoch / activeVerifiers
      : poolInfo.rewardsPerEpoch;

    // Calculate unpaid epochs
    const unpaidEpochs: number[] = [];
    for (let e = poolInfo.lastDistributionEpoch + 1; e <= poolInfo.currentEpoch; e++) {
      unpaidEpochs.push(e);
    }

    // Only check last N epochs
    const epochsToScan = unpaidEpochs.slice(-epochsToCheck);

    if (epochsToScan.length === 0) {
      return {
        chainName,
        votingVerifierAddress,
        currentEpoch: poolInfo.currentEpoch,
        lastDistributionEpoch: poolInfo.lastDistributionEpoch,
        unpaidEpochCount: 0,
        activeVerifiers,
        poolRewardsPerEpoch: poolInfo.rewardsPerEpoch,
        rewardsPerVerifierPerEpoch,
        epochPerformance: [],
        qualifiedEpochs: 0,
        estimatedPendingRewards: 0
      };
    }

    // Calculate epoch block ranges
    const currentEpochStartBlock = currentBlock - (currentBlock % EPOCH_DURATION);
    const epochRanges = new Map<number, { start: number; end: number }>();

    for (const epoch of epochsToScan) {
      const epochsBack = poolInfo.currentEpoch - epoch;
      const epochStart = currentEpochStartBlock - (epochsBack * EPOCH_DURATION);
      const epochEnd = epochStart + EPOCH_DURATION - 1;
      epochRanges.set(epoch, { start: epochStart, end: epochEnd });
    }

    // Initialize epoch stats
    const epochStats = new Map<number, { total: number; voted: number }>();
    for (const epoch of epochsToScan) {
      epochStats.set(epoch, { total: 0, voted: 0 });
    }

    // Get oldest epoch's start block
    const oldestEpoch = Math.min(...epochsToScan);
    const oldestEpochRange = epochRanges.get(oldestEpoch)!;

    log(`Scanning polls for epochs ${oldestEpoch}-${poolInfo.currentEpoch}...`);

    let pollsScanned = 0;
    let pollsMapped = 0;

    // Scan backwards from latest poll (limit to 2000 to avoid timeout)
    for (let pollId = latestPollId; pollId >= Math.max(1, latestPollId - 2000); pollId--) {
      const poll = await getPollDetails(votingVerifierAddress, pollId);
      if (!poll) continue;

      pollsScanned++;

      // Stop if poll is before our oldest epoch
      if (poll.expiresAt < oldestEpochRange.start) {
        break;
      }

      // Find which epoch this poll belongs to
      for (const [epoch, range] of epochRanges) {
        if (poll.expiresAt >= range.start && poll.expiresAt <= range.end) {
          const stats = epochStats.get(epoch)!;
          stats.total++;

          // Check if verifier voted in this poll
          if (poll.participation.includes(verifierAddress)) {
            stats.voted++;
          }
          pollsMapped++;
          break;
        }
      }

      // Progress update every 50 polls
      if (pollsScanned % 50 === 0) {
        log(`Scanned ${pollsScanned} polls...`);
      }
    }

    log(`Total: ${pollsScanned} polls scanned, ${pollsMapped} mapped`);

    // Build performance array
    const epochPerformance: VotingEpochPerformance[] = [];
    let qualifiedEpochs = 0;

    for (const epoch of epochsToScan) {
      const stats = epochStats.get(epoch)!;
      const rate = stats.total > 0 ? (stats.voted / stats.total) * 100 : 0;
      const qualified = stats.total > 0 ? rate >= 80 : false;

      if (qualified) qualifiedEpochs++;

      epochPerformance.push({
        epochNum: epoch,
        pollsInEpoch: stats.total,
        pollsVoted: stats.voted,
        participationRate: rate,
        qualified
      });
    }

    // Estimate pending rewards
    const estimatedPendingRewards = (qualifiedEpochs / epochsToScan.length) * unpaidEpochs.length * rewardsPerVerifierPerEpoch;

    return {
      chainName,
      votingVerifierAddress,
      currentEpoch: poolInfo.currentEpoch,
      lastDistributionEpoch: poolInfo.lastDistributionEpoch,
      unpaidEpochCount: unpaidEpochs.length,
      activeVerifiers,
      poolRewardsPerEpoch: poolInfo.rewardsPerEpoch,
      rewardsPerVerifierPerEpoch,
      epochPerformance,
      qualifiedEpochs,
      estimatedPendingRewards
    };
  } catch (error) {
    console.error('Error fetching voting performance:', error);
    return null;
  }
}
