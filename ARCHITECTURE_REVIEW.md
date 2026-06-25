# recuitment-agent 多智能体架构深度审查报告

> **审查时间**: 2026-06-24
> **审查角色**: 多智能体协同审查官
> **审查范围**: 全量核心文件（agent-engine.ts, resume-parser-agent.ts, agent-tools.ts, 5 个 Agent prompt 文件, types/index.ts, recruitmentStore.ts, llm-client.ts）

---

## 1. 当前架构诊断

### 1.1 架构全景图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React)                            │
│   ChatInput → 用户消息 / 文件上传                                     │
│       │                                                              │
│       ▼                                                              │
│  Zustand Store (recruitmentStore.ts)                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ messages[]  │  jobs[]  │  parsedResumes[]  │  state  │     │    │
│  │ addMessage()│ addJob() │ addResume()       │ setState()   │    │
│  │ setScreeningResult()  │ getContext()       │             │    │
│  └──────────────┬──────────────────────────────────────────────┘    │
│                 │ 调用 engine.setContext(store.getContext(), state)  │
└─────────────────┼──────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│        RecruitmentAgentEngine (agent-engine.ts) — 单一编排类          │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  processMessage(userMessage)  ← 唯一入口                       │   │
│  │    │                                                          │   │
│  │    ├─► recognizeIntent(message)                               │   │
│  │    │     ├─ ruleBasedIntent() — 正则匹配（先行）               │   │
│  │    │     └─ LLM intent-router prompt（降级路径）               │   │
│  │    │                                                          │   │
│  │    └─► switch(intent) {  ← 硬编码路由                          │   │
│  │          case GENERATE_JD:  → handleGenerateJD()              │   │
│  │          case MODIFY_JD:    → handleModifyJD()                │   │
│  │          case CONFIRM_JD:   → handleConfirmJD()               │   │
│  │          case SUBMIT_RESUME:→ handleSubmitResume()            │   │
│  │          case SCREEN_RESUMES:→ handleScreenResumes()           │   │
│  │          case QUERY_PROGRESS:→ handleQueryProgress()           │   │
│  │          case VIEW_DETAIL:  → handleViewDetail()              │   │
│  │          default:           → handleFallback()                │   │
│  │        }                                                      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  共享上下文:                                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ ConversationContext {                                         │   │
│  │   currentJobId: string | null                                 │   │
│  │   jobs: JobPosition[]         ← 所有 Agent 共享读取            │   │
│  │   parsedResumes: ParsedResume[] ← 所有 Agent 共享读取          │   │
│  │ }                                                             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  每个 handler 独立 LLM 调用，独立返回 AgentResponse                   │
└──────────────────────────────────────────────────────────────────────┘
                  │
                  │ (唯一的并行例外)
                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ResumeParserAgent (resume-parser-agent.ts) — 唯一有内部 Tool 管道的  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  run()                                                       │   │
│  │    ├─ [DocumentParser Tool] 文件 → 纯文本                    │   │
│  │    ├─ [LLMResumeParser Tool] LLM 提取（如可用）              │   │
│  │    ├─ [VisionStructuredParser Tool] 扫描版专用               │   │
│  │    └─ [LocalRuleParser Tool] 本地规则提取/融合               │   │
│  │                                                              │   │
│  │  每个 Tool 调用被 AgentTracer 独立记录                        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 调度模式总结

当前架构采用的是一种 **"中央引擎 + 硬编码路由"** 的单体编排模式:

| 维度 | 当前实现 | 问题 |
|------|---------|------|
| 调度中心 | `RecruitmentAgentEngine` 使用 `switch(intent)` 路由 | 无声明式工作流定义 |
| Agent 身份 | 5 个 prompt 文件 + engine 上的 private 方法 | Agent 无独立生命周期 |
| Agent 通信 | 通过 `ConversationContext` 共享读取 → 各自写 Zustand Store | 无直接消息传递 |
| 结果聚合 | 每个 handler 返回独立 `AgentResponse` → 前端渲染 | 无后端聚合节点 |
| 依赖建模 | `ConversationState` 状态机 + if-else 守卫检查 | 隐式依赖，不可视化 |
| 错误处理 | 每个 handler 独立 try/catch → 降级到 mock | 无事务性，无回滚 |

---

## 2. "各自为政" 根因分析

按严重程度从高到低排列：

### 根因 1: Agent 缺乏独立运行时容器（严重度: 🔴 致命）

**代码位置**: `agent-engine.ts:57-1109` (整个类), `src/agents/*.ts` (5 个 prompt 文件)

**问题描述**:
```typescript
// agent-engine.ts — 所有 Agent 处理逻辑都在一个类里
export class RecruitmentAgentEngine {
  private async handleGenerateJD(userMessage: string): Promise<AgentResponse> { ... }
  private async handleModifyJD(userMessage: string): Promise<AgentResponse> { ... }
  private async handleConfirmJD(): Promise<AgentResponse> { ... }
  private async handleSubmitResume(userMessage: string): Promise<AgentResponse> { ... }
  private async handleScreenResumes(): Promise<AgentResponse> { ... }
  private async handleQueryProgress(): Promise<AgentResponse> { ... }
  private async handleViewDetail(userMessage: string): Promise<AgentResponse> { ... }
}
```

所谓的 5 个 "Agent" 实际只是 `src/agents/` 目录下的 prompt 模板文件（纯字符串导出），并由 `RecruitmentAgentEngine` 的私有方法直接调用。这些 Agent 没有：
- 独立的 `Agent` 接口/抽象类
- 独立的生命周期（init → plan → act → observe）
- 独立的状态管理
- 独立的消息队列或输入/输出通道

**唯一的例外是 `ResumeParserAgent`**（`resume-parser-agent.ts:82-397`），它有独立的类、`run()` 方法、内部 Tool 管道和短路器。这恰恰证明了其他 Agent 也可以被抽象为独立运行时——只是架构设计时没有贯彻。

### 根因 2: 无 Agent 间直接消息传递机制（严重度: 🔴 致命）

**代码位置**:
- `types/index.ts:143-157` — `AgentRequest` 仅含 `message`, `state`, `context`
- `agent-engine.ts:115-153` — `processMessage()` 只做意图路由，无消息转发
- `recruitmentStore.ts:88-191` — Store 是唯一的数据沉淀点

**问题描述**:

当前所有 Agent 间的数据流是单向循环：
```
用户消息 → Engine → Agent Handler → AgentResponse →
  └→ 前端更新 Zustand Store → 前端调用 engine.setContext() → 下一轮循环
```

Agent 之间没有直接的通信:
- JD-Generator 生成 JD 后，无法主动通知 Screening-Scorer "JD 已就绪"
- Screening-Scorer 无法向 JD-Generator 查询特定字段的含义
- Progress-Tracker 无法汇总其他 Agent 的中间状态

Agent 只能通过两个间接通道感知彼此的存在：
1. **`ConversationContext`** (agent-engine.ts:69): 读取前序 Agent 的结果
2. **`ConversationState`** (types/index.ts:7-13): 6 状态的状态机，只能表达宏观阶段

```typescript
// agent-engine.ts:619-704 — 筛选 Agent 读取 JD 的方式：从共享 context 中查找
const currentJob = this.context.jobs.find(j => j.id === this.context.currentJobId);
const jobTitle = currentJob?.title || '当前岗位';
const requirements = currentJob?.hardRequirements || [];
```

这相当于所有 Agent 共享一个全局变量，极低的通信效率。

### 根因 3: 依赖关系隐式硬编码，无可视化/可声明依赖图（严重度: 🟠 严重）

**代码位置**:
- `agent-engine.ts:127-150` — `switch(intent)` 路由表: 硬编码的业务流程
- `agent-engine.ts:263-279` — `ruleBasedIntent()`: 正则 + state 状态机组合判断
- `agent-engine.ts:620-622` — `handleScreenResumes()`: "够3份才能筛选"硬编码
- `agent-engine.ts:710-712` — `handleQueryProgress()`: "无岗位不能查进度"硬编码

**问题描述**:

业务中的明确依赖关系在代码中以散落的 if-else 表达：

```typescript
// agent-engine.ts:620-622 — 筛选依赖简历数 ≥ 3
if (resumes.length < 3) {
  return { type: 'bot_text', content: INSUFFICIENT_RESUMES_RESPONSE(resumes.length), ... };
}

// agent-engine.ts:710-712 — 进度查询依赖当前岗位
if (!currentJob) {
  return { type: 'bot_text', content: NO_ACTIVE_JOB_RESPONSE, newState: this.state };
}

// agent-engine.ts:425-427 — JD 修改依赖 JD 存在
if (!currentJob) {
  return { type: 'bot_text', content: '⚠️ 未找到当前岗位，请先生成JD。' };
}
```

真实的业务流程依赖关系应该是：

```
                    ┌─────────────┐
                    │ GENERATE_JD │ (必需，P0)
                    └──────┬──────┘
                           │ CONFIRM_JD
                    ┌──────▼──────┐
                    │ COLLECTING  │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐
     │SUBMIT_RESUME│ │(可继续)  │ │QUERY_PROGRESS│ (P1, 随时可查)
     └──────┬──────┘ │          │ └─────────────┘
            │        │          │
     ┌──────▼──────┐ │          │
     │(≥3 份简历)  │ │          │
     └──────┬──────┘ │          │
            │        │          │
     ┌──────▼──────┐ │          │
     │SCREEN_RESUMES│          │
     └──────┬──────┘           │
            │                  │
     ┌──────▼──────┐           │
     │VIEW_DETAIL  │           │
     └─────────────┘           │
```

但这些关系在当前代码中完全依赖于 `ConversationState` 的 6 个值 + `ruleBasedIntent()` 的正则匹配。如果加一个新 Agent（如"安排面试"），需要修改 `IntentType`、`ConversationState`、`ruleBasedIntent()`、`switch(intent)` 四个地方，且没有任何编译时保证依赖关系正确。

### 根因 4: 双轨状态系统导致数据不一致风险（严重度: 🟠 严重）

**代码位置**:
- `agent-engine.ts:69` — `private context: ConversationContext` (Engine 内部状态)
- `recruitmentStore.ts:88-191` — Zustand Store (前端全局状态)

**问题描述**:

存在两套状态系统，通过 `setContext()` 手动同步，但同步时机不可控：

```typescript
// agent-engine.ts:107-110
setContext(context: ConversationContext, state: ConversationState) {
  this.context = context;
  this.state = state;
}

// recruitmentStore.ts:168-176
getContext: () => {
  const state = get();
  return {
    currentJobId: state.currentJobId,
    jobs: state.jobs,
    parsedResumes: state.parsedResumes,
    pendingResume: state.pendingResume || undefined,
  };
},
```

**典型的不一致场景**：
1. Agent A 返回 `AgentResponse`（含 `jobUpdate`）
2. 前端收到 → 调用 `store.addJob()` → 更新 Zustand
3. 前端调用 `engine.setContext(store.getContext())` — **异步窗口期**
4. Agent B 在此期间读取的是过时的 engine context

如果 3 和 4 的时序错位，Agent B 就看不到 Agent A 的结果。

### 根因 5: 无统一结果聚合节点（严重度: 🟡 中等）

**代码位置**:
- `agent-engine.ts:115-153` — `processMessage()` 每个分支直接返回 `AgentResponse`
- 各 handler 方法 — 各自组装 cardData，无统一聚合

**问题描述**:

每个 Agent 的返回值 (`AgentResponse`) 是 UI 导向的：
```typescript
// types/index.ts:158-167
export interface AgentResponse {
  type: MessageType;       // 'bot_text' | 'bot_card'
  content: string;          // Markdown 给用户看
  cardType?: CardType;      // 前端渲染哪个卡片组件
  cardData?: unknown;       // 卡片数据
  quickActions?: QuickAction[];  // 快捷操作按钮
  newState?: ConversationState;  // 驱动状态机
  jobUpdate?: Partial<JobPosition>;   // 副作用: 更新岗位
  resumeUpdate?: Partial<ParsedResume>; // 副作用: 更新简历
}
```

`AgentResponse` 同时承载了 3 种职责：
1. **展示层输出** (content, cardType, cardData, quickActions)
2. **状态机转换** (newState)
3. **数据副作用** (jobUpdate, resumeUpdate)

如果一个场景需要聚合多个 Agent 的结果（如"生成招聘摘要"需要 JD + 筛选结果 + 进度），engine 没有聚合能力——前端需要分别渲染 3 个卡片。

### 根因 6: 无事务性保证与回滚机制（严重度: 🟡 中等）

**代码位置**:
- `agent-engine.ts` — 各 handler 的 try/catch 均独立降级
- 无全局事务管理器

**问题描述**:

```typescript
// 示例场景：用户说"筛选简历"
// Step 1: handleScreenResumes() 成功 → 返回 screeningResult
//    → 前端调用 store.setScreeningResult() ✅
// Step 2: 查询进度失败 → 前端处理
//    → 但 screeningResult 已经写入 Zustand，无法回滚 ❌
```

当前唯一的事务性机制是每个 handler 内部的 mock 降级：
```typescript
// agent-engine.ts:341-352 — LLM 失败 → 降级到 mock 生成
} catch (err) {
  // ...
}
// 降级到本地模拟模式
return this.mockGenerateJD(content);
```

但这只是**局部降级**，不是真正的跨 Agent 事务。如果 JD 已确认 + 3 份简历已解析，但筛选评分失败，JD 和简历的状态无法回滚。

---

## 3. 协同方案对比

### 方案 A: Pipe-and-Filter 流水线架构（参考传统 DAG 编排）

**适用场景**: 招聘流程固定、Agent 职责边界清晰、强顺序依赖

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│Prompt    │     │JD        │     │Resume    │     │Screening │     │Progress  │
│Router    │────►│Generator │────►│Parser    │────►│Scorer    │────►│Tracker   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                │                │                │                │
     │                │                │                │                │
┌────▼────────────────▼────────────────▼────────────────▼────────────────▼────┐
│                          Unified Pipeline Context                            │
│  { job, resumes[], scores[], state, errors[], auditLog[] }                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

**核心设计**:
1. 定义 `PipelineContext` 作为各 Agent 之间传递的统一数据载体
2. 每个 Agent 实现标准接口 `{ name, dependsOn[], execute(ctx, prevOutput) => PipelineContext }`
3. Pipeline 定义在 YAML/JSON 配置文件中，Engine 按配置顺序执行
4. 单步失败时，Pipeline 停止并将 error 记录在 context 中的 errors[]
5. 结果聚合由 Pipeline 最后一环统一处理

```typescript
// 伪代码示例
interface PipelineStep {
  name: string;
  dependsOn: string[];
  execute: (ctx: PipelineContext) => Promise<PipelineStepResult>;
  onError?: 'skip' | 'halt' | 'retry';
  retryCount?: number;
}

const recruitmentPipeline: PipelineStep[] = [
  { name: 'jd-generator', dependsOn: [], execute: jdGenStep, onError: 'halt' },
  { name: 'resume-collector', dependsOn: ['jd-generator'], execute: resumeCollectStep, onError: 'skip' },
  { name: 'screening-scorer', dependsOn: ['resume-collector', 'jd-generator'], execute: screeningStep, onError: 'halt' },
  { name: 'result-aggregator', dependsOn: ['screening-scorer'], execute: aggregateStep, onError: 'halt' },
];
```

| 维度 | 评估 |
|------|------|
| **实现复杂度** | ⭐⭐ 低 — 当前 engine 结构改动最小，主要是抽 Pipeline 层 |
| **协同收益** | ⭐⭐⭐ 中高 — 解决了依赖可视化和顺序保证问题 |
| **适用范围** | 流程相对固定的招聘场景 |
| **局限性** | 不支持 Agent 间动态交互（无法"回退到上一步改参数"）、无法并行执行独立 Agent |
| **与现状差异** | 小 — 本质上是对现有 `switch(intent)` 的声明式重构 |

---

### 方案 B: Graph-State 编排架构（参考 LangGraph）

**适用场景**: 复杂的多分支决策、需要条件路由、需支持回退/重试

```
                         ┌──────────────┐
                         │    START     │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │ 意图路由节点  │ (条件边)
                         └──────┬───────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
     ┌────────▼───────┐ ┌──────▼──────┐ ┌───────▼────────┐
     │  JD生成节点     │ │ 简历提交节点 │ │  进度查询节点    │
     └────────┬───────┘ └──────┬──────┘ └────────────────┘
              │                │
     ┌────────▼───────┐ ┌──────▼──────┐
     │  JD确认节点     │ │ 简历解析节点 │
     │  (条件边:       │ └──────┬──────┘
     │  确认→继续      │        │
     │  修改→回JD生成) │ ┌──────▼──────┐
     └────────┬───────┘ │ 数量检查节点 │ (条件边)
              │         └──────┬──────┘
              │                │
              │         ┌──────▼──────┐
              └────────►│ 筛选评分节点 │
                        └──────┬──────┘
                               │
                        ┌──────▼──────┐
                        │ 结果聚合节点 │
                        └──────┬──────┘
                               │
                        ┌──────▼──────┐
                        │    END      │
                        └─────────────┘

    ┌─────────────────────────────────────────────────┐
    │             Shared Graph State                   │
    │  { intent, job, resumes[], scores[],             │
    │    currentStep, history[], errors[] }            │
    └─────────────────────────────────────────────────┘
```

**核心设计**:
1. 将流程图建模为有向图（Node = Agent, Edge = 条件/数据通道）
2. 每个 Node 从 SharedGraphState 读入，处理后写回
3. Engine 遍历图：从 START 开始，按条件和状态路由
4. 路由决策也建模为 Node（意图路由、数量检查、确认/修改判断）
5. 支持条件边回退（修改JD → 回到JD生成节点）

```typescript
// 伪代码示例
interface GraphNode {
  name: string;
  execute: (state: GraphState) => Promise<GraphState>;
  edges: GraphEdge[];
}

interface GraphEdge {
  from: string;
  to: string;
  condition?: (state: GraphState) => boolean;
}

const graph: GraphNode[] = [
  {
    name: 'intent-router',
    execute: intentRouterNode,
    edges: [
      { from: 'intent-router', to: 'jd-generator', condition: s => s.intent === 'GENERATE_JD' },
      { from: 'intent-router', to: 'resume-submitter', condition: s => s.intent === 'SUBMIT_RESUME' },
      { from: 'intent-router', to: 'progress-tracker', condition: s => s.intent === 'QUERY_PROGRESS' },
    ]
  },
  {
    name: 'jd-generator',
    execute: jdGenNode,
    edges: [
      { from: 'jd-generator', to: 'jd-confirmer' },
    ]
  },
  {
    name: 'jd-confirmer',
    execute: jdConfirmNode,
    edges: [
      { from: 'jd-confirmer', to: 'resume-collector', condition: s => s.confirmed },
      { from: 'jd-confirmer', to: 'jd-generator', condition: s => !s.confirmed },
    ]
  },
  // ...
];
```

| 维度 | 评估 |
|------|------|
| **实现复杂度** | ⭐⭐⭐⭐ 高 — 需要图遍历引擎、条件路由、状态序列化 |
| **协同收益** | ⭐⭐⭐⭐⭐ 非常高 — 声明式依赖、条件回退、完整可视化 |
| **适用范围** | 复杂多分支流程、需要"回退修改"能力 |
| **局限性** | 过重！当前仅 7 个意图的招聘流程用图状态机是杀鸡用牛刀。Agent 较多且交互复杂时（10+ Agent）才值得 |
| **与现状差异** | 大 — 需要重构 engine 核心，但类型系统接近 |

---

### 方案 C: 事件驱动 + 黑板系统（参考 OpenAI Swarm / CrewAI）

**适用场景**: Agent 需要灵活交互、动态分配任务、共享工作内存

```
                   ┌──────────────────────────────┐
                   │       MESSAGE BUS (EventBus)  │
                   └──┬────────┬────────┬─────────┘
                      │        │        │
        ┌─────────────▼──┐ ┌──▼───────────▼──┐ ┌─▼─────────────┐
        │  JD Generator  │ │ Resume Parser   │ │Screening Scorer│
        │  订阅: JOB_REQ │ │ 订阅: RESUME_IN │ │ 订阅: JDB.RESUMES│
        │  发布: JDB.CREATED │ 发布: RESUME_PARSED│ │ 发布: SCORE_READY│
        └────────────────┘ └────────────────┘ └────────────────┘
                   ▲              ▲               ▲
                   │              │               │
                   │     ┌────────┴────────┐      │
                   │     │ Intent Router   │      │
                   │     └─────────────────┘      │
                   │                              │
        ┌──────────┴──────────────────────────────┴──┐
        │         SHARED BLACKBOARD                    │
        │  ┌──────────────────────────────────────┐   │
        │  │ Key: current_job → { title, dept... } │   │
        │  │ Key: resumes[] → [ParsedResume...]    │   │
        │  │ Key: scores[] → [CandidateScore...]   │   │
        │  │ Key: workflow_status → ACTIVE │ BLOCKED│   │
        │  │ Key: agent_events[] → EventLog        │   │
        │  └──────────────────────────────────────┘   │
        └─────────────────────────────────────────────┘
```

**核心设计**:
1. 每个 Agent 是独立的订阅者/发布者（Actor 模式）
2. Message Bus 负责 Agent 间解耦通信
3. Blackboard 是所有 Agent 的共享工作内存（Key-Value 读/写）
4. Orchestrator 负责全局工作流生命周期：启动任务 → 监听事件 → 判断完成

```typescript
// 伪代码示例
class JdGeneratorAgent {
  onEvent = async (event: AgentEvent) => {
    if (event.type === 'USER_INTENT' && event.data.intent === 'GENERATE_JD') {
      const job = await this.generateJD(event.data.message);
      await blackboard.write('current_job', job);
      await bus.publish({ type: 'JD_CREATED', data: { job } });
      await bus.publish({ type: 'STATE_CHANGED', data: { state: 'COLLECTING' } });
    }
  };
}

class ScreeningScorerAgent {
  onEvent = async (event: AgentEvent) => {
    if (event.type === 'USER_INTENT' && event.data.intent === 'SCREEN_RESUMES') {
      const job = await blackboard.read('current_job');
      const resumes = await blackboard.read('resumes');
      if (!job) { bus.publish({ type: 'ERROR', data: 'No JD yet' }); return; }
      if (resumes.length < 3) { bus.publish({ type: 'WARN', data: 'Need 3+ resumes' }); return; }
      const scores = await this.score(job, resumes);
      await blackboard.write('scores', scores);
      await bus.publish({ type: 'SCORE_READY', data: { scores } });
    }
  };
}
```

| 维度 | 评估 |
|------|------|
| **实现复杂度** | ⭐⭐⭐⭐⭐ 非常高 — 需要实现 EventBus、Blackboard、Actor 生命周期管理 |
| **协同收益** | ⭐⭐⭐⭐⭐ 非常高 — 最灵活、最解耦、支持并行和动态交互 |
| **适用范围** | 多 Agent 并行协作、不确定顺序的任务、需要 Agent 自主决策的场景 |
| **局限性** | 严重过重 — 事件驱动调试困难、一致性保证复杂、当前场景不需要 |
| **与现状差异** | 极大 — 完全颠覆现有架构 |

---

## 4. 推荐方案排序和理由

### 三阶段路线图（渐进式演进）

```
当前状态:                   阶段1 (本周)              阶段2 (下周)             阶段3 (未来)
Monolithic Engine    →    Pipe-and-Filter    →    Graph-State    →    Event+Blackboard
                            (方案 A)               (方案 B)             (方案 C)

Agent 数: 7            Agent 数: 7             Agent 数: 7-12         Agent 数: 10+
复杂度: 简单            复杂度: 简单            复杂度: 中等           复杂度: 高
协同度: 0              协同度: 40%             协同度: 70%            协同度: 95%
```

### 推荐排序

| 排名 | 方案 | 当前适用度 | 理由 |
|:----:|------|:--------:|------|
| 🥇 1 | **Pipe-and-Filter 流水线 (方案 A)** | ✅ 立即采用 | 改动最小，与现有 engine 结构兼容。当前 7 个意图 / 5 个 Agent 用 Pipeline 完全够用。可直接解决根因 1、3、5 |
| 🥈 2 | **Graph-State 编排 (方案 B)** | ⏳ 条件采用 | 当 Agent 数超过 10 个、需要条件回退和并行分支时升级。当前场景过重 |
| 🥉 3 | **事件驱动 + 黑板 (方案 C)** | ❌ 暂不采用 | 当前 Agent 没有自主决策需求，流程是确定性的。过早引入会大幅增加调试难度 |

### 推荐理由详解

**阶段 1 — 采用方案 A (Pipe-and-Filter)** 的理由：

1. **最小修改量**: 当前 `RecruitmentAgentEngine` 的 `processMessage()` -> `switch(intent)` 模式天然是 Pipeline 的雏形。只需：
   - 定义 `PipelineStep` 接口
   - 将 `handle*` 方法改为独立 Pipeline Step 类
   - 添加 JSON/YAML 配置文件定义执行顺序
   - 保持 `AgentResponse` 不变——前端零改动

2. **直接根治的问题**:
   - 根因 1 (Agent 无运行时) → 每个 Step 是独立类，有明确接口
   - 根因 3 (隐式依赖) → Pipeline 配置文件声明依赖关系
   - 根因 5 (无聚合节点) → Pipeline 末尾加 `ResultAggregator` Step

3. **改动清单**:
   ```
   新增文件:
     src/lib/pipeline/types.ts          — PipelineStep 接口定义
     src/lib/pipeline/engine.ts         — PipelineRunner
     src/lib/pipeline/steps/*.ts        — 7 个 Step 类 (从 engine 抽离)
     src/lib/pipeline/config.yaml       — 流水线配置文件
   
   修改文件:
     src/lib/agent-engine.ts            — 改为调用 PipelineRunner
     src/types/index.ts                 — 新增 PipelineContext 类型
   
   不改动:
     src/agents/*.ts                    — prompt 文件不变
     src/store/recruitmentStore.ts      — Zustand Store 不变
     src/lib/resume-parser-agent.ts     — 已是独立 Agent，直接作为 Step
     src/lib/agent-tools.ts             — Tool 系统不变
     所有前端组件                         — 零改动
   ```

4. **实现复杂度**:
   - 核心 Pipeline 引擎: ~150 行代码
   - 每个 Step 类: ~50-80 行代码 (从 engine 迁出)
   - YAML 配置文件: ~30 行
   - 总预计代码量: ~500 行新增 + ~200 行修改

---

## 5. 附录: 方案 A 实施概要

### 5.1 新文件结构

```
src/lib/pipeline/
├── types.ts          # PipelineStep, PipelineContext, PipelineConfig
├── engine.ts         # PipelineRunner: 按 config 执行步骤
├── steps/
│   ├── intent-router.step.ts
│   ├── jd-generator.step.ts
│   ├── jd-confirmer.step.ts
│   ├── resume-submitter.step.ts
│   ├── screening-scorer.step.ts
│   ├── progress-tracker.step.ts
│   └── result-aggregator.step.ts
└── config.yaml       # 声明式流程配置
```

### 5.2 PipelineConfig YAML 示例

```yaml
pipeline:
  name: recruitment-workflow
  version: "2.0"
  steps:
    - id: intent-router
      agent: intent-router
      dependsOn: []
      onError: halt
      timeout: 10000

    - id: jd-generator
      agent: jd-generator
      dependsOn: [intent-router]
      condition: "context.intent === 'GENERATE_JD'"
      onError: halt

    - id: resume-collector
      agent: resume-parser
      dependsOn: []
      condition: "context.intent === 'SUBMIT_RESUME'"
      onError: halt

    - id: screening-scorer
      agent: screening-scorer
      dependsOn: [resume-collector, jd-generator]
      condition: "context.intent === 'SCREEN_RESUMES'"
      guard: "context.parsedResumes.length >= 3"
      onError: halt

    - id: progress-tracker
      agent: progress-tracker
      dependsOn: []
      condition: "context.intent === 'QUERY_PROGRESS'"
      onError: skip

    - id: result-aggregator
      dependsOn: [jd-generator, screening-scorer, progress-tracker]
      aggregator: true
```

### 5.3 PipelineContext 增强

```typescript
// 新增 types
interface PipelineContext extends ConversationContext {
  intent: IntentType;
  userMessage: string;
  stepResults: Map<string, AgentResponse>;
  errors: PipelineError[];
  startTime: number;
  metadata: Record<string, unknown>;
}

interface PipelineError {
  stepId: string;
  message: string;
  timestamp: number;
  recoverable: boolean;
}
```

(审查完毕)
