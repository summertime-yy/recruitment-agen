/* ============================================================
   Pipeline 类型定义 — P1 修复 (C-1)

   定义 Pipe-and-Filter 流水线的核心接口:
     - PipelineStep: 每个处理单元的标准接口
     - PipelineContext: 在 Step 间传递的统一数据载体
     - PipelineConfig: 声明式流程配置
   ============================================================ */

import type {
  ConversationState, IntentType, AgentResponse,
  JobPosition, ParsedResume,
} from '../types';

// ============================================================
// Step 错误处理策略
// ============================================================

export type StepErrorStrategy = 'halt' | 'skip' | 'retry' | 'fallback';

// ============================================================
// Step 执行结果
// ============================================================

export interface StepResult {
  /** Step 是否成功执行 */
  success: boolean;
  /** 错误信息（仅 success=false 时有值） */
  error?: string;
  /** Step 输出指标（耗时、token 用量等） */
  metrics?: Record<string, unknown>;
  /** 是否跳过后续 Step（提前终止流水线） */
  stopPipeline?: boolean;
}

// ============================================================
// PipelineContext — 统一数据载体
// ============================================================

export interface PipelineContext {
  // === 会话 ===
  conversationId: string;
  /** 当前会话状态 */
  state: ConversationState;
  /** 流水线起始时的快照（用于回滚） */
  initialState: ConversationState;

  // === 岗位 ===
  currentJobId: string | null;
  jobs: JobPosition[];

  // === 简历 ===
  parsedResumes: ParsedResume[];
  pendingResume: ParsedResume | null;

  // === 用户输入 ===
  userMessage: string;
  /** 原始用户消息（未清理 @提及） */
  rawMessage: string;

  // === 流水线内部 ===
  /** 当前处理的意图 */
  intent?: IntentType;
  /** Step 间传递的中间结果 */
  intermediates: Map<string, unknown>;
  /** 日志收集（每个 Step 可追加） */
  logs: Array<{ step: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string }>;
  /** Step 执行顺序记录 */
  executionPath: string[];

  // === 最终输出 ===
  /** 最终要返回给用户/Store 的响应 */
  response?: AgentResponse;
  /** 是否需要更新岗位 */
  jobUpdate?: JobPosition;
  /** 是否需要持久化简历 */
  resumeUpdate?: ParsedResume;
}

// ============================================================
// PipelineStep — Step 标准接口
// ============================================================

export interface PipelineStep {
  /** Step 唯一标识 */
  readonly name: string;

  /** Step 描述（用于日志和调试） */
  readonly description: string;

  /** 该 Step 依赖的前置 Step（名称列表），空数组表示无依赖 */
  readonly dependencies: string[];

  /** 是否启用（可通过配置关闭） */
  readonly enabled: boolean;

  /** 错误处理策略 */
  readonly onError: StepErrorStrategy;

  /** 最大重试次数（仅 onError='retry' 时有效） */
  readonly maxRetries: number;

  /**
   * 执行 Step 的核心逻辑
   *
   * @param ctx - 流水线上下文
   * @returns 执行结果（success/error + 指标）。Step 可以修改 ctx（可变传递）
   */
  execute(ctx: PipelineContext): Promise<StepResult>;
}

// ============================================================
// PipelineConfig — 声明式配置
// ============================================================

export interface PipelineConfig {
  /** 流水线名称 */
  name: string;
  /** 流水线版本 */
  version: string;
  /** 要执行的 Step 列表（按依赖拓扑排序） */
  steps: PipelineStep[];
  /** 全局超时（毫秒），0 表示无限制 */
  timeout: number;
  /** 是否启用并行执行（无依赖的 Step 并发执行） */
  parallel: boolean;
}

// ============================================================
// 工具函数
// ============================================================

/** 创建空的 PipelineContext */
export function createPipelineContext(
  userMessage: string,
  state: ConversationState,
  overrides?: Partial<Pick<PipelineContext, 'currentJobId' | 'jobs' | 'parsedResumes' | 'pendingResume'>>,
): PipelineContext {
  return {
    conversationId: `conv_${Date.now()}`,
    state,
    initialState: state,
    currentJobId: overrides?.currentJobId ?? null,
    jobs: overrides?.jobs ?? [],
    parsedResumes: overrides?.parsedResumes ?? [],
    pendingResume: overrides?.pendingResume ?? null,
    userMessage,
    rawMessage: userMessage,
    intermediates: new Map(),
    logs: [],
    executionPath: [],
  };
}
