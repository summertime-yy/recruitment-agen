/* ============================================================
   AgentDashboard — Agent 可视化工作台
   顶部：Agent 拓扑关系图 + 摘要统计
   底部：追踪列表 + 详情面板 + LLM 设置切换
   ============================================================ */

import { useState, useEffect } from 'react';
import type { AgentTrace, AgentName } from '../../lib/agent-tracer';
import { getAgentTracer } from '../../lib/agent-tracer';
import { AgentGraph } from './AgentGraph';
import { TraceList } from './TraceList';
import { TraceDetail } from './TraceDetail';
import { LLMSettings } from './LLMSettings';

export interface AgentDashboardProps {
  onClose: () => void;
}

type DashboardTab = 'traces' | 'settings';

export function AgentDashboard({ onClose }: AgentDashboardProps) {
  const [selectedTrace, setSelectedTrace] = useState<AgentTrace | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);
  const [tab, setTab] = useState<DashboardTab>('traces');
  const [summary, setSummary] = useState({ totalCalls: 0, successCount: 0, errorCount: 0, avgDuration: 0 });
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    const tracer = getAgentTracer();
    const updateSummary = () => setSummary(tracer.getSummary());
    updateSummary();
    const unsub = tracer.subscribe(updateSummary);
    return unsub;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSelectAgent = (agent: AgentName) => {
    setSelectedAgent(agent === selectedAgent ? null : agent);
    setSelectedTrace(null);
  };

  const handleSelectTrace = (trace: AgentTrace) => {
    setSelectedTrace(trace);
    setSelectedAgent(null);
  };

  const successRate = summary.totalCalls > 0
    ? Math.round((summary.successCount / summary.totalCalls) * 100)
    : 100;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[95vw] max-w-[1200px] h-[90vh] mt-6 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden"
        style={{ animation: 'fadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔍</span>
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-200">Agent 可观测工作台</h2>
            </div>
            {/* 统计摘要 */}
            <div className="hidden sm:flex items-center gap-3 ml-4 pl-4 border-l border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 dark:text-slate-500">调用</span>
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{summary.totalCalls}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 dark:text-slate-500">成功</span>
                <span className="font-mono font-semibold text-emerald-500">{summary.successCount}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 dark:text-slate-500">失败</span>
                <span className="font-mono font-semibold text-red-500">{summary.errorCount}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 dark:text-slate-500">成功率</span>
                <span className={`font-mono font-semibold ${successRate >= 95 ? 'text-emerald-500' : successRate >= 80 ? 'text-amber-500' : 'text-red-500'}`}>
                  {successRate}%
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 dark:text-slate-500">平均</span>
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{summary.avgDuration}ms</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 标签切换 */}
            <div className="flex bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5">
              <button
                onClick={() => setTab('traces')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  tab === 'traces'
                    ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                调用追踪
              </button>
              <button
                onClick={() => setTab('settings')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  tab === 'settings'
                    ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                LLM 设置
              </button>
            </div>
            {/* 展开/收起按钮 */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              title={isExpanded ? '收起详情' : '展开详情'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.3s' }}
              >
                <polyline points="18 15 12 9 6 15"/>
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        {tab === 'traces' ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Agent 拓扑图 */}
            <div className={`border-b border-slate-200 dark:border-slate-700 bg-gradient-to-b from-slate-50 to-white dark:from-slate-800/50 dark:to-slate-900 p-4 transition-all duration-300 ${isExpanded ? 'h-[280px]' : 'h-[120px]'}`}>
              {isExpanded ? (
                <AgentGraph onSelectAgent={handleSelectAgent} selectedAgent={selectedAgent} />
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-slate-400">
                  点击 <span className="mx-1 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">展开</span> 查看拓扑图
                </div>
              )}
            </div>

            {/* 追踪列表 + 详情 */}
            <div className="flex-1 flex min-h-0">
              {/* 左侧：追踪列表 */}
              <div className="w-[380px] border-r border-slate-200 dark:border-slate-700 overflow-hidden">
                <TraceList
                  selectedTraceId={selectedTrace?.id}
                  onSelectTrace={handleSelectTrace}
                  filterAgent={selectedAgent}
                />
              </div>

              {/* 右侧：详情面板 */}
              <div className="flex-1 overflow-hidden">
                {selectedTrace ? (
                  <TraceDetail trace={selectedTrace} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 gap-3">
                    <div className="text-4xl">📡</div>
                    <p className="text-sm">选择一个追踪记录查看详情</p>
                    <p className="text-xs">点击左侧列表中的记录，或点击拓扑图中的 Agent 节点筛选</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* LLM 设置面板 */
          <div className="flex-1 overflow-y-auto">
            <LLMSettings />
          </div>
        )}
      </div>
    </div>
  );
}
