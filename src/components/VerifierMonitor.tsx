import { useState, useEffect } from 'react';
import type { Verifier, VerifierChainData } from '../types';
import { fetchAllVerifiers, fetchVerifierPerformance } from '../api/verifier';

interface VerifierMonitorProps {
  axlPrice: number | null;
}

export function VerifierMonitor({ axlPrice }: VerifierMonitorProps) {
  const [verifiers, setVerifiers] = useState<Verifier[]>([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [inputAddress, setInputAddress] = useState('');
  const [chainData, setChainData] = useState<VerifierChainData | null>(null);
  const [isLoadingVerifiers, setIsLoadingVerifiers] = useState(false);
  const [isLoadingPerformance, setIsLoadingPerformance] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Load verifiers on mount
  useEffect(() => {
    loadVerifiers();
  }, []);

  const loadVerifiers = async () => {
    setIsLoadingVerifiers(true);
    setError(null);
    try {
      const data = await fetchAllVerifiers('flow');
      setVerifiers(data);
    } catch (err) {
      setError('Failed to load verifiers');
    } finally {
      setIsLoadingVerifiers(false);
    }
  };

  const handleVerifierSelect = (address: string) => {
    setSelectedAddress(address);
    setInputAddress(address);
  };

  const handleLookup = async () => {
    const addressToLookup = inputAddress.trim();
    if (!addressToLookup) return;

    setIsLoadingPerformance(true);
    setError(null);
    setProgressMessage('Starting...');
    setChainData(null);

    try {
      const data = await fetchVerifierPerformance(
        addressToLookup,
        'flow',
        5,
        (msg) => setProgressMessage(msg)
      );

      if (data) {
        setChainData(data);
        setSelectedAddress(addressToLookup);
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

      {/* Verifier Selection */}
      <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-color)]">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          Select Verifier
        </h3>

        {/* Manual Input */}
        <div className="flex gap-3 mb-6">
          <input
            type="text"
            value={inputAddress}
            onChange={(e) => setInputAddress(e.target.value)}
            placeholder="Enter verifier address (axelar1...)"
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
          />
          <button
            onClick={handleLookup}
            disabled={isLoadingPerformance || !inputAddress.trim()}
            className="px-6 py-2 rounded-lg bg-[var(--accent-blue)] text-white font-medium hover:bg-[var(--accent-blue)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoadingPerformance ? 'Loading...' : 'Look Up'}
          </button>
        </div>

        {/* Progress Message */}
        {progressMessage && (
          <div className="mb-4 text-sm text-[var(--text-secondary)] flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {progressMessage}
          </div>
        )}

        {/* Verifier List */}
        <div className="border-t border-[var(--border-color)] pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-[var(--text-secondary)]">
              Active Verifiers (Flow)
            </h4>
            <button
              onClick={loadVerifiers}
              disabled={isLoadingVerifiers}
              className="text-sm text-[var(--accent-blue)] hover:underline disabled:opacity-50"
            >
              {isLoadingVerifiers ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {isLoadingVerifiers ? (
            <div className="text-center py-8 text-[var(--text-secondary)]">
              Loading verifiers...
            </div>
          ) : verifiers.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-secondary)]">
              No verifiers found
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {verifiers.map((v) => (
                <button
                  key={v.address}
                  onClick={() => handleVerifierSelect(v.address)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedAddress === v.address
                      ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]'
                      : 'hover:bg-[var(--bg-primary)] text-[var(--text-primary)]'
                  }`}
                >
                  <span className="font-mono">{v.address}</span>
                  <span className="text-[var(--text-secondary)] ml-2">
                    ({v.bondedAmount.toLocaleString()} AXL bonded)
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
              <div className="text-sm text-[var(--text-secondary)] mb-1">Rewards/Epoch</div>
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {chainData.rewardsPerEpoch.toFixed(2)}
                <span className="text-sm font-normal text-[var(--text-secondary)] ml-1">AXL</span>
              </div>
            </div>
            <div className="bg-[var(--bg-secondary)] rounded-xl p-4 border border-[var(--border-color)]">
              <div className="text-sm text-[var(--text-secondary)] mb-1">Est. Pending</div>
              <div className="text-2xl font-bold text-[var(--accent-green)]">
                ~{chainData.estimatedPendingRewards.toFixed(0)}
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
                Signing Performance (Last {chainData.epochPerformance.length} Epochs)
              </h3>
              <p className="text-sm text-[var(--text-secondary)]">
                Chain: {chainData.chainName.toUpperCase()} | Threshold: 80%
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
            Enter a verifier address above or select one from the list to view their signing performance and pending rewards.
          </p>
        </div>
      )}
    </div>
  );
}
