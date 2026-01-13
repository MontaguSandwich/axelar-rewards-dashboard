/**
 * Verifier Explorer - Data Layer
 *
 * Gets:
 * 1. All verifiers from Service Registry
 * 2. Chains each verifier is active on
 * 3. Unpaid epochs per chain
 * 4. Participation per verifier per epoch
 */

const LCD_ENDPOINTS = [
  'https://axelar-api.polkachu.com',
  'https://api-axelar.cosmos-spaces.cloud',
  'https://axelar-rest.publicnode.com',
];

let AXELAR_LCD = LCD_ENDPOINTS[0];

const SERVICE_REGISTRY = 'axelar1rpj2jjrv3vpugx9ake9kgk3s2kgwt0y60wtkmcgfml5m3et0mrls6nct9m';
const REWARDS_CONTRACT = 'axelar1harq5xe68lzl2kx4e5ch4k8840cgqnry567g0fgw7vt2atcuugrqfa7j5z';
const GLOBAL_MULTISIG = 'axelar14a4ar5jh7ue4wg28jwsspf23r8k68j7g5d6d3fsttrhp42ajn4xq6zayy5';

// VotingVerifier contracts per chain - need to expand this
const VOTING_VERIFIERS: Record<string, string> = {
  'flow': 'axelar1kkqdsqvwq9a7p9fj0w89wpx2m2t0vrxl782aslhq0kdw2xxd2aesv3un04',
};

const EPOCH_DURATION = 47250; // blocks
const BLOCK_TIME = 1.84; // seconds

interface Verifier {
  address: string;
  bondedAmount: string;
  chains: string[];
}

interface EpochPerformance {
  epochNum: number;
  startBlock: number;
  endBlock: number;
  pollsInEpoch: number;
  pollsVoted: number;
  participationRate: number;
  qualified: boolean; // >= 80%
}

interface ChainStatus {
  chainName: string;
  votingVerifier: string;
  currentEpoch: number;
  lastDistributionEpoch: number;
  unpaidEpochs: number[];
  epochPerformance: EpochPerformance[];
}

async function findWorkingEndpoint(): Promise<string> {
  for (const endpoint of LCD_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/cosmos/base/tendermint/v1beta1/blocks/latest`, {
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) return endpoint;
    } catch (e) {}
  }
  throw new Error('All endpoints failed');
}

async function queryContract(contract: string, query: object): Promise<any> {
  const queryBase64 = Buffer.from(JSON.stringify(query)).toString('base64');
  const url = `${AXELAR_LCD}/cosmwasm/wasm/v1/contract/${contract}/smart/${queryBase64}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) return null;
  const result = await response.json();
  return result.data;
}

async function getCurrentBlockHeight(): Promise<number> {
  const response = await fetch(`${AXELAR_LCD}/cosmos/base/tendermint/v1beta1/blocks/latest`);
  const data = await response.json();
  return parseInt(data.block.header.height);
}

// Get all verifiers for a specific chain
async function getChainVerifiers(chainName: string): Promise<Verifier[]> {
  const result = await queryContract(SERVICE_REGISTRY, {
    active_verifiers: {
      service_name: 'amplifier',
      chain_name: chainName
    }
  });

  if (!result) return [];

  return result.map((v: any) => ({
    address: v.verifier_info.address,
    bondedAmount: v.verifier_info.bonding_state?.Bonded?.amount || '0',
    chains: [chainName]
  }));
}

// Get all unique verifiers across all known chains
async function getAllVerifiers(): Promise<Verifier[]> {
  const verifierMap = new Map<string, Verifier>();

  for (const chainName of Object.keys(VOTING_VERIFIERS)) {
    console.log(`  Fetching verifiers for ${chainName}...`);
    const chainVerifiers = await getChainVerifiers(chainName);

    for (const v of chainVerifiers) {
      if (verifierMap.has(v.address)) {
        verifierMap.get(v.address)!.chains.push(chainName);
      } else {
        verifierMap.set(v.address, v);
      }
    }
  }

  return Array.from(verifierMap.values());
}

// Get rewards pool info for a chain
async function getRewardsPoolInfo(chainName: string, contract: string): Promise<{
  currentEpoch: number;
  lastDistributionEpoch: number;
  rewardsPerEpoch: number;
} | null> {
  const result = await queryContract(REWARDS_CONTRACT, {
    rewards_pool: {
      pool_id: { chain_name: chainName, contract }
    }
  });

  if (!result) return null;

  return {
    currentEpoch: parseInt(result.current_epoch_num),
    lastDistributionEpoch: result.last_distribution_epoch ? parseInt(result.last_distribution_epoch) : 0,
    rewardsPerEpoch: parseInt(result.rewards_per_epoch) / 1e6
  };
}

// Find latest poll ID using binary search
async function findLatestPollId(votingVerifier: string): Promise<number> {
  let low = 1;
  let high = 10000;
  let lastValid = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const result = await queryContract(votingVerifier, { poll: { poll_id: mid.toString() } });
    if (result?.poll) {
      lastValid = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return lastValid;
}

// Get poll details including block height
async function getPollDetails(votingVerifier: string, pollId: number): Promise<{
  pollId: number;
  expiresAt: number;
  participation: Record<string, { voted: boolean }>;
} | null> {
  const result = await queryContract(votingVerifier, { poll: { poll_id: pollId.toString() } });
  if (!result?.poll) return null;

  return {
    pollId,
    expiresAt: result.poll.expires_at,
    participation: result.poll.participation
  };
}

// Get verifier's performance for unpaid epochs on a chain
async function getVerifierChainPerformance(
  verifierAddress: string,
  chainName: string,
  votingVerifier: string,
  unpaidEpochs: number[],
  currentBlock: number,
  currentEpoch: number
): Promise<EpochPerformance[]> {
  const performance: EpochPerformance[] = [];

  // Find latest poll
  const latestPollId = await findLatestPollId(votingVerifier);
  console.log(`    Latest poll ID: ${latestPollId}`);

  // Get the latest poll's expires_at to establish a reference point
  const latestPoll = await getPollDetails(votingVerifier, latestPollId);
  if (!latestPoll) {
    console.log(`    Could not get latest poll details`);
    return performance;
  }

  // The latest poll's expires_at is close to current block
  // We can estimate: current epoch started at approximately currentBlock - (currentBlock % EPOCH_DURATION)
  const currentEpochStartBlock = currentBlock - (currentBlock % EPOCH_DURATION);

  console.log(`    Current block: ${currentBlock}`);
  console.log(`    Current epoch ${currentEpoch} started ~block ${currentEpochStartBlock}`);

  // Build epoch -> block range mapping
  const epochRanges = new Map<number, { start: number; end: number }>();
  for (const epoch of unpaidEpochs) {
    const epochsBack = currentEpoch - epoch;
    const epochStart = currentEpochStartBlock - (epochsBack * EPOCH_DURATION);
    const epochEnd = epochStart + EPOCH_DURATION - 1;
    epochRanges.set(epoch, { start: epochStart, end: epochEnd });
  }

  // Initialize epoch stats
  const epochPolls = new Map<number, { total: number; voted: number }>();
  for (const epoch of unpaidEpochs) {
    epochPolls.set(epoch, { total: 0, voted: 0 });
  }

  // Scan polls and map to epochs based on expires_at block height
  console.log(`    Scanning polls ${Math.max(1, latestPollId - 500)} to ${latestPollId}...`);

  let pollsScanned = 0;
  let pollsMapped = 0;

  for (let pollId = latestPollId; pollId >= Math.max(1, latestPollId - 500); pollId--) {
    const poll = await getPollDetails(votingVerifier, pollId);
    if (!poll) continue;

    pollsScanned++;

    // Find which epoch this poll belongs to based on expires_at
    for (const [epoch, range] of epochRanges) {
      if (poll.expiresAt >= range.start && poll.expiresAt <= range.end) {
        const stats = epochPolls.get(epoch)!;
        stats.total++;
        if (poll.participation[verifierAddress]?.voted) {
          stats.voted++;
        }
        pollsMapped++;
        break;
      }
    }
  }

  console.log(`    Scanned ${pollsScanned} polls, mapped ${pollsMapped} to unpaid epochs`);

  // Build performance array
  for (const epoch of unpaidEpochs) {
    const stats = epochPolls.get(epoch) || { total: 0, voted: 0 };
    const range = epochRanges.get(epoch)!;
    const rate = stats.total > 0 ? (stats.voted / stats.total) * 100 : 0;

    performance.push({
      epochNum: epoch,
      startBlock: range.start,
      endBlock: range.end,
      pollsInEpoch: stats.total,
      pollsVoted: stats.voted,
      participationRate: rate,
      qualified: stats.total > 0 ? rate >= 80 : false // Can't qualify if no polls
    });
  }

  return performance;
}

async function main() {
  const verifierAddress = process.argv[2];

  console.log('='.repeat(70));
  console.log('VERIFIER EXPLORER - DATA PROTOTYPE');
  console.log('='.repeat(70));
  console.log('');

  AXELAR_LCD = await findWorkingEndpoint();
  console.log(`Connected to: ${AXELAR_LCD}\n`);

  const currentBlock = await getCurrentBlockHeight();
  console.log(`Current block: ${currentBlock}\n`);

  // Step 1: Get all verifiers
  console.log('Step 1: Fetching all verifiers...');
  const allVerifiers = await getAllVerifiers();
  console.log(`Found ${allVerifiers.length} verifiers\n`);

  // Display verifier list
  console.log('─'.repeat(70));
  console.log('ALL VERIFIERS');
  console.log('─'.repeat(70));
  for (const v of allVerifiers) {
    const bonded = (parseInt(v.bondedAmount) / 1e6).toFixed(0);
    console.log(`${v.address} | ${bonded} AXL | Chains: ${v.chains.join(', ')}`);
  }

  // If specific verifier requested, show detailed view
  if (verifierAddress) {
    console.log('\n');
    console.log('='.repeat(70));
    console.log(`DETAILED VIEW: ${verifierAddress}`);
    console.log('='.repeat(70));

    const verifier = allVerifiers.find(v => v.address === verifierAddress);
    if (!verifier) {
      console.log('Verifier not found in active verifiers list.');
      return;
    }

    for (const chainName of verifier.chains) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`CHAIN: ${chainName.toUpperCase()}`);
      console.log('─'.repeat(50));

      const votingVerifier = VOTING_VERIFIERS[chainName];
      if (!votingVerifier) {
        console.log('  VotingVerifier not configured');
        continue;
      }

      // Get pool info
      const poolInfo = await getRewardsPoolInfo(chainName, votingVerifier);
      if (!poolInfo) {
        console.log('  Rewards pool not found');
        continue;
      }

      const unpaidEpochs: number[] = [];
      for (let e = poolInfo.lastDistributionEpoch + 1; e <= poolInfo.currentEpoch; e++) {
        unpaidEpochs.push(e);
      }

      console.log(`  Current Epoch: ${poolInfo.currentEpoch}`);
      console.log(`  Last Distribution: Epoch ${poolInfo.lastDistributionEpoch}`);
      console.log(`  Unpaid Epochs: ${unpaidEpochs.length} (${unpaidEpochs[0] || 'N/A'} - ${unpaidEpochs[unpaidEpochs.length - 1] || 'N/A'})`);
      console.log(`  Rewards/Epoch: ${poolInfo.rewardsPerEpoch} AXL`);

      if (unpaidEpochs.length > 0) {
        console.log('\n  Epoch Performance:');
        console.log('  Epoch  │ Polls │ Voted │ Rate   │ Qualified');
        console.log('  ───────┼───────┼───────┼────────┼──────────');

        const performance = await getVerifierChainPerformance(
          verifierAddress,
          chainName,
          votingVerifier,
          unpaidEpochs.slice(-10), // Last 10 unpaid epochs
          currentBlock,
          poolInfo.currentEpoch
        );

        for (const p of performance) {
          const epoch = p.epochNum.toString().padEnd(6);
          const polls = p.pollsInEpoch.toString().padEnd(5);
          const voted = p.pollsVoted.toString().padEnd(5);
          const rate = p.participationRate > 0 ? `${p.participationRate.toFixed(1)}%`.padEnd(6) : 'N/A'.padEnd(6);
          const qualified = p.qualified ? '✓ Yes' : '✗ No';
          console.log(`  ${epoch} │ ${polls} │ ${voted} │ ${rate} │ ${qualified}`);
        }
      }
    }
  }

  console.log('\n');
}

main().catch(console.error);
