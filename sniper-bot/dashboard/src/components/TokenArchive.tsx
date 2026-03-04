import { useEffect, useState } from 'react';
import { api } from '../api';
import { ExternalLink, CheckCircle2, XCircle } from 'lucide-react';

export function TokenArchive() {
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await api.getHistory();
        setHistory(res);
      } catch (e) {
        console.error('Failed to fetch history', e);
      }
    };
    fetchHistory();
    const interval = setInterval(fetchHistory, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="glass-panel p-6" id="history">
      <h3 className="text-lg font-medium text-textMain mb-6">Trade Archive</h3>
      
      {history.length === 0 ? (
        <div className="text-center py-8 text-textMuted">No past trades available.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs uppercase text-textMuted border-b border-white/10">
                <th className="pb-3 font-medium">Token Mint</th>
                <th className="pb-3 font-medium">Result</th>
                <th className="pb-3 font-medium">Entry Date</th>
                <th className="pb-3 font-medium">Invested</th>
                <th className="pb-3 font-medium text-right">Links</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {history.map((p) => {
                const pMint = p.tokenData?.mint || '';
                const pHistory = p.history || [];
                const isWin = pHistory.some((h: any) => h.type === 'sell' && h.reason === 'TP');
                
                return (
                  <tr key={pMint} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-4 font-mono text-primary/80">{pMint.slice(0, 8)}...{pMint.slice(-6)}</td>
                    <td className="py-4">
                      {isWin ? (
                        <div className="flex items-center gap-1.5 text-primary">
                          <CheckCircle2 className="w-4 h-4" /> <span>WIN</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-danger">
                          <XCircle className="w-4 h-4" /> <span>LOSS</span>
                        </div>
                      )}
                    </td>
                    <td className="py-4 text-textMuted">{new Date(p.entryTime).toLocaleString()}</td>
                    <td className="py-4 font-medium">{p.solSpent?.toFixed(3) || '0.000'} SOL</td>
                    <td className="py-4 text-right">
                      <a href={`https://pump.fun/${p.mint}`} target="_blank" rel="noreferrer" className="inline-flex p-1.5 bg-white/5 rounded hover:bg-white/10 text-white transition-colors">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
