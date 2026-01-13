/**
 * Verifier Performance Monitor
 *
 * Usage: npx tsx scripts/verifier-status.ts <verifier_address>
 * Example: npx tsx scripts/verifier-status.ts axelar15k8d4hqgytdxmcx3lhph2qagvt0r7683cchglj
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

// Known VotingVerifier contracts per chain (we'll need to expand this)
const VOTING_VERIFIERS: Record<string, string> = {
  'flow': 'axelar1kkqdsqvwq9a7p9fj0w89wpx2m2t0vrxl782aslhq0kdw2xxd2aesv3un04',
  // Add more as we discover them
};

interface ChainParticipation {
  chainName: string;
  votingVerifier: string | null;
  recentPolls: number;
  votedPolls: number;
  participationRate: number;
  status: 'on_track' | 'at_risk' | 'below_threshold' | 'unknown';
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

async function getVerifierChains(verifierAddress: string): Promise<string[]> {
  // Query service registry for all chains, then filter by verifier
  // For now, return chains we know about
  const chains: string[] = [];

  for (const chainName of Object.keys(VOTING_VERIFIERS)) {
    const result = await queryContract(SERVICE_REGISTRY, {
      active_verifiers: {
        service_name: 'amplifier',
        chain_name: chainName
      }
    });

    if (result) {
      const isActive = result.some((v: any) =>
        v.verifier_info?.address === verifierAddress
      );
      if (isActive) {
        chains.push(chainName);
      }
    }
  }

  return chains;
}

async function findLatestPollId(votingVerifier: string): Promise<number> {
  // Binary search to find the latest poll ID
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

async function getVerifierPollParticipation(
  votingVerifier: string,
  verifierAddress: string,
  pollCount: number = 50
): Promise<{ voted: number; total: number; polls: number[] }> {
  // Find latest poll ID
  console.log(`    Finding latest poll ID...`);
  const latestPollId = await findLatestPollId(votingVerifier);
  console.log(`    Latest poll: ${latestPollId}`);

  let voted = 0;
  let total = 0;
  const votedPolls: number[] = [];

  // Query recent polls
  const startPoll = Math.max(1, latestPollId - pollCount + 1);
  console.log(`    Checking polls ${startPoll} to ${latestPollId}...`);

  for (let pollId = latestPollId; pollId >= startPoll; pollId--) {
    const result = await queryContract(votingVerifier, { poll: { poll_id: pollId.toString() } });

    if (result?.poll?.participation) {
      total++;
      const verifierParticipation = result.poll.participation[verifierAddress];
      if (verifierParticipation?.voted) {
        voted++;
        votedPolls.push(pollId);
      }
    }
  }

  return { voted, total, polls: votedPolls };
}

function getStatus(rate: number): 'on_track' | 'at_risk' | 'below_threshold' {
  if (rate >= 85) return 'on_track';
  if (rate >= 80) return 'at_risk';
  return 'below_threshold';
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'on_track': return '✓';
    case 'at_risk': return '⚠';
    case 'below_threshold': return '✗';
    default: return '?';
  }
}

async function main() {
  const verifierAddress = process.argv[2];

  if (!verifierAddress) {
    console.log('Usage: npx tsx scripts/verifier-status.ts <verifier_address>');
    console.log('Example: npx tsx scripts/verifier-status.ts axelar15k8d4hqgytdxmcx3lhph2qagvt0r7683cchglj');
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('VERIFIER PERFORMANCE MONITOR');
  console.log('='.repeat(70));
  console.log(`\nVerifier: ${verifierAddress}`);
  console.log('');

  AXELAR_LCD = await findWorkingEndpoint();
  console.log(`Connected to: ${AXELAR_LCD}\n`);

  // Get chains verifier is active on
  console.log('Finding active chains...');
  const activeChains = await getVerifierChains(verifierAddress);

  if (activeChains.length === 0) {
    console.log('No active chains found for this verifier.');
    console.log('(Note: We currently only check Flow. More chains coming.)');
    process.exit(0);
  }

  console.log(`Active on: ${activeChains.join(', ')}\n`);

  // Check participation for each chain
  const results: ChainParticipation[] = [];

  for (const chainName of activeChains) {
    console.log(`\nChecking ${chainName.toUpperCase()}...`);

    const votingVerifier = VOTING_VERIFIERS[chainName];
    if (!votingVerifier) {
      console.log(`  Voting verifier not configured for ${chainName}`);
      results.push({
        chainName,
        votingVerifier: null,
        recentPolls: 0,
        votedPolls: 0,
        participationRate: 0,
        status: 'unknown'
      });
      continue;
    }

    console.log(`  Voting Verifier: ${votingVerifier.slice(0, 20)}...`);

    const participation = await getVerifierPollParticipation(votingVerifier, verifierAddress, 50);
    const rate = participation.total > 0 ? (participation.voted / participation.total) * 100 : 0;

    results.push({
      chainName,
      votingVerifier,
      recentPolls: participation.total,
      votedPolls: participation.voted,
      participationRate: rate,
      status: getStatus(rate)
    });
  }

  // Display results
  console.log('\n');
  console.log('='.repeat(70));
  console.log('PARTICIPATION SUMMARY (Voting - Last 50 Polls)');
  console.log('='.repeat(70));
  console.log('');
  console.log('Chain          │ Voted/Total │ Rate    │ Status');
  console.log('───────────────┼─────────────┼─────────┼────────────────');

  for (const r of results) {
    const chain = r.chainName.padEnd(14);
    const voted = `${r.votedPolls}/${r.recentPolls}`.padEnd(11);
    const rate = r.participationRate > 0 ? `${r.participationRate.toFixed(1)}%`.padEnd(7) : 'N/A'.padEnd(7);
    const status = `${statusEmoji(r.status)} ${r.status.replace('_', ' ')}`;

    console.log(`${chain} │ ${voted} │ ${rate} │ ${status}`);
  }

  console.log('');
  console.log('───────────────────────────────────────────────────────────────────────');
  console.log('Threshold: 80% participation required to qualify for epoch rewards');
  console.log('');

  // Show any at-risk or below threshold
  const atRisk = results.filter(r => r.status === 'at_risk' || r.status === 'below_threshold');
  if (atRisk.length > 0) {
    console.log('⚠ ATTENTION NEEDED:');
    for (const r of atRisk) {
      console.log(`  - ${r.chainName}: ${r.participationRate.toFixed(1)}% (need 80%)`);
    }
  } else if (results.some(r => r.status === 'on_track')) {
    console.log('✓ All chains on track for rewards!');
  }

  console.log('');
}

main().catch(console.error);
