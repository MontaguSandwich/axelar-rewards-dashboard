/**
 * Script to analyze reward distributions since the Dec 12, 2025 parameter update
 * Verifies that new 3,424.66 AXL per epoch is being distributed correctly
 */

const LCD_ENDPOINTS = [
  'https://axelar-api.polkachu.com',
  'https://api-axelar.cosmos-spaces.cloud',
  'https://axelar-rest.publicnode.com',
  'https://lcd-axelar.imperator.co',
];

let AXELAR_LCD = LCD_ENDPOINTS[0];
const REWARDS_CONTRACT = 'axelar1harq5xe68lzl2kx4e5ch4k8840cgqnry567g0fgw7vt2atcuugrqfa7j5z';

// Dec 12, 2025 parameter update date
const PARAM_UPDATE_DATE = new Date('2025-12-12T00:00:00Z');
const EXPECTED_REWARDS_PER_EPOCH = 3424.66; // AXL

interface RewardEntry {
  verifier_address: string;
  proxy_address: string | null;
  amount: string;
}

interface DistributionEvent {
  txHash: string;
  timestamp: Date;
  blockHeight: number;
  chainName: string;
  poolContract: string;
  poolType: 'voting' | 'signing';
  epochsProcessed: number[];
  rewards: RewardEntry[];
  totalDistributed: number;
  verifierCount: number;
  perEpochTotal: number;
  perVerifierPerEpoch: number;
}

async function findWorkingEndpoint(): Promise<string> {
  for (const endpoint of LCD_ENDPOINTS) {
    try {
      console.log(`Trying endpoint: ${endpoint}...`);
      const response = await fetch(`${endpoint}/cosmos/base/tendermint/v1beta1/blocks/latest`, {
        signal: AbortSignal.timeout(10000)
      });
      if (response.ok) {
        console.log(`Connected to ${endpoint}\n`);
        return endpoint;
      }
    } catch (e) {
      console.log(`Failed: ${endpoint}`);
    }
  }
  throw new Error('All LCD endpoints failed.');
}

async function queryRewardTransactions(limit: number = 100, offset: number = 0): Promise<any[]> {
  const url = `${AXELAR_LCD}/cosmos/tx/v1beta1/txs?events=execute._contract_address%3D%27${REWARDS_CONTRACT}%27&pagination.limit=${limit}&pagination.offset=${offset}&order_by=ORDER_BY_DESC`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      console.log(`Query failed: ${response.status}`);
      return [];
    }
    const data = await response.json();
    return data.tx_responses || [];
  } catch (e) {
    console.log(`Error querying transactions: ${e}`);
    return [];
  }
}

function parseDistributionTx(tx: any): DistributionEvent | null {
  try {
    const timestamp = new Date(tx.timestamp);
    const blockHeight = parseInt(tx.height);
    const txHash = tx.txhash;

    // Find the distribute_rewards message
    const messages = tx.tx?.body?.messages || [];
    const distributeMsg = messages.find((m: any) =>
      m['@type'] === '/cosmwasm.wasm.v1.MsgExecuteContract' &&
      m.msg?.distribute_rewards
    );

    if (!distributeMsg) return null;

    const poolId = distributeMsg.msg.distribute_rewards.pool_id;
    const chainName = poolId.chain_name;
    const poolContract = poolId.contract;

    // Determine pool type based on contract
    const isGlobalMultisig = poolContract === 'axelar14a4ar5jh7ue4wg28jwsspf23r8k68j7g5d6d3fsttrhp42ajn4xq6zayy5';
    const poolType = isGlobalMultisig ? 'signing' : 'voting';

    // Parse events for rewards data
    let epochsProcessed: number[] = [];
    let rewards: RewardEntry[] = [];

    const events = tx.events || [];
    for (const event of events) {
      if (event.type === 'wasm-rewards_distributed') {
        for (const attr of event.attributes || []) {
          if (attr.key === 'epochs_processed') {
            try {
              epochsProcessed = JSON.parse(attr.value);
            } catch (e) {}
          }
          if (attr.key === 'rewards') {
            try {
              rewards = JSON.parse(attr.value);
            } catch (e) {}
          }
        }
      }
    }

    if (epochsProcessed.length === 0 || rewards.length === 0) return null;

    // Calculate totals
    const totalDistributed = rewards.reduce((sum, r) => sum + parseInt(r.amount), 0) / 1e6;
    const verifierCount = rewards.length;
    const epochCount = epochsProcessed.length;
    const perEpochTotal = totalDistributed / epochCount;
    const perVerifierPerEpoch = perEpochTotal / verifierCount;

    return {
      txHash,
      timestamp,
      blockHeight,
      chainName,
      poolContract,
      poolType,
      epochsProcessed,
      rewards,
      totalDistributed,
      verifierCount,
      perEpochTotal,
      perVerifierPerEpoch,
    };
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('REWARD DISTRIBUTION ANALYSIS');
  console.log('Analyzing distributions since Dec 12, 2025 parameter update');
  console.log('='.repeat(80));
  console.log('');

  AXELAR_LCD = await findWorkingEndpoint();

  console.log('Fetching recent reward distribution transactions...\n');

  // Fetch transactions in batches
  const allDistributions: DistributionEvent[] = [];
  let offset = 0;
  const batchSize = 100;
  let keepFetching = true;

  while (keepFetching && offset < 500) {
    const txs = await queryRewardTransactions(batchSize, offset);

    if (txs.length === 0) {
      keepFetching = false;
      break;
    }

    for (const tx of txs) {
      const distribution = parseDistributionTx(tx);
      if (distribution) {
        allDistributions.push(distribution);
      }
    }

    // Check if we've gone past our date range
    const oldestTx = txs[txs.length - 1];
    if (oldestTx && new Date(oldestTx.timestamp) < new Date('2025-12-01')) {
      keepFetching = false;
    }

    offset += batchSize;
    console.log(`Fetched ${offset} transactions, found ${allDistributions.length} distributions...`);
  }

  console.log(`\nTotal distributions found: ${allDistributions.length}\n`);

  // Separate pre and post update distributions
  const postUpdate = allDistributions.filter(d => d.timestamp >= PARAM_UPDATE_DATE);
  const preUpdate = allDistributions.filter(d => d.timestamp < PARAM_UPDATE_DATE);

  console.log('='.repeat(80));
  console.log('POST-UPDATE DISTRIBUTIONS (After Dec 12, 2025)');
  console.log('='.repeat(80));
  console.log(`Expected rewards per epoch: ${EXPECTED_REWARDS_PER_EPOCH} AXL\n`);

  if (postUpdate.length === 0) {
    console.log('No post-update distributions found yet.');
    console.log('This could mean:');
    console.log('  1. No rewards have been claimed since the update');
    console.log('  2. The epochs being claimed are still pre-update epochs\n');
  } else {
    // Group by chain and pool type
    const byChainPool = new Map<string, DistributionEvent[]>();
    for (const d of postUpdate) {
      const key = `${d.chainName}|${d.poolType}`;
      if (!byChainPool.has(key)) byChainPool.set(key, []);
      byChainPool.get(key)!.push(d);
    }

    console.log('Chain            | Pool    | Distributions | Avg/Epoch | Expected | Match?');
    console.log('-'.repeat(80));

    for (const [key, distributions] of byChainPool) {
      const [chain, poolType] = key.split('|');
      const avgPerEpoch = distributions.reduce((sum, d) => sum + d.perEpochTotal, 0) / distributions.length;
      const matchesExpected = Math.abs(avgPerEpoch - EXPECTED_REWARDS_PER_EPOCH) < 100; // Within 100 AXL tolerance

      console.log(
        `${chain.padEnd(16)} | ${poolType.padEnd(7)} | ${distributions.length.toString().padEnd(13)} | ` +
        `${avgPerEpoch.toFixed(2).padStart(9)} | ${EXPECTED_REWARDS_PER_EPOCH.toFixed(2).padStart(8)} | ${matchesExpected ? 'YES' : 'NO'}`
      );
    }
  }

  // Show detailed recent distributions
  console.log('\n');
  console.log('='.repeat(80));
  console.log('RECENT DISTRIBUTION DETAILS');
  console.log('='.repeat(80));

  const recentDistributions = allDistributions.slice(0, 20);

  for (const d of recentDistributions) {
    const isPostUpdate = d.timestamp >= PARAM_UPDATE_DATE;
    const epochRange = d.epochsProcessed.length > 0
      ? `${d.epochsProcessed[0]}-${d.epochsProcessed[d.epochsProcessed.length - 1]}`
      : 'N/A';

    console.log(`\n${d.timestamp.toISOString().split('T')[0]} | ${d.chainName} | ${d.poolType}`);
    console.log(`  TX: ${d.txHash.slice(0, 20)}...`);
    console.log(`  Epochs: ${epochRange} (${d.epochsProcessed.length} epochs)`);
    console.log(`  Verifiers: ${d.verifierCount}`);
    console.log(`  Total distributed: ${d.totalDistributed.toFixed(2)} AXL`);
    console.log(`  Per epoch (total): ${d.perEpochTotal.toFixed(2)} AXL ${isPostUpdate ? '(POST-UPDATE)' : '(PRE-UPDATE)'}`);
    console.log(`  Per verifier/epoch: ${d.perVerifierPerEpoch.toFixed(2)} AXL`);

    if (isPostUpdate) {
      const diff = d.perEpochTotal - EXPECTED_REWARDS_PER_EPOCH;
      const pctDiff = (diff / EXPECTED_REWARDS_PER_EPOCH) * 100;
      console.log(`  vs Expected: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} AXL (${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(1)}%)`);
    }
  }

  // Summary statistics
  console.log('\n');
  console.log('='.repeat(80));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(80));

  if (postUpdate.length > 0) {
    const votingDists = postUpdate.filter(d => d.poolType === 'voting');
    const signingDists = postUpdate.filter(d => d.poolType === 'signing');

    if (votingDists.length > 0) {
      const avgVoting = votingDists.reduce((sum, d) => sum + d.perEpochTotal, 0) / votingDists.length;
      console.log(`\nVoting pools (${votingDists.length} distributions):`);
      console.log(`  Average per epoch: ${avgVoting.toFixed(2)} AXL`);
      console.log(`  Expected: ${EXPECTED_REWARDS_PER_EPOCH} AXL`);
      console.log(`  Difference: ${(avgVoting - EXPECTED_REWARDS_PER_EPOCH).toFixed(2)} AXL`);
    }

    if (signingDists.length > 0) {
      const avgSigning = signingDists.reduce((sum, d) => sum + d.perEpochTotal, 0) / signingDists.length;
      console.log(`\nSigning pools (${signingDists.length} distributions):`);
      console.log(`  Average per epoch: ${avgSigning.toFixed(2)} AXL`);
      console.log(`  Expected: ${EXPECTED_REWARDS_PER_EPOCH} AXL`);
      console.log(`  Difference: ${(avgSigning - EXPECTED_REWARDS_PER_EPOCH).toFixed(2)} AXL`);
    }
  }

  console.log('\n');
  console.log('='.repeat(80));
  console.log('IMPORTANT NOTES');
  console.log('='.repeat(80));
  console.log(`
1. The parameter update on Dec 12, 2025 set rewards_per_epoch to 3,424.66 AXL
2. Distributions AFTER Dec 12 may still claim PRE-UPDATE epochs
3. To see new rates in action, look for epochs numbered AFTER the update
4. The epoch number when params changed can be found in the governance proposal

To find the exact epoch when params changed:
- Check governance proposal for the update
- Or query: rewards_pool for current_epoch_num at that block height
`);
}

main().catch(console.error);
