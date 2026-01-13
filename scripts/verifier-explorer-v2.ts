/**
 * Verifier Explorer v2 - Using Signing Sessions
 *
 * Features:
 * 1. List all verifiers
 * 2. Show chains each verifier is active on
 * 3. Show unpaid epochs per chain
 * 4. Show signing participation per epoch
 *
 * Usage:
 *   npx tsx scripts/verifier-explorer-v2.ts                    # List all verifiers
 *   npx tsx scripts/verifier-explorer-v2.ts <address>          # Show verifier details
 */

const LCD_ENDPOINTS = [
  'https://axelar-rest.publicnode.com',
  'https://axelar-api.polkachu.com',
  'https://api-axelar.cosmos-spaces.cloud',
  'https://lcd-axelar.imperator.co',
  'https://axelar-lcd.quickapi.com',
];

let AXELAR_LCD = LCD_ENDPOINTS[0];

const SERVICE_REGISTRY = 'axelar1rpj2jjrv3vpugx9ake9kgk3s2kgwt0y60wtkmcgfml5m3et0mrls6nct9m';
const REWARDS_CONTRACT = 'axelar1harq5xe68lzl2kx4e5ch4k8840cgqnry567g0fgw7vt2atcuugrqfa7j5z';
const GLOBAL_MULTISIG = 'axelar14a4ar5jh7ue4wg28jwsspf23r8k68j7g5d6d3fsttrhp42ajn4xq6zayy5';

const EPOCH_DURATION = 47250; // blocks

interface EpochPerformance {
  epochNum: number;
  sessionsInEpoch: number;
  sessionsSigned: number;
  participationRate: number;
  qualified: boolean;
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

// Get all verifiers for Flow (signing pool)
async function getAllVerifiers(): Promise<{ address: string; bonded: string }[]> {
  const result = await queryContract(SERVICE_REGISTRY, {
    active_verifiers: {
      service_name: 'amplifier',
      chain_name: 'flow'
    }
  });

  if (!result) return [];

  return result.map((v: any) => ({
    address: v.verifier_info.address,
    bonded: (parseInt(v.verifier_info.bonding_state?.Bonded?.amount || '0') / 1e6).toFixed(0)
  }));
}

// Get rewards pool info
async function getRewardsPoolInfo(chainName: string): Promise<{
  currentEpoch: number;
  lastDistributionEpoch: number;
  rewardsPerEpoch: number;
} | null> {
  const result = await queryContract(REWARDS_CONTRACT, {
    rewards_pool: {
      pool_id: { chain_name: chainName, contract: GLOBAL_MULTISIG }
    }
  });

  if (!result) return null;

  return {
    currentEpoch: parseInt(result.current_epoch_num),
    lastDistributionEpoch: result.last_distribution_epoch ? parseInt(result.last_distribution_epoch) : 0,
    rewardsPerEpoch: parseInt(result.rewards_per_epoch) / 1e6
  };
}

// Find latest multisig session ID via binary search
async function findLatestSessionId(): Promise<number> {
  let low = 1;
  let high = 100000;
  let latestSession = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const result = await queryContract(GLOBAL_MULTISIG, { multisig: { session_id: mid.toString() } });
    if (result) {
      latestSession = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return latestSession;
}

// Get session details
async function getSessionDetails(sessionId: number): Promise<{
  completedAt: number;
  signers: string[];
  signatures: string[];
} | null> {
  const result = await queryContract(GLOBAL_MULTISIG, { multisig: { session_id: sessionId.toString() } });
  if (!result) return null;

  const signers = Object.keys(result.verifier_set?.signers || {});
  const signatures = Object.keys(result.signatures || {});
  const completedAt = result.state?.completed?.completed_at || 0;

  return { completedAt, signers, signatures };
}

// Get verifier's signing performance for unpaid epochs
async function getSigningPerformance(
  verifierAddress: string,
  unpaidEpochs: number[],
  currentBlock: number,
  currentEpoch: number
): Promise<EpochPerformance[]> {
  const performance: EpochPerformance[] = [];

  // Calculate epoch block ranges
  const currentEpochStartBlock = currentBlock - (currentBlock % EPOCH_DURATION);
  const epochRanges = new Map<number, { start: number; end: number }>();

  for (const epoch of unpaidEpochs) {
    const epochsBack = currentEpoch - epoch;
    const epochStart = currentEpochStartBlock - (epochsBack * EPOCH_DURATION);
    const epochEnd = epochStart + EPOCH_DURATION - 1;
    epochRanges.set(epoch, { start: epochStart, end: epochEnd });
  }

  // Initialize epoch stats
  const epochStats = new Map<number, { total: number; signed: number }>();
  for (const epoch of unpaidEpochs) {
    epochStats.set(epoch, { total: 0, signed: 0 });
  }

  // Find latest session and scan backwards
  console.log(`    Finding latest session...`);
  const latestSessionId = await findLatestSessionId();
  console.log(`    Latest session: ${latestSessionId}`);

  // Get oldest epoch's start block to know when to stop scanning
  const oldestEpoch = Math.min(...unpaidEpochs);
  const oldestEpochRange = epochRanges.get(oldestEpoch)!;

  console.log(`    Scanning sessions for epochs ${oldestEpoch}-${currentEpoch}...`);
  console.log(`    Block range: ${oldestEpochRange.start} - ${currentEpochStartBlock + EPOCH_DURATION}`);

  let sessionsScanned = 0;
  let sessionsMapped = 0;

  // Scan backwards from latest session
  for (let sessionId = latestSessionId; sessionId >= Math.max(1, latestSessionId - 5000); sessionId--) {
    const session = await getSessionDetails(sessionId);
    if (!session) continue;

    sessionsScanned++;

    // Stop if session is before our oldest epoch
    if (session.completedAt < oldestEpochRange.start) {
      console.log(`    Reached session ${sessionId} at block ${session.completedAt}, before epoch ${oldestEpoch}`);
      break;
    }

    // Find which epoch this session belongs to
    for (const [epoch, range] of epochRanges) {
      if (session.completedAt >= range.start && session.completedAt <= range.end) {
        const stats = epochStats.get(epoch)!;
        stats.total++;

        // Check if verifier signed this session
        if (session.signatures.includes(verifierAddress)) {
          stats.signed++;
        }
        sessionsMapped++;
        break;
      }
    }

    // Progress update every 100 sessions
    if (sessionsScanned % 100 === 0) {
      console.log(`    Scanned ${sessionsScanned} sessions, mapped ${sessionsMapped}...`);
    }
  }

  console.log(`    Total: scanned ${sessionsScanned} sessions, mapped ${sessionsMapped} to epochs`);

  // Build performance array
  for (const epoch of unpaidEpochs) {
    const stats = epochStats.get(epoch)!;
    const rate = stats.total > 0 ? (stats.signed / stats.total) * 100 : 0;

    performance.push({
      epochNum: epoch,
      sessionsInEpoch: stats.total,
      sessionsSigned: stats.signed,
      participationRate: rate,
      qualified: stats.total > 0 ? rate >= 80 : false
    });
  }

  return performance;
}

async function main() {
  const verifierAddress = process.argv[2];

  console.log('='.repeat(70));
  console.log('VERIFIER EXPLORER v2 - Signing Sessions');
  console.log('='.repeat(70));
  console.log('');

  AXELAR_LCD = await findWorkingEndpoint();
  console.log(`Connected to: ${AXELAR_LCD}\n`);

  const currentBlock = await getCurrentBlockHeight();
  console.log(`Current block: ${currentBlock}\n`);

  // Get all verifiers
  console.log('Fetching verifiers...');
  const verifiers = await getAllVerifiers();
  console.log(`Found ${verifiers.length} verifiers\n`);

  // Display verifier list
  console.log('─'.repeat(70));
  console.log('ALL VERIFIERS');
  console.log('─'.repeat(70));
  for (const v of verifiers) {
    console.log(`${v.address} | ${v.bonded} AXL bonded`);
  }

  // If specific verifier requested, show detailed view
  if (verifierAddress) {
    console.log('\n');
    console.log('='.repeat(70));
    console.log(`DETAILED VIEW: ${verifierAddress}`);
    console.log('='.repeat(70));

    // Check if verifier is in list
    const isActive = verifiers.some(v => v.address === verifierAddress);
    if (!isActive) {
      console.log('\n⚠ Verifier not found in active verifiers list.');
      console.log('They may be registered but not currently active for Flow.\n');
    }

    // Get pool info
    const poolInfo = await getRewardsPoolInfo('flow');
    if (!poolInfo) {
      console.log('Could not get rewards pool info');
      return;
    }

    const unpaidEpochs: number[] = [];
    for (let e = poolInfo.lastDistributionEpoch + 1; e <= poolInfo.currentEpoch; e++) {
      unpaidEpochs.push(e);
    }

    console.log(`\nSIGNING POOL (Global Multisig)`);
    console.log('─'.repeat(50));
    console.log(`  Current Epoch: ${poolInfo.currentEpoch}`);
    console.log(`  Last Distribution: Epoch ${poolInfo.lastDistributionEpoch}`);
    console.log(`  Unpaid Epochs: ${unpaidEpochs.length} (${unpaidEpochs[0]} - ${unpaidEpochs[unpaidEpochs.length - 1]})`);
    console.log(`  Rewards/Epoch: ${poolInfo.rewardsPerEpoch.toFixed(2)} AXL`);

    if (unpaidEpochs.length > 0) {
      console.log('\n  Epoch Performance:');
      console.log('  Epoch  │ Sessions │ Signed │ Rate    │ Qualified');
      console.log('  ───────┼──────────┼────────┼─────────┼──────────');

      // Only check last 5 unpaid epochs to avoid rate limiting
      const epochsToCheck = unpaidEpochs.slice(-5);

      const performance = await getSigningPerformance(
        verifierAddress,
        epochsToCheck,
        currentBlock,
        poolInfo.currentEpoch
      );

      for (const p of performance) {
        const epoch = p.epochNum.toString().padEnd(6);
        const sessions = p.sessionsInEpoch.toString().padEnd(8);
        const signed = p.sessionsSigned.toString().padEnd(6);
        const rate = p.participationRate > 0 ? `${p.participationRate.toFixed(1)}%`.padEnd(7) : 'N/A'.padEnd(7);
        const qualified = p.qualified ? '✓ Yes' : (p.sessionsInEpoch === 0 ? '- N/A' : '✗ No');
        console.log(`  ${epoch} │ ${sessions} │ ${signed} │ ${rate} │ ${qualified}`);
      }

      // Summary
      const totalSessions = performance.reduce((sum, p) => sum + p.sessionsInEpoch, 0);
      const totalSigned = performance.reduce((sum, p) => sum + p.sessionsSigned, 0);
      const overallRate = totalSessions > 0 ? (totalSigned / totalSessions) * 100 : 0;

      console.log('  ───────┴──────────┴────────┴─────────┴──────────');
      console.log(`  Overall: ${totalSigned}/${totalSessions} sessions signed (${overallRate.toFixed(1)}%)`);

      if (overallRate >= 80) {
        console.log('\n  ✓ On track to qualify for rewards!');
      } else if (overallRate >= 70) {
        console.log('\n  ⚠ At risk - participation below 80% threshold');
      } else {
        console.log('\n  ✗ Below threshold - may not qualify for rewards');
      }
    }
  }

  console.log('\n');
}

main().catch(console.error);
