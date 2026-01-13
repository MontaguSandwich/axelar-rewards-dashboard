/**
 * Analyze specific reward distribution transactions
 *
 * Usage:
 *   npx tsx scripts/analyze-tx.ts <txhash>
 *   npx tsx scripts/analyze-tx.ts <txhash1> <txhash2> ...
 *
 * Or paste a full transaction JSON and pipe it:
 *   echo '<json>' | npx tsx scripts/analyze-tx.ts --stdin
 */

const LCD_ENDPOINTS = [
  'https://axelar-api.polkachu.com',
  'https://api-axelar.cosmos-spaces.cloud',
  'https://axelar-rest.publicnode.com',
];

let AXELAR_LCD = LCD_ENDPOINTS[0];
const EXPECTED_REWARDS_PER_EPOCH = 3424.66;
const GLOBAL_MULTISIG = 'axelar14a4ar5jh7ue4wg28jwsspf23r8k68j7g5d6d3fsttrhp42ajn4xq6zayy5';

interface RewardEntry {
  verifier_address: string;
  proxy_address: string | null;
  amount: string;
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

async function fetchTx(txHash: string): Promise<any> {
  const url = `${AXELAR_LCD}/cosmos/tx/v1beta1/txs/${txHash}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Failed to fetch tx: ${response.status}`);
  const data = await response.json();
  return data.tx_response;
}

function analyzeTx(tx: any): void {
  console.log('\n' + '='.repeat(80));
  console.log('TRANSACTION ANALYSIS');
  console.log('='.repeat(80));

  const timestamp = tx.timestamp;
  const height = tx.height;
  const txHash = tx.txhash;

  console.log(`\nTx Hash: ${txHash}`);
  console.log(`Block: ${height}`);
  console.log(`Time: ${timestamp}`);

  // Get the distribute_rewards message
  const messages = tx.tx?.body?.messages || [];
  const distributeMsg = messages.find((m: any) => m.msg?.distribute_rewards);

  if (!distributeMsg) {
    console.log('\nNo distribute_rewards message found in this transaction.');
    return;
  }

  const poolId = distributeMsg.msg.distribute_rewards.pool_id;
  const chainName = poolId.chain_name;
  const poolContract = poolId.contract;
  const isSigningPool = poolContract === GLOBAL_MULTISIG;

  console.log(`\nChain: ${chainName}`);
  console.log(`Pool Type: ${isSigningPool ? 'SIGNING (Global Multisig)' : 'VOTING (VotingVerifier)'}`);
  console.log(`Contract: ${poolContract}`);

  // Parse events
  let epochsProcessed: number[] = [];
  let rewards: RewardEntry[] = [];

  const events = tx.events || [];
  for (const event of events) {
    if (event.type === 'wasm-rewards_distributed') {
      for (const attr of event.attributes || []) {
        if (attr.key === 'epochs_processed') {
          try { epochsProcessed = JSON.parse(attr.value); } catch (e) {}
        }
        if (attr.key === 'rewards') {
          try { rewards = JSON.parse(attr.value); } catch (e) {}
        }
      }
    }
  }

  if (epochsProcessed.length === 0) {
    console.log('\nNo epochs_processed data found.');
    return;
  }

  const epochRange = `${epochsProcessed[0]} - ${epochsProcessed[epochsProcessed.length - 1]}`;
  console.log(`\nEpochs Processed: ${epochRange} (${epochsProcessed.length} epochs)`);

  // Analyze rewards
  if (rewards.length === 0) {
    console.log('No rewards data found.');
    return;
  }

  const amounts = rewards.map(r => parseInt(r.amount) / 1e6);
  const totalDistributed = amounts.reduce((sum, a) => sum + a, 0);
  const verifierCount = rewards.length;
  const minAmount = Math.min(...amounts);
  const maxAmount = Math.max(...amounts);
  const avgAmount = totalDistributed / verifierCount;

  console.log(`\n${'─'.repeat(40)}`);
  console.log('REWARD DISTRIBUTION SUMMARY');
  console.log(`${'─'.repeat(40)}`);
  console.log(`Qualifying Verifiers: ${verifierCount}`);
  console.log(`Total Distributed: ${totalDistributed.toFixed(2)} AXL`);
  console.log(`Min per verifier: ${minAmount.toFixed(2)} AXL`);
  console.log(`Max per verifier: ${maxAmount.toFixed(2)} AXL`);
  console.log(`Avg per verifier: ${avgAmount.toFixed(2)} AXL`);

  // Per-epoch analysis
  const perEpochTotal = totalDistributed / epochsProcessed.length;
  const perVerifierPerEpoch = avgAmount / epochsProcessed.length;

  console.log(`\n${'─'.repeat(40)}`);
  console.log('PER-EPOCH ANALYSIS');
  console.log(`${'─'.repeat(40)}`);
  console.log(`Total pool rewards per epoch: ${perEpochTotal.toFixed(2)} AXL`);
  console.log(`Expected per epoch (post-update): ${EXPECTED_REWARDS_PER_EPOCH} AXL`);
  console.log(`Difference: ${(perEpochTotal - EXPECTED_REWARDS_PER_EPOCH).toFixed(2)} AXL`);
  console.log(`\nAvg per verifier per epoch: ${perVerifierPerEpoch.toFixed(2)} AXL`);

  // Participation analysis
  if (minAmount !== maxAmount) {
    console.log(`\n${'─'.repeat(40)}`);
    console.log('PARTICIPATION VARIANCE');
    console.log(`${'─'.repeat(40)}`);
    console.log('Rewards vary per verifier, indicating different participation rates:');

    // Group by amount
    const amountGroups = new Map<number, number>();
    for (const amt of amounts) {
      const rounded = Math.round(amt * 100) / 100;
      amountGroups.set(rounded, (amountGroups.get(rounded) || 0) + 1);
    }

    const sortedGroups = [...amountGroups.entries()].sort((a, b) => b[0] - a[0]);
    const maxAmt = sortedGroups[0][0];

    console.log('\nAmount (AXL)     | Count | Est. Epochs Qualified');
    console.log('-'.repeat(50));
    for (const [amt, count] of sortedGroups) {
      const estEpochs = Math.round((amt / maxAmt) * epochsProcessed.length);
      const pct = ((amt / maxAmt) * 100).toFixed(0);
      console.log(`${amt.toFixed(2).padStart(14)} | ${count.toString().padStart(5)} | ${estEpochs}/${epochsProcessed.length} (${pct}%)`);
    }
  } else {
    console.log(`\nAll ${verifierCount} verifiers received equal rewards (100% participation).`);
  }

  // Detailed verifier list
  console.log(`\n${'─'.repeat(40)}`);
  console.log('VERIFIER REWARDS (sorted by amount)');
  console.log(`${'─'.repeat(40)}`);

  const sortedRewards = [...rewards].sort((a, b) => parseInt(b.amount) - parseInt(a.amount));

  console.log('Verifier Address                                    | Amount (AXL)');
  console.log('-'.repeat(70));
  for (const r of sortedRewards.slice(0, 10)) {
    const amt = (parseInt(r.amount) / 1e6).toFixed(2);
    console.log(`${r.verifier_address} | ${amt.padStart(12)}`);
  }
  if (sortedRewards.length > 10) {
    console.log(`... and ${sortedRewards.length - 10} more verifiers`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--stdin')) {
    // Read from stdin
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      input += chunk;
    }
    const tx = JSON.parse(input);
    analyzeTx(tx);
    return;
  }

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  npx tsx scripts/analyze-tx.ts <txhash>');
    console.log('  npx tsx scripts/analyze-tx.ts <txhash1> <txhash2> ...');
    console.log('  echo \'<json>\' | npx tsx scripts/analyze-tx.ts --stdin');
    console.log('\nExample:');
    console.log('  npx tsx scripts/analyze-tx.ts 021D5695C328352998AD78D38056E5A6EACDEAD90D9570F59FBE536FECB1E75D');
    return;
  }

  console.log('Finding working endpoint...');
  AXELAR_LCD = await findWorkingEndpoint();
  console.log(`Using: ${AXELAR_LCD}`);

  for (const txHash of args) {
    try {
      console.log(`\nFetching transaction ${txHash.slice(0, 20)}...`);
      const tx = await fetchTx(txHash);
      analyzeTx(tx);
    } catch (e: any) {
      console.log(`Error fetching ${txHash}: ${e.message}`);
    }
  }
}

main().catch(console.error);
