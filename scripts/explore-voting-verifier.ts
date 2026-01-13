/**
 * Explore VotingVerifier contract queries
 *
 * Usage: npx tsx scripts/explore-voting-verifier.ts [chain]
 */

import axios from 'axios';

const LCD_ENDPOINTS = [
  'https://axelar-rest.publicnode.com',
  'https://axelar-api.polkachu.com',
  'https://rest.axelar.lava.build',
];

let LCD = LCD_ENDPOINTS[0];

const MAINNET_CONFIG_URL = 'https://raw.githubusercontent.com/axelarnetwork/axelar-contract-deployments/main/axelar-chains-config/info/mainnet.json';

async function findWorkingEndpoint(): Promise<string> {
  for (const endpoint of LCD_ENDPOINTS) {
    try {
      await axios.get(`${endpoint}/cosmos/base/tendermint/v1beta1/blocks/latest`, { timeout: 5000 });
      console.log(`Using endpoint: ${endpoint}`);
      return endpoint;
    } catch {
      continue;
    }
  }
  throw new Error('All endpoints failed');
}

async function queryContract(contract: string, query: object): Promise<any> {
  try {
    const queryBase64 = btoa(JSON.stringify(query));
    const url = `${LCD}/cosmwasm/wasm/v1/contract/${contract}/smart/${queryBase64}`;
    const response = await axios.get(url, { timeout: 15000 });
    return response.data?.data ?? null;
  } catch (error: any) {
    if (error.response?.data?.message) {
      return { error: error.response.data.message };
    }
    return { error: error.message };
  }
}

async function getVotingVerifierAddress(chainName: string): Promise<string | null> {
  const response = await axios.get(MAINNET_CONFIG_URL);
  const config = response.data;

  // Check regular VotingVerifier
  const votingVerifiers = config.axelar?.contracts?.VotingVerifier || {};
  if (votingVerifiers[chainName]?.address) {
    return votingVerifiers[chainName].address;
  }

  // Check XRPL VotingVerifier
  const xrplVotingVerifiers = config.axelar?.contracts?.XrplVotingVerifier || {};
  if (xrplVotingVerifiers[chainName]?.address) {
    return xrplVotingVerifiers[chainName].address;
  }

  return null;
}

async function listAvailableChains(): Promise<void> {
  const response = await axios.get(MAINNET_CONFIG_URL);
  const config = response.data;

  const votingVerifiers = config.axelar?.contracts?.VotingVerifier || {};
  const xrplVotingVerifiers = config.axelar?.contracts?.XrplVotingVerifier || {};

  console.log('\nChains with VotingVerifier contracts:');
  console.log('─'.repeat(50));

  const allChains = new Set([
    ...Object.keys(votingVerifiers),
    ...Object.keys(xrplVotingVerifiers)
  ]);

  // Filter out metadata keys
  const metadataKeys = ['codeId', 'lastUploadedCodeId', 'storeCodeProposalCodeHash', 'storeCodeProposalId'];

  for (const chain of [...allChains].sort()) {
    if (metadataKeys.includes(chain)) continue;
    const address = votingVerifiers[chain]?.address || xrplVotingVerifiers[chain]?.address;
    if (address) {
      console.log(`  ${chain}: ${address.slice(0, 20)}...`);
    }
  }
}

async function exploreContract(contractAddress: string, chainName: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`VOTING VERIFIER CONTRACT: ${chainName}`);
  console.log(`Address: ${contractAddress}`);
  console.log('='.repeat(60));

  // Try various known CosmWasm queries
  const queries = [
    // Standard queries
    { name: 'current_threshold', query: { current_threshold: {} } },
    { name: 'verifier_set', query: { verifier_set: {} } },
    { name: 'poll_id', query: { poll_id: {} } },
    { name: 'polls', query: { polls: {} } },
    { name: 'polls (with params)', query: { polls: { start_after: null, limit: 5 } } },
    { name: 'poll (id 1)', query: { poll: { poll_id: "1" } } },
    { name: 'poll (id 100)', query: { poll: { poll_id: "100" } } },
    { name: 'is_verified', query: { is_verified: {} } },
    { name: 'config', query: { config: {} } },
    { name: 'state', query: { state: {} } },

    // Participation queries
    { name: 'participation', query: { participation: {} } },
    { name: 'verifier_participation', query: { verifier_participation: {} } },

    // Messages queries
    { name: 'messages', query: { messages: {} } },
    { name: 'messages_status', query: { messages_status: {} } },

    // Voter queries
    { name: 'voter', query: { voter: {} } },
    { name: 'voters', query: { voters: {} } },
  ];

  console.log('\nTesting available queries:');
  console.log('─'.repeat(50));

  for (const { name, query } of queries) {
    const result = await queryContract(contractAddress, query);

    if (result?.error) {
      // Check if error reveals valid query parameters
      if (result.error.includes('missing field') || result.error.includes('unknown variant')) {
        console.log(`  ${name}: VALID QUERY (needs params)`);
        console.log(`    Error hint: ${result.error.slice(0, 100)}...`);
      } else {
        console.log(`  ${name}: ✗ ${result.error.slice(0, 60)}...`);
      }
    } else if (result !== null) {
      console.log(`  ${name}: ✓ SUCCESS`);
      console.log(`    Result: ${JSON.stringify(result).slice(0, 200)}...`);
    } else {
      console.log(`  ${name}: ✗ null response`);
    }
  }

  // If we found polls query works, explore poll structure
  console.log('\n\nExploring poll structure:');
  console.log('─'.repeat(50));

  // Try to get latest poll_id first
  const pollIdResult = await queryContract(contractAddress, { poll_id: {} });
  if (pollIdResult && !pollIdResult.error) {
    console.log(`Latest poll_id: ${pollIdResult}`);

    // Query the latest poll
    const latestPoll = await queryContract(contractAddress, { poll: { poll_id: pollIdResult.toString() } });
    if (latestPoll && !latestPoll.error) {
      console.log(`\nLatest poll structure:`);
      console.log(JSON.stringify(latestPoll, null, 2));
    }

    // Query a few recent polls
    const recentPollId = parseInt(pollIdResult) - 5;
    if (recentPollId > 0) {
      const olderPoll = await queryContract(contractAddress, { poll: { poll_id: recentPollId.toString() } });
      if (olderPoll && !olderPoll.error) {
        console.log(`\nOlder poll (${recentPollId}) structure:`);
        console.log(JSON.stringify(olderPoll, null, 2));
      }
    }
  }
}

async function main() {
  LCD = await findWorkingEndpoint();

  const chainArg = process.argv[2];

  if (!chainArg) {
    await listAvailableChains();
    console.log('\nUsage: npx tsx scripts/explore-voting-verifier.ts <chain>');
    console.log('Example: npx tsx scripts/explore-voting-verifier.ts ethereum');
    return;
  }

  const votingVerifierAddress = await getVotingVerifierAddress(chainArg);

  if (!votingVerifierAddress) {
    console.error(`No VotingVerifier found for chain: ${chainArg}`);
    await listAvailableChains();
    return;
  }

  await exploreContract(votingVerifierAddress, chainArg);
}

main().catch(console.error);
