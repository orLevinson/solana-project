import { useEffect, useState } from 'react';
import { Wallet, TrendingUp, TrendingDown, Crosshair, Target } from 'lucide-react';
import { api } from '../api';

export function Overview() {
  const [balance, setBalance] = useState<any>(null);
  const [pnl, setPnl] = useState<any>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [balRes, pnlRes] = await Promise.all([api.getBalance(), api.getPnl()]);
        setBalance(balRes);
        setPnl(pnlRes);
      } catch (e) {
        console.error('Failed to fetch stats', e);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!balance || !pnl) return <div className="glass-panel p-6 animate-pulse h-32"></div>;

  const isNetPositive = pnl.netPnl >= 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {/* Balance Card */}
      <div className="glass-panel p-6 border-l-4 border-l-primary flex items-center justify-between">
        <div>
          <p className="text-textMuted text-sm font-medium mb-1">Account Balance</p>
          <div className="flex items-end gap-2">
            <h2 className="text-3xl font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
              {balance.balanceSol.toFixed(4)}
            </h2>
            <span className="text-primary text-sm font-semibold mb-1">SOL</span>
          </div>
          {balance.isDryRun && (
             <span className="inline-block mt-2 px-2 py-0.5 text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded">
               DRY RUN
             </span>
          )}
        </div>
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
          <Wallet className="w-6 h-6" />
        </div>
      </div>

      {/* Net PNL Card */}
      <div className={`glass-panel p-6 border-l-4 ${isNetPositive ? 'border-l-primary' : 'border-l-danger'} flex items-center justify-between`}>
        <div>
          <p className="text-textMuted text-sm font-medium mb-1">Net PNL</p>
          <div className="flex items-end gap-2">
            <h2 className={`text-3xl font-bold ${isNetPositive ? 'text-primary' : 'text-danger'}`}>
              {isNetPositive ? '+' : ''}{pnl.netPnl.toFixed(4)}
            </h2>
            <span className="text-textMuted text-sm font-semibold mb-1">SOL</span>
          </div>
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isNetPositive ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger'}`}>
          {isNetPositive ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
        </div>
      </div>

      {/* Total Trades Card */}
      <div className="glass-panel p-6 border-l-4 border-l-blue-500 flex items-center justify-between">
        <div>
          <p className="text-textMuted text-sm font-medium mb-1">Total Trades</p>
          <h2 className="text-3xl font-bold text-white">
            {pnl.totalTrades}
          </h2>
          <div className="text-xs text-textMuted mt-1">
            <span className="text-primary">{pnl.wins}W</span> — <span className="text-danger">{pnl.losses}L</span>
          </div>
        </div>
        <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400">
          <Crosshair className="w-6 h-6" />
        </div>
      </div>

      {/* Win Rate Card */}
      <div className="glass-panel p-6 border-l-4 border-l-purple-500 flex items-center justify-between">
        <div>
          <p className="text-textMuted text-sm font-medium mb-1">Win Rate</p>
          <div className="flex items-end gap-2">
            <h2 className="text-3xl font-bold text-purple-400">
              {pnl.winRate}
            </h2>
            <span className="text-purple-400 text-sm font-semibold mb-1">%</span>
          </div>
        </div>
        <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400">
          <Target className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}
