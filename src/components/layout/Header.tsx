/* ============================================================
   Header — 顶部导航栏：群聊标题 + 主题切换 + 侧边栏切换
   ============================================================ */

import { useRecruitmentStore } from '../../store/recruitmentStore';
import { ThemeToggle } from './ThemeToggle';

interface HeaderProps {
  onOpenDashboard?: () => void;
}

export function Header({ onOpenDashboard }: HeaderProps) {
  const toggleSidebar = useRecruitmentStore(s => s.toggleSidebar);
  const sidebarOpen = useRecruitmentStore(s => s.sidebarOpen);

  return (
    <header className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-sm font-bold shadow-sm shadow-emerald-200 dark:shadow-emerald-900/30">
          HR
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">HR招聘协作群</div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500">3人群 · 含招聘助手</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenDashboard}
          className="p-1.5 rounded-md text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
          title="Agent 可观测工作台"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
