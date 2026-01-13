/**
 * Multisig Contract Explorer
 *
 * Deep dive into the Global Multisig contract to understand
 * how signing sessions and participation are tracked.
 */

const LCD_ENDPOINTS = [
  'https://axelar-api.polkachu.com',
  'https://api-axelar.cosmos-spaces.cloud',
  'https://axelar-rest.publicnode.com',
];

let AXELAR_LCD = LCD_ENDPOINTS[0];

const GLOBAL_MULTISIG = 'axelar14a4ar5jh7ue4wg28jwsspf23r8k68j7g5d6d3fsttrhp42ajn4xq6zayy5';
const REWARDS_CONTRACT = 'axelar1harq5xe68lzl2kx4e5ch4k8840cgqnry567g0fgw7vt2atcuugrqfa7j5z';

async function findWorkingEndpoint(): Promise<string> {
  for (const endpoint of LCD_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/cosmos/base/tendermint/v1beta1/blocks/latest`, {
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        console.log(`Connected to ${endpoint}\n`);
        return endpoint;
      }
    } catch (e) {}
  }
  throw new Error('All endpoints failed');
}

async function queryContract(contract: string, query: object): Promise<any> {
  const queryBase64 = Buffer.from(JSON.stringify(query)).toString('base64');
  const url = `${AXELAR_LCD}/cosmwasm/wasm/v1/contract/${contract}/smart/${queryBase64}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const text = await response.text();
    return { error: text };
  }
  const result = await response.json();
  return result.data;
}

async function tryQuery(contract: string, query: object, name: string): Promise<any> {
  console.log(`\nQuerying: ${name}`);
  console.log(`  ${JSON.stringify(query)}`);

  const result = await queryContract(contract, query);

  if (result?.error) {
    // Parse error to extract expected variants
    const errorStr = result.error;
    const match = errorStr.match(/expected one of ([^:]+)/);
    if (match) {
      console.log(`  Expected variants: ${match[1]}`);
    } else {
      console.log(`  Error: ${errorStr.slice(0, 200)}`);
    }
    return null;
  }

  console.log(`  Result: ${JSON.stringify(result, null, 2).slice(0, 1000)}`);
  return result;
}

async function main() {
  console.log('='.repeat(70));
  console.log('MULTISIG CONTRACT EXPLORER');
  console.log('='.repeat(70));
  console.log(`\nContract: ${GLOBAL_MULTISIG}\n`);

  AXELAR_LCD = await findWorkingEndpoint();

  // Try common query patterns to discover available methods
  console.log('─'.repeat(70));
  console.log('DISCOVERING AVAILABLE QUERIES');
  console.log('─'.repeat(70));

  // These will likely fail but reveal available query methods
  const probeQueries = [
    { config: {} },
    { state: {} },
    { get_multisig: {} },
    { multisig: {} },
    { key: {} },
    { current_key: {} },
    { key_gen: {} },
    { signing_session: {} },
    { signing_sessions: {} },
    { session: { session_id: "1" } },
    { sessions: {} },
    { signer: {} },
    { signers: {} },
    { public_key: {} },
    { threshold: {} },
  ];

  for (const query of probeQueries) {
    await tryQuery(GLOBAL_MULTISIG, query, Object.keys(query)[0]);
  }

  // After discovering available queries, try them with proper params
  console.log('\n');
  console.log('─'.repeat(70));
  console.log('QUERYING DISCOVERED METHODS');
  console.log('─'.repeat(70));

  // Query verifier_set
  await tryQuery(GLOBAL_MULTISIG, { verifier_set: {} }, 'verifier_set');

  // Query signing_parameters
  await tryQuery(GLOBAL_MULTISIG, { signing_parameters: {} }, 'signing_parameters');

  // Query multiple multisig sessions to see the data structure
  console.log('\n\nMultisig Sessions:');
  for (const sessionId of ['1', '10', '50', '100', '500', '1000', '2000']) {
    const result = await queryContract(GLOBAL_MULTISIG, { multisig: { session_id: sessionId } });
    if (result && !result.error) {
      const state = result.state;
      const completedAt = state?.completed?.completed_at || state?.pending || 'unknown';
      const signerCount = Object.keys(result.verifier_set?.signers || {}).length;

      // Check if there's signature/participation data
      const signatures = result.signatures || result.sigs || null;
      const participants = result.participants || null;

      console.log(`  Session ${sessionId}:`);
      console.log(`    State: ${JSON.stringify(state).slice(0, 100)}`);
      console.log(`    Signers: ${signerCount}`);
      if (signatures) console.log(`    Signatures: ${JSON.stringify(signatures).slice(0, 100)}`);
      if (participants) console.log(`    Participants: ${JSON.stringify(participants).slice(0, 100)}`);

      // Print full result for first session to see structure
      if (sessionId === '1000') {
        console.log(`\n  Full session ${sessionId} data:`);
        console.log(JSON.stringify(result, null, 2).slice(0, 2000));
      }
    } else {
      console.log(`  Session ${sessionId}: Not found or error`);
    }
  }

  // Find latest session ID using binary search
  console.log('\n\nFinding latest session ID...');
  let low = 1;
  let high = 100000;
  let latestSession = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const result = await queryContract(GLOBAL_MULTISIG, { multisig: { session_id: mid.toString() } });
    if (result && !result.error) {
      latestSession = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  console.log(`  Latest session ID: ${latestSession}`);

  // Query recent sessions
  console.log('\n\nRecent Sessions:');
  for (let i = 0; i < 5; i++) {
    const sessionId = latestSession - i;
    const result = await queryContract(GLOBAL_MULTISIG, { multisig: { session_id: sessionId.toString() } });
    if (result && !result.error) {
      const completedAt = result.state?.completed?.completed_at;
      const signerCount = Object.keys(result.verifier_set?.signers || {}).length;
      console.log(`  Session ${sessionId}: completed_at=${completedAt}, signers=${signerCount}`);
    }
  }

  // Also check the rewards contract's verifier_participation for signing
  console.log('\n');
  console.log('─'.repeat(70));
  console.log('REWARDS CONTRACT - SIGNING PARTICIPATION');
  console.log('─'.repeat(70));

  // Get current epoch
  const poolInfo = await queryContract(REWARDS_CONTRACT, {
    rewards_pool: {
      pool_id: { chain_name: 'flow', contract: GLOBAL_MULTISIG }
    }
  });

  if (poolInfo && !poolInfo.error) {
    console.log('\nFlow Signing Pool Info:');
    console.log(`  Current Epoch: ${poolInfo.current_epoch_num}`);
    console.log(`  Last Distribution: ${poolInfo.last_distribution_epoch}`);
    console.log(`  Rewards/Epoch: ${parseInt(poolInfo.rewards_per_epoch) / 1e6} AXL`);

    const currentEpoch = parseInt(poolInfo.current_epoch_num);

    // Try verifier_participation for signing pool
    console.log('\nQuerying verifier_participation for recent epochs:');
    for (const offset of [0, -1, -5]) {
      const epoch = currentEpoch + offset;
      const result = await queryContract(REWARDS_CONTRACT, {
        verifier_participation: {
          pool_id: { chain_name: 'flow', contract: GLOBAL_MULTISIG },
          epoch_num: epoch
        }
      });
      console.log(`  Epoch ${epoch}: ${JSON.stringify(result)}`);
    }
  }

  console.log('\n');
  console.log('─'.repeat(70));
  console.log('SUMMARY');
  console.log('─'.repeat(70));
  console.log(`
Next steps based on findings:
1. If we found available query methods, use them to get signing session data
2. If verifier_participation returns data, we can track signing participation
3. Otherwise, we may need to scan transactions for signing events
`);
}

main().catch(console.error);
