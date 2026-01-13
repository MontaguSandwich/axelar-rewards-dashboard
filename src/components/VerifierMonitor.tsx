import { useState, useEffect, useRef } from 'react';
import type { Verifier, VerifierChainData, ChainConfig } from '../types';
import { fetchAllVerifiers, fetchVerifierPerformance } from '../api/verifier';
import { getChainConfigs } from '../api/config';
import { getVerifierName } from '../constants/verifiers';

interface VerifierMonitorProps {
  axlPrice: number | null;
}

export function VerifierMonitor({ axlPrice }: VerifierMonitorProps) {
  // Chain selection
  const [chains, setChains] = useState<ChainConfig[]>([]);
  const [selectedChain, setSelectedChain] = useState<string>('flow');
  const [isLoadingChains, setIsLoadingChains] = useState(true);

  // Verifier selection
  const [verifiers, setVerifiers] = useState<Verifier[]>([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [isVerifierDropdownOpen, setIsVerifierDropdownOpen] = useState(false);
  const [isLoadingVerifiers, setIsLoadingVerifiers] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Performance data
  const [chainData, setChainData] = useState<VerifierChainData | null>(null);
  const [isLoadingPerformance, setIsLoadingPerformance] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Load chains on mount
  useEffect(() => {
    loadChains();
  }, []);

  // Load verifiers when chain changes
  useEffect(() => {
    if (selectedChain) {
      loadVerifiers(selectedChain);
      // Clear previous selection and data
      setSelectedAddress('');
      setChainData(null);
    }
  }, [selectedChain]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsVerifierDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadChains = async () => {
    setIsLoadingChains(true);
    try {
      const chainConfigs = await getChainConfigs();
      setChains(chainConfigs);
    } catch (err) {
      console.error('Failed to load chains:', err);
    } finally {
      setIsLoadingChains(false);
    }
  };

  const loadVerifiers = async (chainName: string) => {
    setIsLoadingVerifiers(true);
    setError(null);
    try {
      const data = await fetchAllVerifiers(chainName);
      setVerifiers(data);
    } catch (err) {
      setError('Failed to load verifiers for this chain');
      setVerifiers([]);
    } finally {
      setIsLoadingVerifiers(false);
    }
  };

  const handleVerifierSelect = (address: string) => {
    setSelectedAddress(address);
    setIsVerifierDropdownOpen(false);
    // Auto-lookup when selecting from dropdown
    handleLookup(address);
  };

  const handleLookup = async (addressOverride?: string) => {
    const addressToLookup = addressOverride || selectedAddress;
    if (!addressToLookup) return;

    setIsLoadingPerformance(true);
    setError(null);
    setProgressMessage('Starting...');
    setChainData(null);

    try {
      const data = await fetchVerifierPerformance(
        addressToLookup,
        selectedChain,
        5,
        (msg) => setProgressMessage(msg)
      );

      if (data) {
        setChainData(data);
      } else {
        setError('Could not fetch performance data for this verifier');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch performance');
    } finally {
      setIsLoadingPerformance(false);
      setProgressMessage('');
    }
  };

  const getStatusColor = (rate: number) => {
    if (rate >= 80) return 'text-[var(--accent-green)]';
    if (rate >= 70) return 'text-[var(--accent-yellow)]';
    return 'text-[var(--accent-red)]';
  };

  const getStatusIcon = (qualified: boolean) => {
    return qualified ? (
      <span className="text-[var(--accent-green)]">&#10003;</span>
    ) : (
      <span className="text-[var(--accent-red)]">&#10007;</span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-color)]">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">
          Verifier Performance Monitor
        </h2>
        <p className="text-[var(--text-secondary)]">
          Track your signing participation and pending rewards across epochs
        </p>
      </div>

      {/* Chain & Verifier Selection */}
      <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-color)]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Chain Selector */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Select Chain
            </label>
            <select
              value={selectedChain}
              onChange={(e) => setSelectedChain(e.target.value)}
              disabled={isLoadingChains}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] cursor-pointer"
            >
              {isLoadingChains ? (
                <option>Loading chains...</option>
              ) : (
                chains.map((chain) => (
                  <option key={chain.chainKey} value={chain.chainKey}>
                    {chain.chainName}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Verifier Dropdown */}
          <div ref={dropdownRef} className="relative">
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Select Verifier
            </label>
            <button
              onClick={() => setIsVerifierDropdownOpen(!isVerifierDropdownOpen)}
              disabled={isLoadingVerifiers}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
            >
              <span className={selectedAddress ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>
                {isLoadingVerifiers ? (
                  'Loading verifiers...'
                ) : selectedAddress ? (
                  <span className="text-sm">
                    <span className="font-medium">{getVerifierName(selectedAddress) || 'Unknown'}</span>
                    <span className="text-[var(--text-secondary)] ml-2 font-mono text-xs">
                      {selectedAddress.slice(0, 8)}...{selectedAddress.slice(-6)}
                    </span>
                  </span>
                ) : (
                  `Select from ${verifiers.length} verifiers`
                )}
              </span>
              <svg
                className={`w-5 h-5 text-[var(--text-secondary)] transition-transform ${isVerifierDropdownOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {isVerifierDropdownOpen && verifiers.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {verifiers.map((v) => {
                  const name = getVerifierName(v.address);
                  return (
                    <button
                      key={v.address}
                      onClick={() => handleVerifierSelect(v.address)}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        selectedAddress === v.address
                          ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]'
                          : 'hover:bg-[var(--bg-primary)] text-[var(--text-primary)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{name || 'Unknown'}</span>
                        <span className="text-[var(--text-secondary)] text-xs">
                          {v.bondedAmount.toLocaleString()} AXL
                        </span>
                      </div>
                      <div className="font-mono text-xs text-[var(--text-secondary)] mt-0.5">
                        {v.address}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {isVerifierDropdownOpen && verifiers.length === 0 && !isLoadingVerifiers && (
              <div className="absolute z-50 w-full mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-lg p-4 text-center text-[var(--text-secondary)]">
                No verifiers found for this chain
              </div>
            )}
          </div>
        </div>

        {/* Progress Message */}
        {progressMessage && (
          <div className="mt-4 text-sm text-[var(--text-secondary)] flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {progressMessage}
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 rounded-lg bg-[var(--accent-red)]/20 border border-[var(--accent-red)] text-[var(--accent-red)]">
          {error}
        </div>
      )}

      {/* Performance Results */}
      {chainData && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="bg-[var(--bg-secondary)] rounded-xl p-4 border border-[var(--border-color)]">
              <div className="text-sm text-[var(--text-secondary)] mb-1">Current Epoch</div>
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {chainData.currentEpoch}
              </div>
            </div>
            <div className="bg-[var(--bg-secondary)] rounded-xl p-4 border border-[var(--border-color)]">
              <div className="text-sm text-[var(--text-secondary)] mb-1">Unpaid Epochs</div>
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {chainData.unpaidEpochCount}
              </div>
            </div>
            <div className="bg-[var(--bg-secondary)] rounded-xl p-4 border border-[var(--border-color)]">
              <div className="text-sm text-[var(--text-secondary)] mb-1">Active Verifiers</div>
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {chainData.activeVerifiers}
              </div>
            </div>
            <div className="bg-[var(--bg-secondary)] rounded-xl p-4 border border-[var(--border-color)]">
              <div className="text-sm text-[var(--text-secondary)] mb-1">Your Rewards/Epoch</div>
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {chainData.rewardsPerVerifierPerEpoch.toFixed(2)}
                <span className="text-sm font-normal text-[var(--text-secondary)] ml-1">AXL</span>
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                Pool: {chainData.poolRewardsPerEpoch.toFixed(0)} AXL
              </div>
            </div>
            <div className="bg-[var(--bg-secondary)] rounded-xl p-4 border border-[var(--border-color)]">
              <div className="text-sm text-[var(--text-secondary)] mb-1">Est. Pending</div>
              <div className="text-2xl font-bold text-[var(--accent-green)]">
                ~{chainData.estimatedPendingRewards.toFixed(2)}
                <span className="text-sm font-normal ml-1">AXL</span>
              </div>
              {axlPrice && (
                <div className="text-sm text-[var(--text-secondary)]">
                  ~${(chainData.estimatedPendingRewards * axlPrice).toFixed(2)}
                </div>
              )}
            </div>
          </div>

          {/* Performance Table */}
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)] overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border-color)]">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                {getVerifierName(selectedAddress) || 'Verifier'} - Signing Performance
              </h3>
              <p className="text-sm text-[var(--text-secondary)]">
                Chain: {chainData.chainName.toUpperCase()} | Last {chainData.epochPerformance.length} Epochs | Threshold: 80%
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[var(--bg-primary)]">
                    <th className="text-left px-6 py-3 text-sm font-medium text-[var(--text-secondary)]">Epoch</th>
                    <th className="text-right px-6 py-3 text-sm font-medium text-[var(--text-secondary)]">Sessions</th>
                    <th className="text-right px-6 py-3 text-sm font-medium text-[var(--text-secondary)]">Signed</th>
                    <th className="text-right px-6 py-3 text-sm font-medium text-[var(--text-secondary)]">Rate</th>
                    <th className="text-center px-6 py-3 text-sm font-medium text-[var(--text-secondary)]">Qualified</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                  {chainData.epochPerformance.map((perf) => (
                    <tr key={perf.epochNum} className="hover:bg-[var(--bg-primary)]/50">
                      <td className="px-6 py-3 text-[var(--text-primary)] font-medium">
                        {perf.epochNum}
                      </td>
                      <td className="px-6 py-3 text-right text-[var(--text-primary)]">
                        {perf.sessionsInEpoch}
                      </td>
                      <td className="px-6 py-3 text-right text-[var(--text-primary)]">
                        {perf.sessionsSigned}
                      </td>
                      <td className={`px-6 py-3 text-right font-medium ${getStatusColor(perf.participationRate)}`}>
                        {perf.sessionsInEpoch > 0 ? `${perf.participationRate.toFixed(1)}%` : 'N/A'}
                      </td>
                      <td className="px-6 py-3 text-center text-lg">
                        {perf.sessionsInEpoch > 0 ? getStatusIcon(perf.qualified) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary Footer */}
            <div className="px-6 py-4 border-t border-[var(--border-color)] bg-[var(--bg-primary)]">
              <div className="flex items-center justify-between">
                <div className="text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--text-primary)]">
                    {chainData.qualifiedEpochs}/{chainData.epochPerformance.length}
                  </span>
                  {' '}epochs qualified in sample
                </div>
                <div className={`text-sm font-medium ${
                  chainData.qualifiedEpochs === chainData.epochPerformance.length
                    ? 'text-[var(--accent-green)]'
                    : chainData.qualifiedEpochs > 0
                    ? 'text-[var(--accent-yellow)]'
                    : 'text-[var(--accent-red)]'
                }`}>
                  {chainData.qualifiedEpochs === chainData.epochPerformance.length
                    ? 'On track for rewards!'
                    : chainData.qualifiedEpochs > 0
                    ? 'Partial qualification'
                    : 'Below threshold'}
                </div>
              </div>
            </div>
          </div>

          {/* Info Note */}
          <div className="bg-[var(--bg-secondary)] rounded-xl p-4 border border-[var(--border-color)]">
            <div className="flex gap-3">
              <div className="text-[var(--accent-blue)]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="text-sm text-[var(--text-secondary)]">
                <p className="mb-1">
                  <strong>Note:</strong> This shows your signing session participation for the Global Multisig pool.
                </p>
                <p>
                  Verifiers must achieve ≥80% participation rate per epoch to qualify for rewards.
                  Pending rewards are estimated based on the sample of epochs checked.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!chainData && !isLoadingPerformance && !error && (
        <div className="bg-[var(--bg-secondary)] rounded-xl p-12 border border-[var(--border-color)] text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--bg-primary)] flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[var(--text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            Select a Verifier
          </h3>
          <p className="text-[var(--text-secondary)] max-w-md mx-auto">
            Choose a chain and select a verifier from the dropdown to view their signing performance and pending rewards.
          </p>
        </div>
      )}
    </div>
  );
}
