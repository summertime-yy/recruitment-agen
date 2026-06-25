/* ============================================================
   App — 智能招聘 Agent Web 应用主入口
   集成：聊天界面 + Agent 可观测工作台 + LLM 配置
   ============================================================ */

import { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { ChatArea } from './components/chat/ChatArea';
import { ChatInput } from './components/chat/ChatInput';
import { AgentDashboard } from './components/dashboard/AgentDashboard';
import { useRecruitmentStore } from './store/recruitmentStore';

function App() {
  const theme = useRecruitmentStore(s => s.theme);
  const [showDashboard, setShowDashboard] = useState(false);

  // 监听系统主题变化
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const isDark = mq.matches;
      document.documentElement.classList.toggle('dark', isDark);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return (
    <div className="h-screen flex overflow-hidden bg-slate-100 dark:bg-slate-950">
      {/* 侧边栏 */}
      <Sidebar />

      {/* 主区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部导航 */}
        <Header onOpenDashboard={() => setShowDashboard(true)} />

        {/* 聊天区域 */}
        <div className="flex-1 flex flex-col bg-[#f5f5f5] dark:bg-slate-900 min-h-0">
          <ChatArea />
          <ChatInput />
        </div>
      </div>

      {/* Agent 可观测工作台（弹窗） */}
      {showDashboard && (
        <AgentDashboard onClose={() => setShowDashboard(false)} />
      )}
    </div>
  );
}

export default App;
