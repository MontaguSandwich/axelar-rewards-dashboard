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
  // First try the poll_id query which returns the NEXT poll ID to be created
  const pollIdResult = await queryContract(votingVerifierContract, { poll_id: {} });
  if (pollIdResult) {
    const nextPollId = typeof pollIdResult === 'number' ? pollIdResult : parseInt(pollIdResult);
    // poll_id returns next ID, so latest existing is nextPollId - 1
    const latestExisting = nextPollId - 1;
    if (latestExisting >= 1) {
      // Verify this poll actually exists
      const verifyPoll = await queryContract(votingVerifierContract, { poll: { poll_id: latestExisting.toString() } });
      if (verifyPoll && verifyPoll.poll) {
        return latestExisting;
      }
    }
  }

  // First check if poll 1 even exists - if not, this contract may have no polls
  const poll1 = await queryContract(votingVerifierContract, { poll: { poll_id: "1" } });
  if (!poll1 || !poll1.poll) {
    console.log('Poll 1 does not exist - this chain may have no voting polls yet');
    return 0; // Return 0 to indicate no polls
  }

  // Binary search with smaller initial range
  let low = 1;
  let high = 1000; // Start smaller
  let latestPoll = 1;

  // First find a rough upper bound
  while (high <= 100000) {
    const result = await queryContract(votingVerifierContract, { poll: { poll_id: high.toString() } });
    if (result && result.poll) {
      latestPoll = high;
      low = high;
      high *= 2;
    } else {
      break;
    }
  }

  // Now binary search within the range
  high = Math.min(high, 100000);
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

    // If no polls exist, return early with empty data
    if (latestPollId === 0) {
      log('No voting polls found for this chain');
      return {
        chainName,
        votingVerifierAddress,
        currentEpoch: poolInfo.currentEpoch,
        lastDistributionEpoch: poolInfo.lastDistributionEpoch,
        unpaidEpochCount: poolInfo.currentEpoch - poolInfo.lastDistributionEpoch,
        activeVerifiers: 0,
        poolRewardsPerEpoch: poolInfo.rewardsPerEpoch,
        rewardsPerVerifierPerEpoch: 0,
        epochPerformance: [],
        qualifiedEpochs: 0,
        estimatedPendingRewards: 0
      };
    }

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

    // Log epoch ranges for debugging
    log(`Epoch ranges (block heights):`);
    for (const [epoch, range] of epochRanges) {
      log(`  Epoch ${epoch}: ${range.start} - ${range.end}`);
    }

    log(`Scanning polls for epochs ${oldestEpoch}-${poolInfo.currentEpoch}...`);

    let pollsScanned = 0;
    let pollsMapped = 0;
    let pollsOutOfRange = 0;

    // Scan backwards from latest poll (limit to 2000 to avoid timeout)
    for (let pollId = latestPollId; pollId >= Math.max(1, latestPollId - 2000); pollId--) {
      const poll = await getPollDetails(votingVerifierAddress, pollId);
      if (!poll) continue;

      pollsScanned++;

      // Log first few polls to debug
      if (pollsScanned <= 3) {
        log(`Poll ${pollId}: expires_at=${poll.expiresAt}, participants=${poll.participation.length}`);
      }

      // Stop if poll is before our oldest epoch
      if (poll.expiresAt < oldestEpochRange.start) {
        log(`Poll ${pollId} (expires_at=${poll.expiresAt}) is before oldest epoch start (${oldestEpochRange.start}), stopping`);
        break;
      }

      // Find which epoch this poll belongs to
      let mapped = false;
      for (const [epoch, range] of epochRanges) {
        if (poll.expiresAt >= range.start && poll.expiresAt <= range.end) {
          const stats = epochStats.get(epoch)!;
          stats.total++;

          // Check if verifier voted in this poll
          if (poll.participation.includes(verifierAddress)) {
            stats.voted++;
          }
          pollsMapped++;
          mapped = true;
          break;
        }
      }

      if (!mapped) {
        pollsOutOfRange++;
      }

      // Progress update every 50 polls
      if (pollsScanned % 50 === 0) {
        log(`Scanned ${pollsScanned} polls...`);
      }
    }

    log(`Total: ${pollsScanned} polls scanned, ${pollsMapped} mapped, ${pollsOutOfRange} out of range`);

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
