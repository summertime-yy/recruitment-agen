/* ============================================================
   TraceDetail — 追踪详情面板
   展示选中追踪记录的完整输入输出和元数据
   ============================================================ */

import type { AgentTrace, AgentName } from '../../lib/agent-tracer';

const AGENT_LABELS: Record<AgentName, string> = {
  'intent-router': '意图路由',
  'jd-generator': 'JD生成器',
  'resume-parser': '简历解析',
  'screening-scorer': '筛选评分',
  'progress-tracker': '进度追踪',
};

export interface TraceDetailProps {
  trace: AgentTrace;
}

export function TraceDetail({ trace }: TraceDetailProps) {
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions);
  };

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            trace.status === 'success' ? 'bg-emerald-500' :
            trace.status === 'error' ? 'bg-red-500' :
            trace.status === 'running' ? 'bg-emerald-500 animate-pulse' :
            'bg-slate-400'
          }`} />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {AGENT_LABELS[trace.agentName]}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
            trace.status === 'success' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
            trace.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          }`}>
            {trace.status === 'success' ? '成功' : trace.status === 'error' ? '失败' : '运行中'}
          </span>
        </div>
      </div>

      {/* 元数据 */}
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-slate-400 dark:text-slate-500">开始时间</span>
            <p className="text-slate-700 dark:text-slate-300 font-mono">{formatTime(trace.startTime)}</p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500">耗时</span>
            <p className="text-slate-700 dark:text-slate-300 font-mono">
              {trace.duration != null ? `${trace.duration}ms` : '-'}
            </p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500">Trace ID</span>
            <p className="text-slate-700 dark:text-slate-300 font-mono text-[10px]">{trace.id}</p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500">状态</span>
            <p className="text-slate-700 dark:text-slate-300">
              {trace.tags.state || '-'}
            </p>
          </div>
        </div>
        {/* Tags */}
        {Object.keys(trace.tags).length > 0 && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {Object.entries(trace.tags).map(([k, v]) => (
              <span key={k} className="px-1.5 py-0.5 rounded text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
                {k}: {v}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 输入 */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-2">输入 (Input)</h4>
        <pre className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-lg p-3 max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
          {trace.inputDetail || trace.input || '(无输入)'}
        </pre>
      </div>

      {/* 输出 */}
      <div className="flex-1 px-4 py-3 overflow-y-auto">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-2">输出 (Output)</h4>

        {trace.status === 'error' && (
          <div className="mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <p className="text-xs text-red-700 dark:text-red-400 font-medium mb-1">错误信息</p>
            <pre className="text-xs text-red-600 dark:text-red-300 whitespace-pre-wrap">{trace.error}</pre>
          </div>
        )}

        <pre className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-lg p-3 whitespace-pre-wrap break-all font-mono leading-relaxed"
          style={{ maxHeight: 'calc(100% - 20px)' }}>
          {trace.outputDetail || trace.output || (trace.status === 'running' ? '⏳ 等待中...' : '(无输出)')}
        </pre>
      </div>
    </div>
  );
}
