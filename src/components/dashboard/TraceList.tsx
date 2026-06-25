/* ============================================================
   TraceList — 追踪记录列表
   实时展示 Agent 调用记录，支持筛选和点击查看详情
   ============================================================ */

import { useState, useEffect, useMemo } from 'react';
import type { AgentTrace, AgentName, TraceStatus } from '../../lib/agent-tracer';
import { getAgentTracer } from '../../lib/agent-tracer';

const STATUS_BADGES: Record<TraceStatus, { label: string; className: string }> = {
  pending: { label: '等待', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
  running: { label: '运行中', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  success: { label: '成功', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  error: { label: '失败', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  timeout: { label: '超时', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
};

const AGENT_LABELS: Record<AgentName, string> = {
  'intent-router': '意图路由',
  'jd-generator': 'JD生成器',
  'resume-parser': '简历解析',
  'screening-scorer': '筛选评分',
  'progress-tracker': '进度追踪',
};

const AGENT_ICONS: Record<AgentName, string> = {
  'intent-router': '🧭',
  'jd-generator': '📋',
  'resume-parser': '📄',
  'screening-scorer': '🌟',
  'progress-tracker': '📊',
};

export interface TraceListProps {
  selectedTraceId?: string | null;
  onSelectTrace?: (trace: AgentTrace) => void;
  filterAgent?: AgentName | null;
}

export function TraceList({ selectedTraceId, onSelectTrace, filterAgent }: TraceListProps) {
  const [traces, setTraces] = useState<AgentTrace[]>([]);
  const [filter, setFilter] = useState<'all' | 'success' | 'error'>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 加载初始数据 + 订阅更新
  useEffect(() => {
    const tracer = getAgentTracer();
    setTraces(tracer.getTraces(filterAgent ? { agentName: filterAgent } : undefined));

    const unsub = tracer.subscribe(() => {
      if (autoRefresh) {
        setTraces(tracer.getTraces(filterAgent ? { agentName: filterAgent } : undefined));
      }
    });

    return unsub;
  }, [autoRefresh, filterAgent]);

  // 也监听 filterAgent 变化
  useEffect(() => {
    const tracer = getAgentTracer();
    setTraces(tracer.getTraces(filterAgent ? { agentName: filterAgent } : undefined));
  }, [filterAgent]);

  // 客户端过滤
  const filteredTraces = useMemo(() => {
    if (filter === 'all') return traces;
    return traces.filter(t => t.status === filter);
  }, [traces, filter]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '...' : s;

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
        <div className="flex gap-1">
          {(['all', 'success', 'error'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {f === 'all' ? '全部' : f === 'success' ? '成功' : '失败'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            className="w-3 h-3 rounded accent-emerald-500"
          />
          自动刷新
        </label>
        <button
          onClick={() => {
            getAgentTracer().clearTraces();
            setTraces([]);
          }}
          className="px-2 py-1 rounded text-xs text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          清空
        </button>
      </div>

      {/* 追踪列表 */}
      <div className="flex-1 overflow-y-auto">
        {filteredTraces.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 gap-2">
            <div className="text-3xl">📡</div>
            <p className="text-sm">暂无追踪记录</p>
            <p className="text-xs">Agent 调用将自动出现在这里</p>
          </div>
        )}

        {filteredTraces.map(trace => {
          const badge = STATUS_BADGES[trace.status];
          const isSelected = selectedTraceId === trace.id;
          const isRunning = trace.status === 'running';

          return (
            <div
              key={trace.id}
              onClick={() => onSelectTrace?.(trace)}
              className={`px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
              } ${trace.status === 'running' ? 'animate-pulse-subtle' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                {/* 运行中动画 */}
                {isRunning && (
                  <div className="flex gap-0.5 mr-1">
                    <div className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
                {!isRunning && (
                  <span className="text-sm">{AGENT_ICONS[trace.agentName]}</span>
                )}
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {AGENT_LABELS[trace.agentName]}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}>
                  {badge.label}
                </span>
                {trace.duration != null && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">
                    {trace.duration}ms
                  </span>
                )}
              </div>

              {/* 输入预览 */}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                {truncate(trace.input, 80)}
              </p>

              {/* 输出预览（仅成功时） */}
              {trace.status === 'success' && trace.output && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 leading-tight mt-0.5">
                  → {truncate(trace.output, 80)}
                </p>
              )}

              {/* 错误信息 */}
              {trace.status === 'error' && trace.error && (
                <p className="text-[11px] text-red-500 dark:text-red-400 leading-tight mt-0.5">
                  ⚠️ {truncate(trace.error, 80)}
                </p>
              )}

              {/* 时间 */}
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                  {formatTime(trace.startTime)}
                </span>
                {trace.tags.conversationId && trace.tags.conversationId !== 'unknown' && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1 rounded">
                    {truncate(trace.tags.conversationId, 12)}
                  </span>
                )}
                {trace.tags.state && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {trace.tags.state}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
