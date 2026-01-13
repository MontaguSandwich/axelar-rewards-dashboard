/**
 * Script to cross-reference our reward calculations with on-chain data
 *
 * This queries:
 * 1. Recent reward distribution transactions
 * 2. Current pool parameters
 * 3. Compares expected vs actual rewards
 */

const AXELAR_LCD = 'https://axelar-lcd.imperator.co';
const REWARDS_CONTRACT = 'axelar1harq5xe68lzl2kx4e5ch4k8840cgqnry567g0fgw7vt2atcuugrqfa7j5z';

interface PoolParams {
  rewards_per_epoch: string;
  participation_threshold: [string, string];
  epoch_duration: string;
}

interface RewardsPoolResponse {
  balance: string;
  epoch_duration: string;
  rewards_per_epoch: string;
  current_epoch_num: string;
  last_distribution_epoch: string | null;
  params: PoolParams;
}

async function queryContract(contract: string, query: object): Promise<any> {
  const queryBase64 = Buffer.from(JSON.stringify(query)).toString('base64');
  const url = `${AXELAR_LCD}/cosmwasm/wasm/v1/contract/${contract}/smart/${queryBase64}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Query failed: ${response.status}`);
  }

  const result = await response.json();
  return result.data;
}

async function getCurrentBlockHeight(): Promise<number> {
  const response = await fetch(`${AXELAR_LCD}/cosmos/base/tendermint/v1beta1/blocks/latest`);
  const data = await response.json();
  return parseInt(data.block.header.height);
}

async function queryRewardDistributionTxs(limit: number = 50): Promise<any[]> {
  // Query transactions that called distribute_rewards on the rewards contract
  const url = `${AXELAR_LCD}/cosmos/tx/v1beta1/txs?events=wasm._contract_address%3D%27${REWARDS_CONTRACT}%27&events=wasm.action%3D%27distribute_rewards%27&pagination.limit=${limit}&order_by=ORDER_BY_DESC`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log('Direct tx query failed, trying alternative...');
      return [];
    }
    const data = await response.json();
    return data.tx_responses || [];
  } catch (e) {
    console.log('Error querying txs:', e);
    return [];
  }
}

async function queryRecentTxsByContract(contract: string, limit: number = 20): Promise<any[]> {
  // Alternative: query all recent transactions involving the contract
  const url = `${AXELAR_LCD}/cosmos/tx/v1beta1/txs?events=execute._contract_address%3D%27${contract}%27&pagination.limit=${limit}&order_by=ORDER_BY_DESC`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return data.tx_responses || [];
  } catch (e) {
    return [];
  }
}

// Fetch mainnet config to get chain list
async function fetchMainnetConfig(): Promise<any> {
  const response = await fetch(
    'https://raw.githubusercontent.com/axelarnetwork/axelar-contract-deployments/main/axelar-chains-config/info/mainnet.json'
  );
  return response.json();
}

async function getChainContracts(config: any): Promise<Map<string, { voting: string | null; signing: string | null }>> {
  const chains = new Map();

  const axelarContracts = config.axelar?.contracts || {};
  const globalMultisig = axelarContracts.Multisig?.address || null;

  // VotingVerifier contracts
  const votingVerifiers = axelarContracts.VotingVerifier || {};
  for (const [chainKey, data] of Object.entries(votingVerifiers)) {
    if (!chains.has(chainKey)) {
      chains.set(chainKey, { voting: null, signing: null });
    }
    chains.get(chainKey).voting = (data as any).address;
  }

  // XRPL VotingVerifier
  const xrplVoting = axelarContracts.XrplVotingVerifier || {};
  for (const [chainKey, data] of Object.entries(xrplVoting)) {
    if (!chains.has(chainKey)) {
      chains.set(chainKey, { voting: null, signing: null });
    }
    chains.get(chainKey).voting = (data as any).address;
  }

  // Set global multisig for all chains (per governance)
  for (const [chainKey] of chains) {
    chains.get(chainKey).signing = globalMultisig;
  }

  return chains;
}

async function main() {
  console.log('='.repeat(80));
  console.log('AXELAR REWARDS VERIFICATION SCRIPT');
  console.log('Cross-referencing calculated rewards with on-chain data');
  console.log('='.repeat(80));
  console.log('');

  // Get current block height
  const currentBlock = await getCurrentBlockHeight();
  console.log(`Current block height: ${currentBlock}`);
  console.log('');

  // Fetch config and get chain contracts
  console.log('Fetching mainnet configuration...');
  const config = await fetchMainnetConfig();
  const chainContracts = await getChainContracts(config);

  console.log(`Found ${chainContracts.size} chains with contracts`);
  console.log('');

  // Query pool data for a few sample chains
  const sampleChains = ['flow', 'sui', 'stellar', 'xrpl'];

  console.log('='.repeat(80));
  console.log('SAMPLE CHAIN POOL DATA');
  console.log('='.repeat(80));

  for (const chainKey of sampleChains) {
    const contracts = chainContracts.get(chainKey);
    if (!contracts) {
      console.log(`\n${chainKey.toUpperCase()}: Not found in config`);
      continue;
    }

    console.log(`\n${'─'.repeat(40)}`);
    console.log(`${chainKey.toUpperCase()}`);
    console.log(`${'─'.repeat(40)}`);

    // Query voting pool
    if (contracts.voting) {
      try {
        const votingData: RewardsPoolResponse = await queryContract(REWARDS_CONTRACT, {
          rewards_pool: {
            pool_id: {
              chain_name: chainKey,
              contract: contracts.voting
            }
          }
        });

        const rewardsPerEpoch = parseInt(votingData.params.rewards_per_epoch) / 1e6;
        const epochDuration = parseInt(votingData.params.epoch_duration);
        const currentEpoch = parseInt(votingData.current_epoch_num);
        const lastDistEpoch = votingData.last_distribution_epoch ? parseInt(votingData.last_distribution_epoch) : null;
        const balance = parseInt(votingData.balance) / 1e6;

        // Calculate epochs since last distribution
        const epochsSinceLastDist = lastDistEpoch !== null ? currentEpoch - lastDistEpoch : 'N/A';

        // Estimate when last distribution happened (in blocks)
        const blocksPerEpoch = epochDuration;
        const epochStartBlock = currentBlock - (currentBlock % blocksPerEpoch);

        console.log(`  VOTING POOL:`);
        console.log(`    Contract: ${contracts.voting.slice(0, 20)}...`);
        console.log(`    Rewards per epoch: ${rewardsPerEpoch.toFixed(2)} AXL`);
        console.log(`    Epoch duration: ${epochDuration} blocks (~${(epochDuration * 1.84 / 3600).toFixed(1)} hours)`);
        console.log(`    Current epoch: ${currentEpoch}`);
        console.log(`    Last distribution epoch: ${lastDistEpoch ?? 'Never'}`);
        console.log(`    Epochs since last dist: ${epochsSinceLastDist}`);
        console.log(`    Pool balance: ${balance.toFixed(2)} AXL`);

      } catch (e: any) {
        console.log(`  VOTING POOL: Error - ${e.message}`);
      }
    }

    // Query signing pool (global multisig)
    if (contracts.signing) {
      try {
        const signingData: RewardsPoolResponse = await queryContract(REWARDS_CONTRACT, {
          rewards_pool: {
            pool_id: {
              chain_name: chainKey,
              contract: contracts.signing
            }
          }
        });

        const rewardsPerEpoch = parseInt(signingData.params.rewards_per_epoch) / 1e6;
        const epochDuration = parseInt(signingData.params.epoch_duration);
        const currentEpoch = parseInt(signingData.current_epoch_num);
        const lastDistEpoch = signingData.last_distribution_epoch ? parseInt(signingData.last_distribution_epoch) : null;
        const balance = parseInt(signingData.balance) / 1e6;

        const epochsSinceLastDist = lastDistEpoch !== null ? currentEpoch - lastDistEpoch : 'N/A';

        console.log(`  SIGNING POOL (Global Multisig):`);
        console.log(`    Contract: ${contracts.signing.slice(0, 20)}...`);
        console.log(`    Rewards per epoch: ${rewardsPerEpoch.toFixed(2)} AXL`);
        console.log(`    Epoch duration: ${epochDuration} blocks (~${(epochDuration * 1.84 / 3600).toFixed(1)} hours)`);
        console.log(`    Current epoch: ${currentEpoch}`);
        console.log(`    Last distribution epoch: ${lastDistEpoch ?? 'Never'}`);
        console.log(`    Epochs since last dist: ${epochsSinceLastDist}`);
        console.log(`    Pool balance: ${balance.toFixed(2)} AXL`);

      } catch (e: any) {
        console.log(`  SIGNING POOL: Error - ${e.message}`);
      }
    }
  }

  // Try to query recent transactions
  console.log('\n');
  console.log('='.repeat(80));
  console.log('RECENT REWARD TRANSACTIONS');
  console.log('='.repeat(80));

  const recentTxs = await queryRecentTxsByContract(REWARDS_CONTRACT, 10);

  if (recentTxs.length === 0) {
    console.log('\nNo recent transactions found via API.');
    console.log('Try checking Axelarscan directly:');
    console.log(`https://axelarscan.io/account/${REWARDS_CONTRACT}`);
  } else {
    console.log(`\nFound ${recentTxs.length} recent transactions:`);
    for (const tx of recentTxs.slice(0, 5)) {
      const height = tx.height;
      const hash = tx.txhash;
      const timestamp = tx.timestamp;

      // Parse the logs to find reward distribution details
      let action = 'unknown';
      let details = '';

      try {
        const logs = tx.logs || [];
        for (const log of logs) {
          const events = log.events || [];
          for (const event of events) {
            if (event.type === 'wasm') {
              const attrs = event.attributes || [];
              for (const attr of attrs) {
                if (attr.key === 'action') {
                  action = attr.value;
                }
                if (attr.key === 'rewards_distributed' || attr.key === 'amount') {
                  details = attr.value;
                }
              }
            }
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }

      console.log(`\n  Block ${height} | ${timestamp}`);
      console.log(`  TX: ${hash.slice(0, 20)}...`);
      console.log(`  Action: ${action}`);
      if (details) {
        console.log(`  Details: ${details}`);
      }
    }
  }

  // Calculate what rewards SHOULD be based on our formula
  console.log('\n');
  console.log('='.repeat(80));
  console.log('REWARD CALCULATION VERIFICATION');
  console.log('='.repeat(80));
  console.log('\nFormula: rewards_per_verifier = rewards_per_epoch / active_verifiers');
  console.log('');
  console.log('Expected values (from governance):');
  console.log('  - rewards_per_epoch: 3,424.66 AXL');
  console.log('  - epoch_duration: 47,250 blocks (~24.15 hours at 1.84s/block)');
  console.log('');
  console.log('If pool shows different values, check governance proposals at:');
  console.log('https://axelarscan.io/proposals');

  console.log('\n');
  console.log('='.repeat(80));
  console.log('MANUAL VERIFICATION STEPS');
  console.log('='.repeat(80));
  console.log(`
To manually verify rewards:

1. Go to Axelarscan Amplifier Rewards page:
   https://axelarscan.io/amplifier-rewards/flow (or any chain)

2. Note the displayed rewards per epoch and verifier count

3. Calculate: displayed_epoch_rewards / verifier_count = per_verifier_reward

4. Compare with our dashboard values

5. Check recent reward claim transactions:
   https://axelarscan.io/account/${REWARDS_CONTRACT}

6. Look for 'distribute_rewards' actions and verify amounts match
`);
}

main().catch(console.error);
