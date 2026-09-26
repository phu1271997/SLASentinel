import React, { useState, useEffect } from 'react';
import { getGenLayerClient } from './lib/client';
import { connectWallet } from './lib/wallet';
import { SLA_CONTRACT } from './lib/addresses';
import {
  Shield,
  ShieldCheck,
  Server,
  FileWarning,
  ExternalLink,
  PlusCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Activity,
  Gauge,
  Wallet,
  Scale,
  Brain,
  Clock,
  Coins,
  Layers,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

// ---------- Types ----------
interface Stats {
  total_programs: number;
  total_claims: number;
  tvl_reserve: string;
  fee_pool: string;
}

interface Program {
  program_id: string;
  provider: string;
  service_name: string;
  sla_url: string;
  uptime_target_bps: number;
  reserve: string;
  fee_bps: number;
  challenge_window_secs: number;
  open: boolean;
  total_paid: string;
}

interface Claim {
  claim_id: string;
  program_id: string;
  customer: string;
  month: string;
  claimed_downtime_min: number;
  evidence_url: string;
  bond: string;
  state: string; // OPEN | CHALLENGE_WINDOW | SETTLED | REJECTED
  verdict: string; // UPHELD | REJECTED
  tier: string; // CRITICAL | MAJOR | MINOR
  reason: string;
  confidence: number;
  credit_amount: string;
  challenge_deadline: number;
  rebuttal_url: string;
  created_at: number;
}

const EXPLORER_ADDR = `https://genlayer-explorer.vercel.app/address/${SLA_CONTRACT}`;

// ---------- Helpers ----------
const toGen = (wei: string | number | undefined, dp = 3): string => {
  if (wei === undefined || wei === null || wei === '') return '0';
  try {
    return (Number(wei) / 1e18).toFixed(dp);
  } catch {
    return '0';
  }
};

const genToWei = (x: string | number): bigint =>
  BigInt(Math.floor(Number(x) * 1e18));

const short = (a?: string) =>
  a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '—';

const bpsToPct = (bps: number) => (bps / 100).toFixed(2);

export default function App() {
  const [account, setAccount] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [claimable, setClaimable] = useState<string>('0');
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'programs' | 'claims' | 'detail' | 'about'
  >('dashboard');

  const [stats, setStats] = useState<Stats | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [consensusWaiting, setConsensusWaiting] = useState<boolean>(false);
  const [consensusMessage, setConsensusMessage] = useState<string>('');
  const [aiOverlay, setAiOverlay] = useState<boolean>(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Math.floor(Date.now() / 1000));

  // Register program form
  const [showRegister, setShowRegister] = useState(false);
  const [rgName, setRgName] = useState('');
  const [rgUrl, setRgUrl] = useState('');
  const [rgUptime, setRgUptime] = useState('99900');
  const [rgFee, setRgFee] = useState('250');
  const [rgWindow, setRgWindow] = useState('604800');
  const [rgReserve, setRgReserve] = useState('5');

  // File claim form
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimProgramId, setClaimProgramId] = useState<string>('');
  const [clMonth, setClMonth] = useState('2026-08');
  const [clDowntime, setClDowntime] = useState('120');
  const [clEvidence, setClEvidence] = useState('');
  const [clBond, setClBond] = useState('1');


  // Challenge form
  const [showChallenge, setShowChallenge] = useState(false);
  const [chRebuttal, setChRebuttal] = useState('');
  const [chBond, setChBond] = useState('2');

  // countdown ticker
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // ---------- Wallet ----------
  const handleConnect = async () => {
    try {
      setLoading(true);
      const addr = await connectWallet();
      setAccount(addr);
      fetchBalance(addr);
      fetchClaimable(addr);
    } catch (e: any) {
      alert(e.message || 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const fetchBalance = async (addr: string) => {
    try {
      if (typeof window !== 'undefined' && window.ethereum) {
        const res: any = await window.ethereum.request({
          method: 'eth_getBalance',
          params: [addr, 'latest'],
        });
        if (res) {
          setBalance((Number(BigInt(res)) / 1e18).toFixed(3));
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchClaimable = async (addr: string) => {
    try {
      const client = getGenLayerClient();
      const raw: any = await client.readContract({
        address: SLA_CONTRACT,
        functionName: 'get_balance',
        args: [addr],
      });
      const val = typeof raw === 'string' ? raw : String(raw ?? '0');
      // get_balance returns a wei string (possibly JSON-quoted)
      let parsed = val;
      try {
        parsed = JSON.parse(val);
      } catch {
        /* plain string */
      }
      setClaimable(toGen(parsed as any, 4));
    } catch (e) {
      console.error('claimable error', e);
    }
  };

  // ---------- Reads ----------
  const fetchStats = async () => {
    try {
      const client = getGenLayerClient();
      const raw: any = await client.readContract({
        address: SLA_CONTRACT,
        functionName: 'get_stats',
        args: [],
      });
      if (raw) setStats(typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch (e) {
      console.error('stats error', e);
    }
  };

  const fetchPrograms = async () => {
    try {
      const client = getGenLayerClient();
      const raw: any = await client.readContract({
        address: SLA_CONTRACT,
        functionName: 'list_programs',
        args: [0, 100],
      });
      if (raw) {
        const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
        setPrograms(Array.isArray(list) ? list : []);
      }
    } catch (e) {
      console.error('programs error', e);
    }
  };

  const fetchClaims = async () => {
    try {
      const client = getGenLayerClient();
      const raw: any = await client.readContract({
        address: SLA_CONTRACT,
        functionName: 'list_claims',
        args: ['ALL', 0, 100],
      });
      if (raw) {
        const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
        setClaims(Array.isArray(list) ? list : []);
      }
    } catch (e) {
      console.error('claims error', e);
    }
  };

  const fetchClaimDetail = async (id: string) => {
    try {
      setLoading(true);
      const client = getGenLayerClient();
      const raw: any = await client.readContract({
        address: SLA_CONTRACT,
        functionName: 'get_claim',
        args: [id],
      });
      if (raw) setSelectedClaim(typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch (e) {
      console.error('claim detail error', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchPrograms();
    fetchClaims();
  }, []);

  useEffect(() => {
    if (activeTab === 'detail' && selectedClaimId) {
      fetchClaimDetail(selectedClaimId);
    }
  }, [activeTab, selectedClaimId]);

  const refreshAll = () => {
    fetchStats();
    fetchPrograms();
    fetchClaims();
    if (account) {
      fetchBalance(account);
      fetchClaimable(account);
    }
  };

  // ---------- Writes ----------
  const afterTx = async (client: any, tx: any) => {
    setLastTxHash(tx as string);
    await client.waitForTransactionReceipt({ hash: tx as any });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return alert('Please connect your MetaMask wallet');
    try {
      setConsensusWaiting(true);
      setConsensusMessage('Registering SLA program & locking reserve...');
      const client = getGenLayerClient(account as `0x${string}`);
      const reserveWei = genToWei(rgReserve);
      const tx = await client.writeContract({
        address: SLA_CONTRACT,
        functionName: 'register_program',
        args: [
          rgName,
          rgUrl,
          Number(rgUptime),
          Number(rgFee),
          Number(rgWindow),
        ],
        value: reserveWei,
      });
      await afterTx(client, tx);
      alert('SLA program registered on studionet!');
      setShowRegister(false);
      setRgName('');
      setRgUrl('');
      refreshAll();
    } catch (e: any) {
      alert('Transaction error: ' + (e.message || String(e)));
    } finally {
      setConsensusWaiting(false);
    }
  };

  const handleFund = async (programId: string) => {
    if (!account) return alert('Please connect your wallet');
    const amount = window.prompt('Top-up amount in GEN:', '1');
    if (amount === null) return;
    if (!(Number(amount) > 0)) return alert('Enter a positive amount.');
    try {
      setConsensusWaiting(true);
      setConsensusMessage('Topping up program reserve...');
      const client = getGenLayerClient(account as `0x${string}`);
      const tx = await client.writeContract({
        address: SLA_CONTRACT,
        functionName: 'fund_program',
        args: [programId],
        value: genToWei(amount),
      });
      await afterTx(client, tx);
      alert('Reserve funded!');
      refreshAll();
    } catch (e: any) {
      alert('Fund error: ' + (e.message || String(e)));
    } finally {
      setConsensusWaiting(false);
    }
  };

  const handleClose = async (programId: string) => {
    if (!account) return alert('Please connect your wallet');
    if (!confirm('Close this program? Remaining reserve is returned to the provider.'))
      return;
    try {
      setConsensusWaiting(true);
      setConsensusMessage('Closing program...');
      const client = getGenLayerClient(account as `0x${string}`);
      const tx = await client.writeContract({
        address: SLA_CONTRACT,
        functionName: 'close_program',
        args: [programId],
        value: BigInt(0),
      });
      await afterTx(client, tx);
      alert('Program closed.');
      refreshAll();
    } catch (e: any) {
      alert('Close error: ' + (e.message || String(e)));
    } finally {
      setConsensusWaiting(false);
    }
  };

  const handleFileClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return alert('Please connect your wallet');
    try {
      setConsensusWaiting(true);
      setConsensusMessage('Filing SLA breach claim & posting bond...');
      const client = getGenLayerClient(account as `0x${string}`);
      const tx = await client.writeContract({
        address: SLA_CONTRACT,
        functionName: 'file_claim',
        args: [claimProgramId, clMonth, Number(clDowntime), clEvidence],
        value: genToWei(clBond),
      });
      await afterTx(client, tx);
      alert('Claim filed! Run AI adjudication from the Claims tab.');
      setShowClaimModal(false);
      setClEvidence('');
      refreshAll();
      setActiveTab('claims');
    } catch (e: any) {
      alert('File claim error: ' + (e.message || String(e)));
    } finally {
      setConsensusWaiting(false);
    }
  };

  const handleAdjudicate = async (claimId: string) => {
    if (!account) return alert('Please connect your wallet');
    try {
      setAiOverlay(true);
      setConsensusWaiting(true);
      setConsensusMessage('AI validators are reaching consensus...');
      const client = getGenLayerClient(account as `0x${string}`);
      const tx = await client.writeContract({
        address: SLA_CONTRACT,
        functionName: 'adjudicate_claim',
        args: [claimId],
        value: BigInt(0),
      });
      await afterTx(client, tx);
      alert('AI adjudication complete!');
      refreshAll();
      if (selectedClaimId === claimId) fetchClaimDetail(claimId);
    } catch (e: any) {
      alert('Adjudication error: ' + (e.message || String(e)));
    } finally {
      setAiOverlay(false);
      setConsensusWaiting(false);
    }
  };

  const handleChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account || !selectedClaim) return alert('Please connect your wallet');
    try {
      setConsensusWaiting(true);
      setConsensusMessage('Submitting provider challenge & posting bond...');
      const client = getGenLayerClient(account as `0x${string}`);
      const tx = await client.writeContract({
        address: SLA_CONTRACT,
        functionName: 'challenge_claim',
        args: [selectedClaim.claim_id, chRebuttal],
        value: genToWei(chBond),
      });
      await afterTx(client, tx);
      alert('Challenge submitted — AI re-adjudication triggered.');
      setShowChallenge(false);
      setChRebuttal('');
      refreshAll();
      fetchClaimDetail(selectedClaim.claim_id);
    } catch (e: any) {
      alert('Challenge error: ' + (e.message || String(e)));
    } finally {
      setConsensusWaiting(false);
    }
  };

  const handleSettle = async (claimId: string) => {
    if (!account) return alert('Please connect your wallet');
    try {
      setConsensusWaiting(true);
      setConsensusMessage('Settling claim & disbursing service credit...');
      const client = getGenLayerClient(account as `0x${string}`);
      const tx = await client.writeContract({
        address: SLA_CONTRACT,
        functionName: 'settle_claim',
        args: [claimId],
        value: BigInt(0),
      });
      await afterTx(client, tx);
      alert('Claim settled!');
      refreshAll();
      if (selectedClaimId === claimId) fetchClaimDetail(claimId);
    } catch (e: any) {
      alert('Settle error: ' + (e.message || String(e)));
    } finally {
      setConsensusWaiting(false);
    }
  };

  const handleWithdraw = async () => {
    if (!account) return alert('Please connect your wallet');
    try {
      setConsensusWaiting(true);
      setConsensusMessage('Withdrawing your claimable balance...');
      const client = getGenLayerClient(account as `0x${string}`);
      const tx = await client.writeContract({
        address: SLA_CONTRACT,
        functionName: 'withdraw',
        args: [],
        value: BigInt(0),
      });
      await afterTx(client, tx);
      alert('Withdrawal complete!');
      refreshAll();
    } catch (e: any) {
      alert('Withdraw error: ' + (e.message || String(e)));
    } finally {
      setConsensusWaiting(false);
    }
  };

  // ---------- Badges ----------
  const stateBadge = (state: string) => {
    const map: Record<string, string> = {
      OPEN: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      CHALLENGE_WINDOW:
        'bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse',
      SETTLED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      REJECTED: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    };
    return (
      <span
        className={`px-2.5 py-0.5 rounded-full font-semibold text-[10px] border ${
          map[state] || 'bg-gray-500/10 text-gray-400 border-gray-500/20'
        }`}
      >
        {state?.replace('_', ' ') || 'UNKNOWN'}
      </span>
    );
  };

  const tierBadge = (tier: string) => {
    const map: Record<string, string> = {
      CRITICAL: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
      MAJOR: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
      MINOR: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    };
    return (
      <span
        className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] border ${
          map[tier] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'
        }`}
      >
        {tier}
      </span>
    );
  };

  const verdictBadge = (verdict: string) => {
    if (!verdict) return null;
    const upheld = verdict === 'UPHELD';
    return (
      <span
        className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] border inline-flex items-center gap-1 ${
          upheld
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
            : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
        }`}
      >
        {upheld ? (
          <CheckCircle2 className="w-3 h-3" />
        ) : (
          <XCircle className="w-3 h-3" />
        )}
        {verdict}
      </span>
    );
  };

  const countdown = (deadline: number) => {
    const diff = deadline - now;
    if (diff <= 0) return 'window elapsed';
    const d = Math.floor(diff / 86400);
    const h = Math.floor((diff % 86400) / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  const programName = (pid: string) =>
    programs.find((p) => p.program_id === pid)?.service_name || `#${pid}`;

  const providerOf = (pid: string) =>
    programs.find((p) => p.program_id === pid)?.provider;

  const openClaimDetail = (id: string) => {
    setSelectedClaimId(id);
    setActiveTab('detail');
  };

  const openFileClaim = (pid: string) => {
    if (!account) return alert('Please connect your wallet first');
    setClaimProgramId(pid);
    setShowClaimModal(true);
  };

  // ---------- Render ----------
  return (
    <div className="min-h-screen flex flex-col bg-[#070B14] text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-[#0B0F19]/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div
            className="flex items-center space-x-3 cursor-pointer"
            onClick={() => setActiveTab('dashboard')}
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-sky-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-lg tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                SLASentinel
              </div>
              <div className="hidden sm:block text-[10px] text-indigo-400 font-medium tracking-wide">
                Autonomous SLA Service-Credit Arbiter on GenLayer
              </div>
            </div>
          </div>

          <nav className="hidden md:flex items-center space-x-1 text-sm font-medium">
            {(
              [
                ['dashboard', 'Dashboard'],
                ['programs', 'Programs'],
                ['claims', 'Claims'],
                ['about', 'How It Works'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`px-3 py-1.5 rounded-lg transition ${
                  activeTab === id
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center space-x-3">
            {account ? (
              <div className="flex items-center space-x-2 bg-gray-900 border border-gray-800 px-3 py-1.5 rounded-xl text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="font-mono text-gray-300">{short(account)}</span>
                <span className="text-indigo-400 font-semibold pl-1 border-l border-gray-700">
                  {balance} GEN
                </span>
              </div>
            ) : (
              <button
                onClick={handleConnect}
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition shadow-lg shadow-indigo-600/20 flex items-center space-x-1.5"
              >
                <Wallet className="w-4 h-4" />
                <span>Connect Wallet</span>
              </button>
            )}
          </div>
        </div>

        {/* mobile nav */}
        <div className="md:hidden flex items-center gap-1 px-4 pb-2 text-xs font-medium overflow-x-auto">
          {(
            [
              ['dashboard', 'Dashboard'],
              ['programs', 'Programs'],
              ['claims', 'Claims'],
              ['about', 'How It Works'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-3 py-1.5 rounded-lg transition whitespace-nowrap ${
                activeTab === id
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Low balance banner */}
      {account && Number(balance) === 0 && (
        <div className="bg-amber-950/40 border-b border-amber-800/60 px-4 py-2 text-xs text-amber-200 flex items-center justify-center space-x-2 text-center">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Connected wallet has 0 GEN on studionet. Open{' '}
            <a
              href="https://studio.genlayer.com"
              target="_blank"
              rel="noreferrer"
              className="underline font-bold text-amber-300 hover:text-white"
            >
              GenLayer Studio &rarr; Accounts panel
            </a>{' '}
            to transfer test GEN.
          </span>
        </div>
      )}

      {/* Consensus banner */}
      {consensusWaiting && (
        <div className="bg-indigo-950/80 border-b border-indigo-700/60 px-4 py-3 text-xs text-indigo-100 flex items-center justify-center space-x-3">
          <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
          <div className="text-center">
            <span className="font-bold text-indigo-300">{consensusMessage}</span>{' '}
            {lastTxHash && (
              <a
                href={`https://genlayer-explorer.vercel.app/tx/${lastTxHash}`}
                target="_blank"
                rel="noreferrer"
                className="ml-2 underline text-indigo-300 hover:text-white inline-flex items-center"
              >
                View tx <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* AI overlay */}
      {aiOverlay && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="max-w-md w-full bg-gray-900 border border-indigo-500/40 rounded-3xl p-8 text-center space-y-5">
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20"></div>
              <div className="absolute inset-0 rounded-full border-4 border-t-indigo-400 border-transparent animate-spin"></div>
              <Brain className="w-9 h-9 text-indigo-400 absolute inset-0 m-auto" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">
                AI validators are reaching consensus
              </h3>
              <p className="text-sm text-gray-400 mt-2">
                Multiple LLM validators independently read the evidence URL and
                the SLA policy, then vote on the verdict, breach tier and credit
                amount. This can take a minute — please keep this tab open.
              </p>
            </div>
            {lastTxHash && (
              <a
                href={`https://genlayer-explorer.vercel.app/tx/${lastTxHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
              >
                Track on Explorer <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ---------- DASHBOARD ---------- */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="rounded-3xl border border-gray-800 bg-gradient-to-br from-indigo-950/40 via-gray-900/40 to-gray-900/10 p-8 sm:p-10">
              <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold mb-3">
                <Sparkles className="w-4 h-4" />
                POWERED BY GENLAYER INTELLIGENT CONTRACTS
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight max-w-3xl">
                Autonomous SLA service-credit arbitration, judged on-chain by AI.
              </h1>
              <p className="text-sm text-gray-400 mt-3 max-w-2xl">
                Providers post reserves against their published uptime SLAs.
                Customers file breach claims with evidence. GenLayer AI validators
                read the evidence and the SLA policy directly on-chain, reach
                consensus on the verdict, breach tier and service-credit amount —
                no oracle, no middleman.
              </p>
              <div className="flex flex-wrap gap-3 mt-6">
                <button
                  onClick={() => setActiveTab('programs')}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2 shadow-lg shadow-indigo-600/20"
                >
                  <Server className="w-4 h-4" /> Browse Programs
                </button>
                <button
                  onClick={() => setActiveTab('claims')}
                  className="bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2"
                >
                  <FileWarning className="w-4 h-4" /> View Claims
                </button>
                <a
                  href={EXPLORER_ADDR}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2"
                >
                  Contract <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              <StatCard
                icon={<Coins className="w-5 h-5 text-emerald-400" />}
                label="TVL Reserve"
                value={`${toGen(stats?.tvl_reserve)} GEN`}
                accent="emerald"
              />
              <StatCard
                icon={<Server className="w-5 h-5 text-indigo-400" />}
                label="Total Programs"
                value={String(stats?.total_programs ?? 0)}
                accent="indigo"
              />
              <StatCard
                icon={<FileWarning className="w-5 h-5 text-amber-400" />}
                label="Total Claims"
                value={String(stats?.total_claims ?? 0)}
                accent="amber"
              />
              <StatCard
                icon={<Layers className="w-5 h-5 text-sky-400" />}
                label="Fee Pool"
                value={`${toGen(stats?.fee_pool)} GEN`}
                accent="sky"
              />
            </div>

            {/* Withdraw */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">
                    Your claimable balance
                  </div>
                  <div className="text-xs text-gray-400">
                    Payouts (credits, returned bonds, provider withdrawals) accrue
                    here via the pull pattern.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-emerald-400">
                    {claimable} GEN
                  </div>
                </div>
                <button
                  onClick={handleWithdraw}
                  disabled={!account || consensusWaiting || Number(claimable) === 0}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
                >
                  Withdraw
                </button>
              </div>
            </div>

            {/* Recent claims preview */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-indigo-400" /> Recent Claims
                </h2>
                <button
                  onClick={() => setActiveTab('claims')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  View all <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {claims.slice(0, 3).map((c) => (
                  <ClaimCard
                    key={c.claim_id}
                    c={c}
                    onClick={() => openClaimDetail(c.claim_id)}
                    programName={programName(c.program_id)}
                    stateBadge={stateBadge}
                    verdictBadge={verdictBadge}
                    tierBadge={tierBadge}
                  />
                ))}
                {claims.length === 0 && (
                  <EmptyState
                    icon={<FileWarning className="w-10 h-10" />}
                    title="No claims yet"
                    subtitle="Filed SLA breach claims will appear here."
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---------- PROGRAMS ---------- */}
        {activeTab === 'programs' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-white tracking-tight">
                  SLA Programs
                </h1>
                <p className="text-sm text-gray-400 mt-1">
                  Providers register an uptime SLA, publish a signed policy, and
                  lock a GEN reserve to back service credits.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={refreshAll}
                  className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold px-4 py-2 rounded-xl transition flex items-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
                <button
                  onClick={() => {
                    if (!account) return alert('Please connect your wallet first');
                    setShowRegister(true);
                  }}
                  className="bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition flex items-center gap-2 shadow-lg shadow-indigo-600/20"
                >
                  <PlusCircle className="w-4 h-4" /> Register Program
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {programs.map((p) => (
                <div
                  key={p.program_id}
                  className="bg-gray-900/60 border border-gray-800 hover:border-indigo-500/50 rounded-2xl p-5 transition flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3 text-xs">
                      <span className="font-mono text-gray-400">
                        Program #{p.program_id}
                      </span>
                      {p.open ? (
                        <span className="px-2.5 py-0.5 rounded-full font-semibold text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          OPEN
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full font-semibold text-[10px] bg-gray-500/10 text-gray-400 border border-gray-500/20">
                          CLOSED
                        </span>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-gray-100 group-hover:text-indigo-400 transition mb-1 flex items-center gap-2">
                      <Server className="w-4 h-4 text-indigo-400 shrink-0" />
                      {p.service_name}
                    </h3>
                    <div className="text-[11px] text-gray-500 font-mono mb-4">
                      by {short(p.provider)}
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <Metric
                        icon={<Gauge className="w-3.5 h-3.5 text-sky-400" />}
                        label="Uptime target"
                        value={`${bpsToPct(p.uptime_target_bps)}%`}
                      />
                      <Metric
                        icon={<Coins className="w-3.5 h-3.5 text-emerald-400" />}
                        label="Reserve"
                        value={`${toGen(p.reserve)} GEN`}
                      />
                      <Metric
                        icon={<Scale className="w-3.5 h-3.5 text-amber-400" />}
                        label="Fee"
                        value={`${bpsToPct(p.fee_bps)}%`}
                      />
                      <Metric
                        icon={<Clock className="w-3.5 h-3.5 text-indigo-400" />}
                        label="Challenge win."
                        value={`${Math.round(
                          p.challenge_window_secs / 86400
                        )}d`}
                      />
                    </div>

                    <div className="mt-3 text-xs flex items-center justify-between text-gray-400">
                      <span>Total paid out</span>
                      <span className="font-semibold text-gray-200">
                        {toGen(p.total_paid)} GEN
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-gray-800/80 pt-4 mt-4 space-y-2">
                    <a
                      href={p.sla_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 break-all"
                    >
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" /> SLA policy
                      (pinned commit)
                    </a>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => openFileClaim(p.program_id)}
                        disabled={!p.open}
                        className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded-xl transition flex items-center justify-center gap-1.5"
                      >
                        <FileWarning className="w-3.5 h-3.5" /> File a claim
                      </button>
                      {account &&
                        p.provider.toLowerCase() === account.toLowerCase() &&
                        p.open && (
                          <>
                            <button
                              onClick={() => handleFund(p.program_id)}
                              className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold px-3 py-2 rounded-xl transition"
                              title="Top up reserve"
                            >
                              Fund
                            </button>
                            <button
                              onClick={() => handleClose(p.program_id)}
                              className="bg-gray-800 hover:bg-rose-900/60 text-gray-200 text-xs font-semibold px-3 py-2 rounded-xl transition"
                            >
                              Close
                            </button>
                          </>
                        )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {programs.length === 0 && (
              <EmptyState
                icon={<Server className="w-12 h-12" />}
                title="No SLA programs yet"
                subtitle="Be the first provider to register an uptime SLA and back it with a reserve."
              />
            )}
          </div>
        )}

        {/* ---------- CLAIMS ---------- */}
        {activeTab === 'claims' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-white tracking-tight">
                  Breach Claims
                </h1>
                <p className="text-sm text-gray-400 mt-1">
                  Every claim is adjudicated by GenLayer AI validators. The AI's
                  reasoning is always shown in full.
                </p>
              </div>
              <button
                onClick={refreshAll}
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold px-4 py-2 rounded-xl transition flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {claims.map((c) => (
                <ClaimCard
                  key={c.claim_id}
                  c={c}
                  onClick={() => openClaimDetail(c.claim_id)}
                  programName={programName(c.program_id)}
                  stateBadge={stateBadge}
                  verdictBadge={verdictBadge}
                  tierBadge={tierBadge}
                />
              ))}
            </div>

            {claims.length === 0 && (
              <EmptyState
                icon={<FileWarning className="w-12 h-12" />}
                title="No claims filed yet"
                subtitle="File a breach claim from any open program in the Programs tab."
              />
            )}
          </div>
        )}

        {/* ---------- CLAIM DETAIL ---------- */}
        {activeTab === 'detail' && selectedClaim && (
          <ClaimDetail
            c={selectedClaim}
            account={account}
            now={now}
            programName={programName(selectedClaim.program_id)}
            provider={providerOf(selectedClaim.program_id)}
            loading={loading}
            consensusWaiting={consensusWaiting}
            onBack={() => setActiveTab('claims')}
            onAdjudicate={() => handleAdjudicate(selectedClaim.claim_id)}
            onSettle={() => handleSettle(selectedClaim.claim_id)}
            onOpenChallenge={() => setShowChallenge(true)}
            stateBadge={stateBadge}
            verdictBadge={verdictBadge}
            tierBadge={tierBadge}
            countdown={countdown}
          />
        )}

        {/* ---------- ABOUT ---------- */}
        {activeTab === 'about' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              How SLASentinel Works
            </h1>
            <div className="prose prose-invert text-sm text-gray-300 space-y-4">
              <p>
                SLASentinel is an autonomous arbiter for Service-Level Agreement
                (SLA) service credits. Cloud and infrastructure providers publish
                their uptime commitments; when they fall short, customers are owed
                credits. Traditionally settling those disputes requires trust,
                paperwork and goodwill. SLASentinel replaces that with a GenLayer
                Intelligent Contract that reads the evidence and the SLA policy
                directly and rules autonomously.
              </p>

              <h3 className="text-lg font-bold text-white mt-6">The lifecycle</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>Register:</strong> A provider registers a program with a
                  service name, an HTTPS SLA policy URL pinned to a specific commit
                  SHA, an uptime target (bps), a fee (bps) and a challenge window,
                  and locks a reserve (&ge; 5 GEN).
                </li>
                <li>
                  <strong>File a claim:</strong> A customer files a breach claim for
                  a given month with claimed downtime minutes and an HTTPS evidence
                  URL, posting a bond (&ge; 1 GEN).
                </li>
                <li>
                  <strong>AI adjudication:</strong> Anyone triggers{' '}
                  <code>adjudicate_claim</code>. GenLayer validators fetch the
                  evidence and the pinned SLA policy on-chain, then reach consensus
                  on a verdict (UPHELD / REJECTED), a breach tier
                  (CRITICAL / MAJOR / MINOR), a confidence score, and the exact
                  service-credit amount.
                </li>
                <li>
                  <strong>Challenge window:</strong> An upheld claim enters a
                  challenge window. The provider may post a challenge bond
                  (&ge; 2 GEN) with a rebuttal URL to force re-adjudication.
                </li>
                <li>
                  <strong>Settle:</strong> Once the window elapses, anyone settles
                  the claim; the credit is disbursed from the reserve and bonds are
                  resolved. All payouts use a safe pull pattern —{' '}
                  <code>withdraw()</code> to collect.
                </li>
              </ul>

              <h3 className="text-lg font-bold text-white mt-6">
                Why GenLayer is essential
              </h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>On-chain evidence reading:</strong> validators fetch
                  status-page snapshots and incident reports from the cited URL in
                  real time — no oracle.
                </li>
                <li>
                  <strong>Policy-aware reasoning:</strong> the SLA policy is pinned
                  to a commit SHA so the rules being judged are immutable and
                  auditable.
                </li>
                <li>
                  <strong>Subjective consensus:</strong> multiple LLM validators
                  independently interpret downtime against the SLA and converge on a
                  verdict, tier and credit amount with a confidence score.
                </li>
              </ul>
            </div>
            <a
              href={EXPLORER_ADDR}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 text-sm"
            >
              View the SLASentinel contract on Explorer{' '}
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-500">
          <span>SLASentinel · Autonomous SLA Service-Credit Arbiter on GenLayer Studionet</span>
          <a
            href={EXPLORER_ADDR}
            target="_blank"
            rel="noreferrer"
            className="font-mono hover:text-indigo-400 flex items-center gap-1"
          >
            {short(SLA_CONTRACT)} <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </footer>

      {/* ---------- REGISTER MODAL ---------- */}
      {showRegister && (
        <Modal onClose={() => setShowRegister(false)} title="Register SLA Program">
          <form onSubmit={handleRegister} className="space-y-4">
            <Field label="Service name">
              <input
                type="text"
                value={rgName}
                onChange={(e) => setRgName(e.target.value)}
                placeholder="e.g. Acme Cloud Compute API"
                className={inputCls}
                required
              />
            </Field>
            <Field label="SLA policy URL (HTTPS github.com / raw.githubusercontent.com, pinned to a commit SHA)">
              <input
                type="url"
                value={rgUrl}
                onChange={(e) => setRgUrl(e.target.value)}
                placeholder="https://raw.githubusercontent.com/acme/sla/<commit-sha>/sla.md"
                className={inputCls}
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Uptime target (bps, e.g. 99900 = 99.90%)">
                <input
                  type="number"
                  value={rgUptime}
                  onChange={(e) => setRgUptime(e.target.value)}
                  className={inputCls}
                  required
                />
              </Field>
              <Field label="Fee (bps, e.g. 250 = 2.5%)">
                <input
                  type="number"
                  value={rgFee}
                  onChange={(e) => setRgFee(e.target.value)}
                  className={inputCls}
                  required
                />
              </Field>
              <Field label="Challenge window (secs, e.g. 604800 = 7d)">
                <input
                  type="number"
                  value={rgWindow}
                  onChange={(e) => setRgWindow(e.target.value)}
                  className={inputCls}
                  required
                />
              </Field>
              <Field label="Reserve (GEN, min 5)">
                <input
                  type="number"
                  step="0.1"
                  min="5"
                  value={rgReserve}
                  onChange={(e) => setRgReserve(e.target.value)}
                  className={inputCls}
                  required
                />
              </Field>
            </div>
            <ModalActions
              onCancel={() => setShowRegister(false)}
              busy={consensusWaiting}
              submitLabel={`Lock ${rgReserve} GEN & Register`}
            />
          </form>
        </Modal>
      )}

      {/* ---------- FILE CLAIM MODAL ---------- */}
      {showClaimModal && (
        <Modal
          onClose={() => setShowClaimModal(false)}
          title={`File Claim · ${programName(claimProgramId)}`}
        >
          <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-xl p-3 text-xs text-indigo-200 mb-4">
            Provide the affected month and an HTTPS evidence URL (status page,
            incident report). Your bond is returned if the claim is upheld.
          </div>
          <form onSubmit={handleFileClaim} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Month (YYYY-MM)">
                <input
                  type="text"
                  value={clMonth}
                  onChange={(e) => setClMonth(e.target.value)}
                  placeholder="2026-08"
                  className={inputCls}
                  required
                />
              </Field>
              <Field label="Claimed downtime (minutes)">
                <input
                  type="number"
                  min="1"
                  value={clDowntime}
                  onChange={(e) => setClDowntime(e.target.value)}
                  className={inputCls}
                  required
                />
              </Field>
            </div>
            <Field label="Evidence URL (HTTPS)">
              <input
                type="url"
                value={clEvidence}
                onChange={(e) => setClEvidence(e.target.value)}
                placeholder="https://status.acme.com/incidents/..."
                className={inputCls}
                required
              />
            </Field>
            <Field label="Bond (GEN, min 1)">
              <input
                type="number"
                step="0.1"
                min="1"
                value={clBond}
                onChange={(e) => setClBond(e.target.value)}
                className={inputCls}
                required
              />
            </Field>
            <ModalActions
              onCancel={() => setShowClaimModal(false)}
              busy={consensusWaiting}
              submitLabel={`Post ${clBond} GEN bond & File`}
            />
          </form>
        </Modal>
      )}

      {/* ---------- CHALLENGE MODAL ---------- */}
      {showChallenge && selectedClaim && (
        <Modal
          onClose={() => setShowChallenge(false)}
          title="Challenge Claim (Provider)"
        >
          <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-xs text-amber-200 mb-4">
            As the provider you can dispute this upheld claim by posting a
            challenge bond (&ge; 2 GEN) and a rebuttal URL. This triggers AI
            re-adjudication.
          </div>
          <form onSubmit={handleChallenge} className="space-y-4">
            <Field label="Rebuttal URL (HTTPS)">
              <input
                type="url"
                value={chRebuttal}
                onChange={(e) => setChRebuttal(e.target.value)}
                placeholder="https://status.acme.com/postmortem/..."
                className={inputCls}
                required
              />
            </Field>
            <Field label="Challenge bond (GEN, min 2)">
              <input
                type="number"
                step="0.1"
                min="2"
                value={chBond}
                onChange={(e) => setChBond(e.target.value)}
                className={inputCls}
                required
              />
            </Field>
            <ModalActions
              onCancel={() => setShowChallenge(false)}
              busy={consensusWaiting}
              submitLabel={`Post ${chBond} GEN & Challenge`}
            />
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------- Shared styles ----------
const inputCls =
  'w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-sm text-gray-100 focus:outline-none focus:border-indigo-500';

// ---------- Small components ----------
const ACCENTS: Record<string, string> = {
  emerald: 'bg-emerald-500/10 border-emerald-500/20',
  indigo: 'bg-indigo-500/10 border-indigo-500/20',
  amber: 'bg-amber-500/10 border-amber-500/20',
  sky: 'bg-sky-500/10 border-sky-500/20',
};

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5">
      <div
        className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-4 ${
          ACCENTS[accent] || 'bg-gray-500/10 border-gray-500/20'
        }`}
      >
        {icon}
      </div>
      <div className="text-2xl font-extrabold text-white leading-none">
        {value}
      </div>
      <div className="text-xs text-gray-400 mt-1.5 uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-gray-950/60 border border-gray-800/70 rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mb-0.5">
        {icon} {label}
      </div>
      <div className="text-sm font-semibold text-gray-100">{value}</div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="col-span-full text-center py-16 bg-gray-900/30 rounded-2xl border border-gray-800/60">
      <div className="mx-auto text-gray-600 mb-3 flex justify-center">{icon}</div>
      <h3 className="text-base font-semibold text-gray-300">{title}</h3>
      <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
    </div>
  );
}

function ClaimCard({
  c,
  onClick,
  programName,
  stateBadge,
  verdictBadge,
  tierBadge,
}: {
  c: Claim;
  onClick: () => void;
  programName: string;
  stateBadge: (s: string) => React.ReactNode;
  verdictBadge: (v: string) => React.ReactNode;
  tierBadge: (t: string) => React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className="bg-gray-900/60 border border-gray-800 hover:border-indigo-500/50 rounded-2xl p-5 transition cursor-pointer flex flex-col justify-between group"
    >
      <div>
        <div className="flex items-center justify-between mb-3 text-xs">
          <span className="font-mono text-gray-400">Claim #{c.claim_id}</span>
          {stateBadge(c.state)}
        </div>
        <h3 className="text-sm font-bold text-gray-100 group-hover:text-indigo-400 transition mb-1">
          {programName}
        </h3>
        <div className="text-xs text-gray-400 flex flex-wrap gap-x-4 gap-y-1 mb-3">
          <span>Month: <span className="text-gray-200">{c.month}</span></span>
          <span>
            Downtime:{' '}
            <span className="text-gray-200">{c.claimed_downtime_min} min</span>
          </span>
          <span>
            Bond: <span className="text-gray-200">{toGen(c.bond)} GEN</span>
          </span>
        </div>

        {(c.verdict || c.tier) && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {verdictBadge(c.verdict)}
            {c.tier && tierBadge(c.tier)}
            {c.confidence > 0 && (
              <span className="text-[10px] text-gray-400">
                {c.confidence}% conf.
              </span>
            )}
          </div>
        )}

        {c.reason && (
          <div className="bg-gray-950/60 border border-gray-800/70 rounded-lg p-3 mb-2">
            <div className="flex items-center gap-1.5 text-[10px] text-indigo-400 font-semibold mb-1">
              <Brain className="w-3 h-3" /> AI VERDICT REASONING
            </div>
            <p className="text-xs text-gray-300 leading-relaxed line-clamp-4 italic">
              "{c.reason}"
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-gray-800/80 pt-3 mt-2 flex items-center justify-between text-xs">
        {Number(c.credit_amount) > 0 ? (
          <span className="text-emerald-400 font-semibold">
            Credit: {toGen(c.credit_amount)} GEN
          </span>
        ) : (
          <span className="text-gray-500">No credit yet</span>
        )}
        <span className="text-indigo-400 group-hover:text-indigo-300 flex items-center gap-1">
          Details <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </div>
  );
}

function ClaimDetail({
  c,
  account,
  now,
  programName,
  provider,
  loading,
  consensusWaiting,
  onBack,
  onAdjudicate,
  onSettle,
  onOpenChallenge,
  stateBadge,
  verdictBadge,
  tierBadge,
  countdown,
}: {
  c: Claim;
  account: string | null;
  now: number;
  programName: string;
  provider?: string;
  loading: boolean;
  consensusWaiting: boolean;
  onBack: () => void;
  onAdjudicate: () => void;
  onSettle: () => void;
  onOpenChallenge: () => void;
  stateBadge: (s: string) => React.ReactNode;
  verdictBadge: (v: string) => React.ReactNode;
  tierBadge: (t: string) => React.ReactNode;
  countdown: (d: number) => string;
}) {
  const isProvider =
    !!account && !!provider && account.toLowerCase() === provider.toLowerCase();
  const windowElapsed = c.challenge_deadline > 0 && now >= c.challenge_deadline;

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition"
      >
        &larr; Back to all claims
      </button>

      <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex items-center flex-wrap gap-3 text-xs mb-3">
              <span className="font-mono text-gray-400">Claim #{c.claim_id}</span>
              {stateBadge(c.state)}
              {verdictBadge(c.verdict)}
              {c.tier && tierBadge(c.tier)}
            </div>
            <h1 className="text-2xl font-extrabold text-white leading-tight mb-1">
              {programName}
            </h1>
            <div className="text-xs text-gray-500 font-mono">
              Program #{c.program_id} · filed by {c.customer.slice(0, 6)}...
              {c.customer.slice(-4)}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5 text-xs">
              <Metric
                icon={<Clock className="w-3.5 h-3.5 text-indigo-400" />}
                label="Month"
                value={c.month}
              />
              <Metric
                icon={<Activity className="w-3.5 h-3.5 text-rose-400" />}
                label="Downtime"
                value={`${c.claimed_downtime_min} min`}
              />
              <Metric
                icon={<Coins className="w-3.5 h-3.5 text-amber-400" />}
                label="Bond"
                value={`${toGen(c.bond)} GEN`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-4 text-xs">
              {c.evidence_url && (
                <a
                  href={c.evidence_url}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-indigo-400 flex items-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Evidence
                </a>
              )}
              {c.rebuttal_url && (
                <a
                  href={c.rebuttal_url}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-amber-400 flex items-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Provider rebuttal
                </a>
              )}
              <a
                href={EXPLORER_ADDR}
                target="_blank"
                rel="noreferrer"
                className="bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-gray-300 flex items-center gap-1.5 transition"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Contract on Explorer
              </a>
            </div>
          </div>

          {/* Outcome box */}
          <div className="bg-gray-950/80 border border-gray-800 rounded-2xl p-5 min-w-[240px]">
            <div className="text-xs text-gray-400 mb-1">Service credit</div>
            <div
              className={`text-2xl font-extrabold mb-4 ${
                Number(c.credit_amount) > 0 ? 'text-emerald-400' : 'text-gray-500'
              }`}
            >
              {toGen(c.credit_amount)} GEN
            </div>
            <div className="space-y-2 text-xs border-t border-gray-800 pt-3">
              {c.confidence > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">AI confidence</span>
                  <span className="font-bold text-indigo-400">
                    {c.confidence}%
                  </span>
                </div>
              )}
              {c.challenge_deadline > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Challenge window</span>
                  <span
                    className={`font-semibold ${
                      windowElapsed ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {countdown(c.challenge_deadline)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI reason — never hidden */}
        {c.reason ? (
          <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-5 h-5 text-indigo-400" />
              <h4 className="font-bold text-base text-indigo-300">
                AI Validator Consensus Reasoning
              </h4>
              {c.confidence > 0 && (
                <div className="ml-auto flex items-center gap-2 text-xs">
                  <div className="w-24 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-indigo-400 h-full rounded-full"
                      style={{ width: `${c.confidence}%` }}
                    ></div>
                  </div>
                  <span className="font-bold text-indigo-400">
                    {c.confidence}%
                  </span>
                </div>
              )}
            </div>
            <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
              {c.reason}
            </p>
          </div>
        ) : (
          <div className="bg-gray-950/50 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400 flex items-center gap-2">
            <Brain className="w-5 h-5 text-gray-500" />
            This claim has not been adjudicated yet. Run AI adjudication to get a
            verdict, tier and credit amount.
          </div>
        )}

        {/* State-driven actions */}
        <div className="border-t border-gray-800/80 pt-6">
          {c.state === 'OPEN' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs text-gray-400">
                AI validators will read the evidence and the SLA policy on-chain
                and reach consensus. This can take a minute.
              </span>
              <button
                onClick={onAdjudicate}
                disabled={!account || consensusWaiting}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                <Brain className="w-4 h-4" /> Run AI adjudication
              </button>
            </div>
          )}

          {c.state === 'CHALLENGE_WINDOW' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-blue-300">
                <ShieldCheck className="w-5 h-5" />
                <span className="font-semibold">
                  In challenge window —{' '}
                  {windowElapsed
                    ? 'window elapsed, ready to settle.'
                    : `${countdown(c.challenge_deadline)} remaining.`}
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                {isProvider && !windowElapsed && (
                  <button
                    onClick={onOpenChallenge}
                    disabled={consensusWaiting}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2"
                  >
                    <Scale className="w-4 h-4" /> Challenge (provider)
                  </button>
                )}
                <button
                  onClick={onSettle}
                  disabled={!account || consensusWaiting || !windowElapsed}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2"
                  title={windowElapsed ? '' : 'Available once the window elapses'}
                >
                  <CheckCircle2 className="w-4 h-4" /> Settle
                </button>
              </div>
            </div>
          )}

          {(c.state === 'SETTLED' || c.state === 'REJECTED') && (
            <div
              className={`rounded-2xl p-5 flex items-start gap-3 ${
                c.state === 'SETTLED'
                  ? 'bg-emerald-950/30 border border-emerald-500/30'
                  : 'bg-rose-950/30 border border-rose-500/30'
              }`}
            >
              {c.state === 'SETTLED' ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
              ) : (
                <XCircle className="w-6 h-6 text-rose-400 shrink-0" />
              )}
              <div>
                <div
                  className={`font-bold ${
                    c.state === 'SETTLED' ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {c.state === 'SETTLED'
                    ? `Settled — ${toGen(c.credit_amount)} GEN service credit disbursed.`
                    : 'Claim rejected — no credit owed.'}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Any funds owed to you (credits, returned bonds) are collectable
                  via Withdraw on the Dashboard.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="text-center text-xs text-gray-500 flex items-center justify-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Refreshing claim...
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 border border-gray-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-300 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function ModalActions({
  onCancel,
  busy,
  submitLabel,
}: {
  onCancel: () => void;
  busy: boolean;
  submitLabel: string;
}) {
  return (
    <div className="pt-4 flex gap-3">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold py-3 rounded-xl transition"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy}
        className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold py-3 rounded-xl transition shadow-lg shadow-indigo-600/20"
      >
        {busy ? 'Submitting...' : submitLabel}
      </button>
    </div>
  );
}
