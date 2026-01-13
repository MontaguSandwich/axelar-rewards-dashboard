#!/usr/bin/env npx ts-node

/**
 * Script to query Axelar Amplifier reward pool parameters for all chains
 * Run with: npx ts-node scripts/query-rewards.ts
 */

import axios from 'axios';

const LCD_ENDPOINT = 'https://axelar-lcd.publicnode.com';
const MAINNET_CONFIG_URL = 'https://raw.githubusercontent.com/axelarnetwork/axelar-contract-deployments/main/axelar-chains-config/info/mainnet.json';

const BLOCK_TIME_SECONDS = 1.84;

interface PoolResponse {
  balance: string;
  epoch_duration: string;
  rewards_per_epoch: string;
  current_epoch_num: string;
  participation_threshold: [string, string];
}

interface ChainData {
  chainName: string;
  chainKey: string;
  votingVerifier: string | null;
  multisigProver: string | null;
}

async function fetchMainnetConfig(): Promise<any> {
  const response = await axios.get(MAINNET_CONFIG_URL);
  return response.data;
}

async function queryRewardsPool(
  rewardsContract: string,
  chainName: string,
  contractAddress: string
): Promise<PoolResponse | null> {
  try {
    const query = {
      rewards_pool: {
        pool_id: {
          chain_name: chainName,
          contract: contractAddress,
        },
      },
    };

    const queryBase64 = Buffer.from(JSON.stringify(query)).toString('base64');
    const url = `${LCD_ENDPOINT}/cosmwasm/wasm/v1/contract/${rewardsContract}/smart/${queryBase64}`;

    const response = await axios.get(url, { timeout: 10000 });
    return response.data?.data || null;
  } catch (error: any) {
    if (error.response?.status === 500) {
      // Pool doesn't exist
      return null;
    }
    console.error(`  Error querying ${chainName}/${contractAddress.slice(0, 20)}...: ${error.message}`);
    return null;
  }
}

async function queryActiveVerifiers(
  serviceRegistry: string,
  chainName: string
): Promise<number> {
  try {
    const query = {
      active_verifiers: {
        service_name: 'amplifier',
        chain_name: chainName,
      },
    };

    const queryBase64 = Buffer.from(JSON.stringify(query)).toString('base64');
    const url = `${LCD_ENDPOINT}/cosmwasm/wasm/v1/contract/${serviceRegistry}/smart/${queryBase64}`;

    const response = await axios.get(url, { timeout: 10000 });
    return response.data?.data?.length || 0;
  } catch (error: any) {
    console.error(`  Error querying verifiers for ${chainName}: ${error.message}`);
    return 0;
  }
}

function formatPool(pool: PoolResponse | null, verifiers: number): string {
  if (!pool) return 'No pool data';

  const balance = parseInt(pool.balance) / 1e6;
  const rewardsPerEpoch = parseInt(pool.rewards_per_epoch) / 1e6;
  const epochDuration = parseInt(pool.epoch_duration);
  const epochHours = (epochDuration * BLOCK_TIME_SECONDS) / 3600;
  const threshold = `${pool.participation_threshold[0]}/${pool.participation_threshold[1]}`;

  // Calculate monthly rewards per new verifier
  const epochsPerMonth = (30 * 24 * 3600) / (epochDuration * BLOCK_TIME_SECONDS);
  const rewardsPerVerifierPerEpoch = verifiers > 0 ? rewardsPerEpoch / (verifiers + 1) : rewardsPerEpoch;
  const monthlyPerVerifier = rewardsPerVerifierPerEpoch * epochsPerMonth;

  return `
    Balance: ${balance.toLocaleString()} AXL
    Rewards/Epoch: ${rewardsPerEpoch.toLocaleString()} AXL
    Epoch Duration: ${epochDuration.toLocaleString()} blocks (~${epochHours.toFixed(1)} hours)
    Current Epoch: ${pool.current_epoch_num}
    Threshold: ${threshold} (${(parseInt(pool.participation_threshold[0]) / parseInt(pool.participation_threshold[1]) * 100).toFixed(0)}%)
    Est. Monthly/Verifier: ${monthlyPerVerifier.toFixed(2)} AXL (with ${verifiers + 1} verifiers)`;
}

async function main() {
  console.log('Fetching Axelar mainnet config...\n');

  const config = await fetchMainnetConfig();
  const rewardsContract = config.axelar.contracts.Rewards.address;
  const serviceRegistry = config.axelar.contracts.ServiceRegistry.address;

  console.log(`Rewards Contract: ${rewardsContract}`);
  console.log(`Service Registry: ${serviceRegistry}`);
  console.log(`Block Time: ${BLOCK_TIME_SECONDS}s\n`);
  console.log('='.repeat(80));

  // Get all chains from VotingVerifier and MultisigProver
  const votingVerifiers = config.axelar.contracts.VotingVerifier || {};
  const multisigProvers = config.axelar.contracts.MultisigProver || {};
  const xrplVotingVerifiers = config.axelar.contracts.XrplVotingVerifier || {};
  const xrplMultisigProvers = config.axelar.contracts.XrplMultisigProver || {};

  const metadataKeys = new Set(['codeId', 'lastUploadedCodeId', 'storeCodeProposalCodeHash', 'storeCodeProposalId']);

  const chainNames = new Set<string>();

  for (const key of Object.keys(votingVerifiers)) {
    if (!metadataKeys.has(key) && votingVerifiers[key]?.address) chainNames.add(key);
  }
  for (const key of Object.keys(multisigProvers)) {
    if (!metadataKeys.has(key) && multisigProvers[key]?.address) chainNames.add(key);
  }
  for (const key of Object.keys(xrplVotingVerifiers)) {
    if (!metadataKeys.has(key) && xrplVotingVerifiers[key]?.address) chainNames.add(key);
  }
  for (const key of Object.keys(xrplMultisigProvers)) {
    if (!metadataKeys.has(key) && xrplMultisigProvers[key]?.address) chainNames.add(key);
  }

  const chains: ChainData[] = [];
  for (const chainKey of chainNames) {
    const votingVerifier = votingVerifiers[chainKey]?.address
      || xrplVotingVerifiers[chainKey]?.address
      || null;
    const multisigProver = multisigProvers[chainKey]?.address
      || xrplMultisigProvers[chainKey]?.address
      || null;

    const chainData = config.chains[chainKey];
    chains.push({
      chainName: chainData?.name || chainKey,
      chainKey,
      votingVerifier,
      multisigProver,
    });
  }

  // Sort by chain name
  chains.sort((a, b) => a.chainName.localeCompare(b.chainName));

  console.log(`\nFound ${chains.length} chains. Querying reward pools...\n`);

  const results: any[] = [];

  for (const chain of chains) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`CHAIN: ${chain.chainName} (${chain.chainKey})`);
    console.log('='.repeat(80));

    // Query active verifiers
    const verifiers = await queryActiveVerifiers(serviceRegistry, chain.chainKey);
    console.log(`Active Verifiers: ${verifiers}`);

    // Query voting pool
    console.log('\n--- VOTING POOL ---');
    if (chain.votingVerifier) {
      console.log(`Contract: ${chain.votingVerifier}`);
      const votingPool = await queryRewardsPool(rewardsContract, chain.chainKey, chain.votingVerifier);
      console.log(formatPool(votingPool, verifiers));
      results.push({
        chain: chain.chainName,
        chainKey: chain.chainKey,
        type: 'voting',
        verifiers,
        ...(votingPool ? {
          balance: parseInt(votingPool.balance) / 1e6,
          rewardsPerEpoch: parseInt(votingPool.rewards_per_epoch) / 1e6,
          epochDuration: parseInt(votingPool.epoch_duration),
          currentEpoch: parseInt(votingPool.current_epoch_num),
        } : { error: 'No pool' }),
      });
    } else {
      console.log('No voting verifier contract');
    }

    // Query signing pool
    console.log('\n--- SIGNING POOL ---');
    if (chain.multisigProver) {
      console.log(`Contract: ${chain.multisigProver}`);
      const signingPool = await queryRewardsPool(rewardsContract, chain.chainKey, chain.multisigProver);
      console.log(formatPool(signingPool, verifiers));
      results.push({
        chain: chain.chainName,
        chainKey: chain.chainKey,
        type: 'signing',
        verifiers,
        ...(signingPool ? {
          balance: parseInt(signingPool.balance) / 1e6,
          rewardsPerEpoch: parseInt(signingPool.rewards_per_epoch) / 1e6,
          epochDuration: parseInt(signingPool.epoch_duration),
          currentEpoch: parseInt(signingPool.current_epoch_num),
        } : { error: 'No pool' }),
      });
    } else {
      console.log('No multisig prover contract');
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Summary table
  console.log('\n\n' + '='.repeat(100));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(100));
  console.log('\nChain                | Type    | Verifiers | Rewards/Epoch | Epoch (blocks) | Balance');
  console.log('-'.repeat(100));

  for (const r of results) {
    if (r.error) {
      console.log(`${r.chain.padEnd(20)} | ${r.type.padEnd(7)} | ${String(r.verifiers).padStart(9)} | ${'N/A'.padStart(13)} | ${'N/A'.padStart(14)} | N/A`);
    } else {
      console.log(`${r.chain.padEnd(20)} | ${r.type.padEnd(7)} | ${String(r.verifiers).padStart(9)} | ${(r.rewardsPerEpoch.toLocaleString() + ' AXL').padStart(13)} | ${r.epochDuration.toLocaleString().padStart(14)} | ${r.balance.toLocaleString()} AXL`);
    }
  }

  // Export as JSON
  const fs = await import('fs');
  fs.writeFileSync('rewards-data.json', JSON.stringify(results, null, 2));
  console.log('\n\nData exported to rewards-data.json');
}

main().catch(console.error);
