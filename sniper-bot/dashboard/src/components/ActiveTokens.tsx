import { useEffect, useState, useRef } from 'react';
import { api } from '../api';
import { ExternalLink, Tag } from 'lucide-react';

function PumpEmbed({ mint }: { mint: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';
    const script = document.createElement('script');
    script.src = "https://www.pumpembed.com/embed.js";
    script.async = true;
    script.setAttribute("data-mint-id", mint);
    script.setAttribute("data-width", "100%");
    script.setAttribute("data-height", "315");
    script.setAttribute("data-border", "1");
    script.setAttribute("data-pump", "1");
    script.setAttribute("data-controls", "1");
    
    containerRef.current.appendChild(script);
  }, [mint]);

  return <div ref={containerRef} className="w-full rounded-xl overflow-hidden bg-black/50 min-h-[315px]" />;
}

export function ActiveTokens() {
  const [positions, setPositions] = useState<any[]>([]);

  useEffect(() => {
    const fetchPositions = async () => {
      try {
        const res = await api.getActivePositions();
        setPositions(res);
      } catch (e) {
        console.error('Failed to fetch active positions', e);
      }
    };
    fetchPositions();
    const interval = setInterval(fetchPositions, 5000);
    return () => clearInterval(interval);
  }, []);

  if (positions.length === 0) {
    return (
      <div className="glass-panel p-8 text-center text-textMuted" id="active">
        <Tag className="w-12 h-12 mx-auto mb-3 opacity-20" />
        <p>No active positions at the moment.</p>
        <p className="text-xs mt-1">Waiting for sniper signals...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" id="active">
      <h3 className="text-xl font-medium text-textMain flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse"></span>
        Active Targets
      </h3>
      
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {positions.map((p) => (
          <div key={p.mint} className="glass-panel overflow-hidden border border-primary/20 hover:border-primary/40 transition-colors">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
              <div className="flex items-center gap-3">
                <div className="font-mono text-sm text-primary bg-primary/10 px-2 py-1 rounded">
                  {p.mint.slice(0, 6)}...{p.mint.slice(-4)}
                </div>
                {p.partialSold && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">Partial TP</span>}
              </div>
              <a href={`https://pump.fun/${p.mint}`} target="_blank" rel="noreferrer" className="text-textMuted hover:text-white transition-colors">
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
            
            <div className="p-4 grid grid-cols-3 gap-4 border-b border-white/5">
                <div>
                    <p className="text-xs text-textMuted mb-1">Entry Price</p>
                    <p className="font-medium text-white">{p.entryPrice?.toFixed(8) || 'N/A'}</p>
                </div>
                <div>
                    <p className="text-xs text-textMuted mb-1">Remaining</p>
                    <p className="font-medium text-white">{p.remainingTokens?.toFixed(2) || 'N/A'}</p>
                </div>
                <div>
                    <p className="text-xs text-textMuted mb-1">Time Open</p>
                    <p className="font-medium text-white">{Math.floor((Date.now() - p.entryTime) / 60000)}m</p>
                </div>
            </div>

            <div className="p-2">
              <PumpEmbed mint={p.mint} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
