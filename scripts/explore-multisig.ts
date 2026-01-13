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
  console.log('TRYING DISCOVERED QUERIES WITH PARAMS');
  console.log('─'.repeat(70));

  // Based on typical multisig patterns, try these
  const detailedQueries = [
    // Key-related
    { get_key: { key_id: "1" } },
    { key: { key_id: "1" } },

    // Session-related
    { get_signing_session: { session_id: "1" } },
    { signing_session: { session_id: "1" } },
    { session: { id: "1" } },

    // Multisig state
    { get_multisig: { session_id: "1" } },
    { multisig: { session_id: "1" } },
  ];

  for (const query of detailedQueries) {
    await tryQuery(GLOBAL_MULTISIG, query, Object.keys(query)[0]);
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
