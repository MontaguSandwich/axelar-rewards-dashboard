import axios from 'axios';
import type { ChainConfig, MainnetConfig } from '../types';

const MAINNET_CONFIG_URL = 'https://raw.githubusercontent.com/axelarnetwork/axelar-contract-deployments/main/axelar-chains-config/info/mainnet.json';

let cachedConfig: MainnetConfig | null = null;

export async function fetchMainnetConfig(): Promise<MainnetConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const response = await axios.get<MainnetConfig>(MAINNET_CONFIG_URL);
  cachedConfig = response.data;
  return cachedConfig;
}

export async function getRewardsContractAddress(): Promise<string> {
  const config = await fetchMainnetConfig();
  return config.axelar.contracts.Rewards.address;
}

export async function getServiceRegistryAddress(): Promise<string> {
  const config = await fetchMainnetConfig();
  return config.axelar.contracts.ServiceRegistry.address;
}

// Metadata keys to filter out (not actual chains)
const METADATA_KEYS = new Set([
  'codeId',
  'lastUploadedCodeId',
  'storeCodeProposalCodeHash',
  'storeCodeProposalId',
]);

function isValidChainEntry(key: string, value: unknown): boolean {
  // Filter out metadata keys
  if (METADATA_KEYS.has(key)) return false;
  // Must be an object with an address property
  if (typeof value !== 'object' || value === null) return false;
  if (!('address' in value)) return false;
  return true;
}

export async function getChainConfigs(): Promise<ChainConfig[]> {
  const config = await fetchMainnetConfig();
  const chains: ChainConfig[] = [];

  // Get VotingVerifier and MultisigProver contracts from axelar.contracts
  const votingVerifiers = config.axelar.contracts.VotingVerifier || {};
  const multisigProvers = config.axelar.contracts.MultisigProver || {};

  // Collect all unique chain names from both contract types (filtering metadata)
  const chainNames = new Set<string>();

  for (const [key, value] of Object.entries(votingVerifiers)) {
    if (isValidChainEntry(key, value)) {
      chainNames.add(key);
    }
  }

  for (const [key, value] of Object.entries(multisigProvers)) {
    if (isValidChainEntry(key, value)) {
      chainNames.add(key);
    }
  }

  for (const chainKey of chainNames) {
    const votingVerifier = votingVerifiers[chainKey]?.address || null;
    const multisigProver = multisigProvers[chainKey]?.address || null;

    // Get chain info from chains object if available
    const chainData = config.chains[chainKey];

    chains.push({
      chainName: chainData?.name || chainKey,
      chainId: chainData?.axelarId || chainData?.id || chainKey,
      chainKey, // Keep the original lowercase key for contract queries
      votingVerifierAddress: votingVerifier,
      multisigProverAddress: multisigProver,
      status: 'inactive', // Will be updated after querying rewards pools
    });
  }

  return chains.sort((a, b) => a.chainName.localeCompare(b.chainName));
}

export function clearConfigCache(): void {
  cachedConfig = null;
}
