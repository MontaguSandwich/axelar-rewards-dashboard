import axios from 'axios';
import type { Verifier, EpochPerformance, VerifierChainData } from '../types';
import { getServiceRegistryAddress, getRewardsContractAddress, getGlobalMultisigAddress } from './config';

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

// Get all verifiers for a chain
export async function fetchAllVerifiers(chainName: string = 'flow'): Promise<Verifier[]> {
  const serviceRegistry = await getServiceRegistryAddress();

  const result = await queryContract(serviceRegistry, {
    active_verifiers: {
      service_name: 'amplifier',
      chain_name: chainName
    }
  });

  if (!result || !Array.isArray(result)) return [];

  return result.map((v: any) => ({
    address: v.verifier_info.address,
    bondedAmount: parseInt(v.verifier_info.bonding_state?.Bonded?.amount || '0') / 1e6
  }));
}

// Get rewards pool info for signing
export async function fetchRewardsPoolInfo(chainName: string): Promise<{
  currentEpoch: number;
  lastDistributionEpoch: number;
  rewardsPerEpoch: number;
} | null> {
  const [rewardsContract, globalMultisig] = await Promise.all([
    getRewardsContractAddress(),
    getGlobalMultisigAddress()
  ]);

  if (!globalMultisig) return null;

  const result = await queryContract(rewardsContract, {
    rewards_pool: {
      pool_id: { chain_name: chainName, contract: globalMultisig }
    }
  });

  if (!result) return null;

  return {
    currentEpoch: parseInt(result.current_epoch_num),
    lastDistributionEpoch: result.last_distribution_epoch ? parseInt(result.last_distribution_epoch) : 0,
    rewardsPerEpoch: parseInt(result.rewards_per_epoch) / 1e6
  };
}

// Find latest multisig session ID via binary search
async function findLatestSessionId(multisigContract: string): Promise<number> {
  let low = 1;
  let high = 100000;
  let latestSession = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const result = await queryContract(multisigContract, { multisig: { session_id: mid.toString() } });
    if (result) {
      latestSession = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return latestSession;
}

// Get session details
async function getSessionDetails(multisigContract: string, sessionId: number): Promise<{
  completedAt: number;
  signers: string[];
  signatures: string[];
} | null> {
  const result = await queryContract(multisigContract, { multisig: { session_id: sessionId.toString() } });
  if (!result) return null;

  const signers = Object.keys(result.verifier_set?.signers || {});
  const signatures = Object.keys(result.signatures || {});
  const completedAt = result.state?.completed?.completed_at || 0;

  return { completedAt, signers, signatures };
}

// Get verifier's signing performance for epochs
export async function fetchVerifierPerformance(
  verifierAddress: string,
  chainName: string = 'flow',
  epochsToCheck: number = 5,
  onProgress?: (message: string) => void
): Promise<VerifierChainData | null> {
  const log = onProgress || console.log;

  try {
    const [poolInfo, globalMultisig, currentBlock, verifiers] = await Promise.all([
      fetchRewardsPoolInfo(chainName),
      getGlobalMultisigAddress(),
      getCurrentBlockHeight(),
      fetchAllVerifiers(chainName)
    ]);

    if (!poolInfo || !globalMultisig) {
      log('Could not get pool info or multisig contract');
      return null;
    }

    const activeVerifiers = verifiers.length;
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
    const epochStats = new Map<number, { total: number; signed: number }>();
    for (const epoch of epochsToScan) {
      epochStats.set(epoch, { total: 0, signed: 0 });
    }

    // Find latest session and scan backwards
    log('Finding latest session...');
    const latestSessionId = await findLatestSessionId(globalMultisig);
    log(`Latest session: ${latestSessionId}`);

    // Get oldest epoch's start block
    const oldestEpoch = Math.min(...epochsToScan);
    const oldestEpochRange = epochRanges.get(oldestEpoch)!;

    log(`Scanning sessions for epochs ${oldestEpoch}-${poolInfo.currentEpoch}...`);

    let sessionsScanned = 0;
    let sessionsMapped = 0;

    // Scan backwards from latest session (limit to 5000 to avoid timeout)
    for (let sessionId = latestSessionId; sessionId >= Math.max(1, latestSessionId - 5000); sessionId--) {
      const session = await getSessionDetails(globalMultisig, sessionId);
      if (!session) continue;

      sessionsScanned++;

      // Stop if session is before our oldest epoch
      if (session.completedAt < oldestEpochRange.start) {
        break;
      }

      // Find which epoch this session belongs to
      for (const [epoch, range] of epochRanges) {
        if (session.completedAt >= range.start && session.completedAt <= range.end) {
          const stats = epochStats.get(epoch)!;
          stats.total++;

          // Check if verifier signed this session
          if (session.signatures.includes(verifierAddress)) {
            stats.signed++;
          }
          sessionsMapped++;
          break;
        }
      }

      // Progress update every 100 sessions
      if (sessionsScanned % 100 === 0) {
        log(`Scanned ${sessionsScanned} sessions...`);
      }
    }

    log(`Total: ${sessionsScanned} sessions scanned, ${sessionsMapped} mapped`);

    // Build performance array
    const epochPerformance: EpochPerformance[] = [];
    let qualifiedEpochs = 0;

    for (const epoch of epochsToScan) {
      const stats = epochStats.get(epoch)!;
      const rate = stats.total > 0 ? (stats.signed / stats.total) * 100 : 0;
      const qualified = stats.total > 0 ? rate >= 80 : false;

      if (qualified) qualifiedEpochs++;

      epochPerformance.push({
        epochNum: epoch,
        sessionsInEpoch: stats.total,
        sessionsSigned: stats.signed,
        participationRate: rate,
        qualified
      });
    }

    // Estimate pending rewards (based on qualified epochs checked)
    // Note: This is an approximation based on checked epochs - uses per-verifier share
    const estimatedPendingRewards = (qualifiedEpochs / epochsToScan.length) * unpaidEpochs.length * rewardsPerVerifierPerEpoch;

    return {
      chainName,
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
    console.error('Error fetching verifier performance:', error);
    return null;
  }
}
