/* ============================================================
   ThemeToggle — 深色/浅色/系统 三模式主题切换
   ============================================================ */

import { useRecruitmentStore } from '../../store/recruitmentStore';
import type { ThemeMode } from '../../types';

export function ThemeToggle() {
  const theme = useRecruitmentStore(s => s.theme);
  const setTheme = useRecruitmentStore(s => s.setTheme);

  const cycle = () => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const idx = order.indexOf(theme);
    setTheme(order[(idx + 1) % order.length]);
  };

  const icons: Record<ThemeMode, { emoji: string; label: string }> = {
    light: { emoji: '☀️', label: '浅色' },
    dark: { emoji: '🌙', label: '深色' },
    system: { emoji: '💻', label: '系统' },
  };

  return (
    <button
      onClick={cycle}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200"
      title={`当前: ${icons[theme].label} · 点击切换`}
    >
      <span className="text-base">{icons[theme].emoji}</span>
      <span className="hidden sm:inline">{icons[theme].label}</span>
    </button>
  );
}
