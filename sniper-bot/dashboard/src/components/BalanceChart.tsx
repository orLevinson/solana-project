import { useEffect, useState } from 'react';
import { api } from '../api';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export function BalanceChart() {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    const fetchChart = async () => {
      try {
        const res = await api.getChartBalance();
        // Format time for tooltip
        const formatted = res.map((d: any) => ({
          ...d,
          timeLabel: new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }));
        setData(formatted);
      } catch (e) {
        console.error('Failed to fetch chart data', e);
      }
    };
    fetchChart();
    const interval = setInterval(fetchChart, 10000); // 10s updates
    return () => clearInterval(interval);
  }, []);

  if (data.length === 0) {
    return (
      <div className="glass-panel p-6 h-80 flex items-center justify-center">
        <div className="animate-pulse text-textMuted">Loading Chart...</div>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-panel/90 border border-white/10 p-4 rounded-lg shadow-xl backdrop-blur-md">
          <p className="text-textMuted text-xs mb-1">{payload[0].payload.timeLabel}</p>
          <p className="text-primary font-bold">{Number(payload[0].value).toFixed(4)} SOL</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="glass-panel p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium text-textMain">Balance History</h3>
        <div className="flex gap-2">
          {/* Timeline tabs could go here */}
        </div>
      </div>
      
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#4ade80" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0a" vertical={false} />
            <XAxis 
              dataKey="timeLabel" 
              tick={{fill: '#94a3b8', fontSize: 12}} 
              axisLine={false}
              tickLine={false}
              minTickGap={30}
            />
            <YAxis 
              domain={['auto', 'auto']} 
              tick={{fill: '#94a3b8', fontSize: 12}} 
              axisLine={false}
              tickLine={false}
              tickFormatter={(val) => val.toFixed(2)}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area 
              type="monotone" 
              dataKey="balance" 
              stroke="#4ade80" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorBalance)" 
              isAnimationActive={true}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
