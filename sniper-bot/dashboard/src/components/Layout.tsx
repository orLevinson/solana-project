import { Activity, LayoutDashboard, History, Settings } from 'lucide-react';
import type { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 bg-panel/50 backdrop-blur-md flex flex-col">
        <div className="p-6 border-b border-white/5">
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Sniper Dashboard
          </h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <a href="#" className="flex items-center gap-3 px-4 py-3 bg-white/5 text-primary rounded-lg transition-colors">
            <LayoutDashboard className="w-5 h-5" />
            <span className="font-medium">Overview</span>
          </a>
          <a href="#active" className="flex items-center gap-3 px-4 py-3 text-textMuted hover:text-textMain hover:bg-white/5 rounded-lg transition-colors">
            <Activity className="w-5 h-5" />
            <span className="font-medium">Active Trades</span>
          </a>
          <a href="#history" className="flex items-center gap-3 px-4 py-3 text-textMuted hover:text-textMain hover:bg-white/5 rounded-lg transition-colors">
            <History className="w-5 h-5" />
            <span className="font-medium">Archive</span>
          </a>
        </nav>
        
        <div className="p-4 border-t border-white/5 text-sm text-textMuted flex items-center gap-2 cursor-pointer hover:text-textMain transition-colors">
          <Settings className="w-4 h-4" />
          Settings
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-16 border-b border-white/5 bg-panel/30 backdrop-blur-sm flex items-center px-8 justify-between">
          <h2 className="text-lg font-medium">Dashboard Overview</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              API Connected
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto space-y-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
