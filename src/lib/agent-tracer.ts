/* ============================================================
   Agent Tracer — 可观测追踪系统
   记录每次 Agent 调用的输入/输出/耗时/状态
   提供事件订阅机制供 Dashboard 消费
   ============================================================ */

// === 追踪记录类型 ===
export type AgentName =
  | 'intent-router'
  | 'jd-generator'
  | 'resume-parser'
  | 'screening-scorer'
  | 'progress-tracker';

export type TraceStatus = 'pending' | 'running' | 'success' | 'error' | 'timeout';

export interface AgentTrace {
  id: string;
  agentName: AgentName;
  status: TraceStatus;
  startTime: number;
  endTime?: number;
  duration?: number;          // ms
  input: string;              // summary/preview of input
  inputDetail?: string;       // full input for inspection
  output?: string;            // summary/preview of output
  outputDetail?: string;      // full output for inspection
  error?: string;
  tags: Record<string, string>;  // conversationId, intent, state, etc.
  metadata?: Record<string, unknown>;
}

export interface TraceSummary {
  totalCalls: number;
  successCount: number;
  errorCount: number;
  avgDuration: number;
  recentTraces: AgentTrace[];
}

// === 事件类型 ===
export type TracerEventType = 'trace-start' | 'trace-complete' | 'trace-error' | 'traces-cleared';

export interface TracerEvent {
  type: TracerEventType;
  trace?: AgentTrace;
  timestamp: number;
}

type TracerSubscriber = (event: TracerEvent) => void;

// ============================================================
// Tracer 类
// ============================================================
export class AgentTracer {
  private traces: AgentTrace[] = [];
  private subscribers: Set<TracerSubscriber> = new Set();
  private maxTraces: number;
  private enabled: boolean = true;
  private activeTraces: Map<string, AgentTrace> = new Map();

  constructor(maxTraces: number = 200) {
    this.maxTraces = maxTraces;
  }

  /** 开启/关闭追踪 */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  /** 订阅事件 */
  subscribe(fn: TracerSubscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** 发起事件 */
  private emit(event: TracerEvent) {
    for (const fn of this.subscribers) {
      try { fn(event); } catch { /* ignore subscriber errors */ }
    }
  }

  /** 开始追踪 */
  startTrace(
    agentName: AgentName,
    input: string,
    tags: Record<string, string> = {},
    inputDetail?: string,
  ): string {
    if (!this.enabled) return '';

    const id = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const trace: AgentTrace = {
      id,
      agentName,
      status: 'running',
      startTime: Date.now(),
      input,
      inputDetail,
      tags,
    };

    this.activeTraces.set(id, trace);
    this.traces.unshift(trace);
    this.trimTraces();

    this.emit({ type: 'trace-start', trace, timestamp: Date.now() });
    return id;
  }

  /** 完成追踪 */
  completeTrace(id: string, output: string, outputDetail?: string, metadata?: Record<string, unknown>) {
    if (!this.enabled || !id) return;

    const trace = this.activeTraces.get(id);
    if (!trace) return;

    trace.status = 'success';
    trace.endTime = Date.now();
    trace.duration = trace.endTime - trace.startTime;
    trace.output = output;
    trace.outputDetail = outputDetail;
    if (metadata) trace.metadata = metadata;

    this.activeTraces.delete(id);
    this.emit({ type: 'trace-complete', trace: { ...trace }, timestamp: Date.now() });
  }

  /** 追踪错误 */
  errorTrace(id: string, error: string) {
    if (!this.enabled || !id) return;

    const trace = this.activeTraces.get(id);
    if (!trace) return;

    trace.status = 'error';
    trace.endTime = Date.now();
    trace.duration = trace.endTime - trace.startTime;
    trace.error = error;

    this.activeTraces.delete(id);
    this.emit({ type: 'trace-error', trace: { ...trace }, timestamp: Date.now() });
  }

  /** 获取所有追踪记录 */
  getTraces(filter?: {
    agentName?: AgentName;
    status?: TraceStatus;
    limit?: number;
  }): AgentTrace[] {
    let result = [...this.traces];
    if (filter?.agentName) {
      result = result.filter(t => t.agentName === filter.agentName);
    }
    if (filter?.status) {
      result = result.filter(t => t.status === filter.status);
    }
    return result.slice(0, filter?.limit ?? 50);
  }

  /** 获取追踪摘要 */
  getSummary(): TraceSummary {
    const completed = this.traces.filter(t => t.status !== 'running' && t.status !== 'pending');
    const successCount = this.traces.filter(t => t.status === 'success').length;
    const errorCount = this.traces.filter(t => t.status === 'error' || t.status === 'timeout').length;
    const durations = completed.map(t => t.duration ?? 0).filter(d => d > 0);
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    return {
      totalCalls: this.traces.length,
      successCount,
      errorCount,
      avgDuration,
      recentTraces: this.traces.slice(0, 20),
    };
  }

  /** 清除追踪 */
  clearTraces() {
    this.traces = [];
    this.activeTraces.clear();
    this.emit({ type: 'traces-cleared', timestamp: Date.now() });
  }

  /** 获取活跃（正在运行）的追踪 */
  getActiveTraces(): AgentTrace[] {
    return Array.from(this.activeTraces.values());
  }

  /** 按标签过滤 */
  getTracesByTag(key: string, value: string): AgentTrace[] {
    return this.traces.filter(t => t.tags[key] === value);
  }

  private trimTraces() {
    if (this.traces.length > this.maxTraces) {
      this.traces = this.traces.slice(0, this.maxTraces);
    }
  }
}

// ============================================================
// 全局单例
// ============================================================
let tracerInstance: AgentTracer | null = null;

export function getAgentTracer(): AgentTracer {
  if (!tracerInstance) {
    tracerInstance = new AgentTracer(200);
  }
  return tracerInstance;
}

export function resetAgentTracer(): void {
  tracerInstance = null;
}
