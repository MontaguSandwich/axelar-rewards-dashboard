/**
 * Query verifier contributions/participation from the Rewards contract
 *
 * The rewards contract tracks participation per verifier per epoch.
 * This script queries that data directly.
 */

const LCD_ENDPOINTS = [
  'https://axelar-api.polkachu.com',
  'https://api-axelar.cosmos-spaces.cloud',
  'https://axelar-rest.publicnode.com',
];

let AXELAR_LCD = LCD_ENDPOINTS[0];

const REWARDS_CONTRACT = 'axelar1harq5xe68lzl2kx4e5ch4k8840cgqnry567g0fgw7vt2atcuugrqfa7j5z';
const GLOBAL_MULTISIG = 'axelar14a4ar5jh7ue4wg28jwsspf23r8k68j7g5d6d3fsttrhp42ajn4xq6zayy5';

// Sample VotingVerifier for Flow
const FLOW_VOTING_VERIFIER = 'axelar1m4semgh98pk8dp3lgfv8ul47x7fwt0ynqapek9fy0szhmc36l3aqhz47vu';

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
    throw new Error(`Query failed (${response.status}): ${text}`);
  }

  const result = await response.json();
  return result.data;
}

async function tryQuery(contract: string, query: object, description: string): Promise<any> {
  try {
    console.log(`Querying: ${description}`);
    console.log(`  Query: ${JSON.stringify(query)}`);
    const result = await queryContract(contract, query);
    console.log(`  Result: ${JSON.stringify(result, null, 2).slice(0, 500)}...`);
    return result;
  } catch (e: any) {
    console.log(`  Error: ${e.message.slice(0, 200)}`);
    return null;
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('REWARDS CONTRACT QUERY EXPLORER');
  console.log('='.repeat(80));
  console.log('');

  AXELAR_LCD = await findWorkingEndpoint();

  // 1. Query rewards pool for Flow voting
  console.log('\n' + '─'.repeat(60));
  console.log('1. REWARDS POOL - Flow Voting');
  console.log('─'.repeat(60));

  const flowVotingPool = await tryQuery(REWARDS_CONTRACT, {
    rewards_pool: {
      pool_id: {
        chain_name: 'flow',
        contract: FLOW_VOTING_VERIFIER
      }
    }
  }, 'Flow voting pool');

  // 2. Query rewards pool for Flow signing (global multisig)
  console.log('\n' + '─'.repeat(60));
  console.log('2. REWARDS POOL - Flow Signing (Global Multisig)');
  console.log('─'.repeat(60));

  const flowSigningPool = await tryQuery(REWARDS_CONTRACT, {
    rewards_pool: {
      pool_id: {
        chain_name: 'flow',
        contract: GLOBAL_MULTISIG
      }
    }
  }, 'Flow signing pool');

  // 3. Try to query verifier participation/tally
  console.log('\n' + '─'.repeat(60));
  console.log('3. EXPLORING PARTICIPATION QUERIES');
  console.log('─'.repeat(60));

  // Try various query formats that might exist
  const participationQueries = [
    { epoch_tally: { pool_id: { chain_name: 'flow', contract: FLOW_VOTING_VERIFIER }, epoch_num: 500 } },
    { tally: { pool_id: { chain_name: 'flow', contract: FLOW_VOTING_VERIFIER }, epoch_num: 500 } },
    { verifier_participation: { pool_id: { chain_name: 'flow', contract: FLOW_VOTING_VERIFIER } } },
    { participation: { pool_id: { chain_name: 'flow', contract: FLOW_VOTING_VERIFIER } } },
    { rewards_by_verifier: { pool_id: { chain_name: 'flow', contract: FLOW_VOTING_VERIFIER } } },
    { pending_rewards: { pool_id: { chain_name: 'flow', contract: FLOW_VOTING_VERIFIER } } },
  ];

  for (const query of participationQueries) {
    await tryQuery(REWARDS_CONTRACT, query, Object.keys(query)[0]);
    console.log('');
  }

  // 4. Query the VotingVerifier contract directly for poll data
  console.log('\n' + '─'.repeat(60));
  console.log('4. VOTING VERIFIER CONTRACT - Direct Queries');
  console.log('─'.repeat(60));

  const votingVerifierQueries = [
    { current_poll: {} },
    { poll: { poll_id: '1' } },
    { polls: { start_after: null, limit: 10 } },
    { verifier_set: {} },
    { config: {} },
  ];

  for (const query of votingVerifierQueries) {
    await tryQuery(FLOW_VOTING_VERIFIER, query, Object.keys(query)[0]);
    console.log('');
  }

  // 5. Query Service Registry for verifier info
  console.log('\n' + '─'.repeat(60));
  console.log('5. SERVICE REGISTRY - Active Verifiers');
  console.log('─'.repeat(60));

  const SERVICE_REGISTRY = 'axelar1rpj2jjrv3vpugx9ake9kgk3s2kgwt0y60wtkmcgfml5m3et0mrls6nct9m';

  await tryQuery(SERVICE_REGISTRY, {
    active_verifiers: {
      service_name: 'amplifier',
      chain_name: 'flow'
    }
  }, 'Active verifiers for Flow');

  // 6. Summary of what we found
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  if (flowVotingPool) {
    console.log('\nFlow Voting Pool:');
    console.log(`  Current Epoch: ${flowVotingPool.current_epoch_num}`);
    console.log(`  Rewards/Epoch: ${parseInt(flowVotingPool.params?.rewards_per_epoch || '0') / 1e6} AXL`);
    console.log(`  Epoch Duration: ${flowVotingPool.params?.epoch_duration} blocks`);
    console.log(`  Last Distribution: Epoch ${flowVotingPool.last_distribution_epoch || 'N/A'}`);
    console.log(`  Pool Balance: ${parseInt(flowVotingPool.balance || '0') / 1e6} AXL`);
  }

  if (flowSigningPool) {
    console.log('\nFlow Signing Pool:');
    console.log(`  Current Epoch: ${flowSigningPool.current_epoch_num}`);
    console.log(`  Rewards/Epoch: ${parseInt(flowSigningPool.params?.rewards_per_epoch || '0') / 1e6} AXL`);
    console.log(`  Epoch Duration: ${flowSigningPool.params?.epoch_duration} blocks`);
    console.log(`  Last Distribution: Epoch ${flowSigningPool.last_distribution_epoch || 'N/A'}`);
    console.log(`  Pool Balance: ${parseInt(flowSigningPool.balance || '0') / 1e6} AXL`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log('To track post-update rewards:');
  console.log('─'.repeat(60));
  console.log(`
1. Note the current epoch number from above
2. Find the epoch number when Dec 12 param update occurred
3. For epochs AFTER the update, rewards_per_epoch should be 3,424.66 AXL
4. The 'last_distribution_epoch' shows the most recently claimed epoch
5. Epochs between last_distribution and current_epoch are pending
`);
}

main().catch(console.error);
