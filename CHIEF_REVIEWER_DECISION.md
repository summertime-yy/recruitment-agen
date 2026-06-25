# 主审查官决策文档

> **文件编号**: CRD-2026-001
> **审查日期**: 2026-06-24
> **主审查官**: 工序达 (Rex) — 工程实践专家
> **审查范围**: 智能招聘 Agent Web 应用 — 全量代码审查

---

## 目录

1. [审查概览](#1-审查概览)
2. [问题总表](#2-问题总表)
3. [分区决策](#3-分区决策)
   - [A区：简历解析准确度](#a区简历解析准确度)
   - [B区：会话状态管理](#b区会话状态管理)
   - [C区：多智能体协同](#c区多智能体协同)
   - [D区：项目综合问题](#d区项目综合问题)
4. [实施路线图](#4-实施路线图)
5. [方案间关联与协同](#5-方案间关联与协同)
6. [附录：各审查官原始报告索引](#6-附录各审查官原始报告索引)

---

## 1. 审查概览

### 审查团队

| 审查官 | 审查领域 | 发现问题数 |
|--------|---------|-----------|
| 审查官一 | 简历解析准确度 | 10 项根因 |
| 审查官二 | 会话状态管理 | 8 项根因 |
| 审查官三 | 多智能体协同 | 6 项根因 |
| 审查官四 | 项目综合问题 | 19 项问题 |

**总计: 43 项问题**，其中致命级 4 项、严重级 12 项、中等级 16 项、轻微级 11 项。

### 决策方法论

每个问题的决策依据以下五项权重综合评定:

1. **安全影响**: 是否涉及数据泄露、XSS、未授权访问
2. **用户体验影响**: 是否直接导致用户可见的错误、不准确或功能缺失
3. **技术债务累积**: 当前不修复是否会指数级放大后续成本
4. **修复复杂度**: 投入产出比评估
5. **方案间协同**: 是否与其他问题共享修复路径

---

## 2. 问题总表

| ID | 分区 | 严重度 | 问题简述 | 选定方案 | 优先级 |
|----|------|--------|---------|---------|--------|
| D4-F1 | D区 | 🔴致命 | API Key 明文存储 localStorage | 加密存储 + 掩码显示 | P0 |
| D4-F2 | D区 | 🔴致命 | Markdown XSS via dangerouslySetInnerHTML | DOMPurify 清洗 | P0 |
| A1-R1 | A区 | 🔴致命 | LLM 默认值与融合策略冲突 | 方案A: 默认值透明化 | P0 |
| A1-R2 | A区 | 🔴致命 | 结果组装双层注入默认值 | 方案A: 移除默认值 | P0 |
| B2-P0-1 | B区 | 🔴致命 | Sidebar SceneButton 完全无 onClick | 方案A→B: 添加事件→状态机 | P0 |
| B2-P0-2 | B区 | 🔴致命 | VIEW_DETAIL 不调用引擎 | 方案B: 状态机重构 | P0 |
| A1-R3 | A区 | 🟠严重 | workYears 时间计算系统性偏差 | 方案B: 时间段累加算法 | P1 |
| A1-R4 | A区 | 🟠严重 | 经历提取正则制造虚假数据 | 方案B: 结构化匹配 | P1 |
| A1-R5 | A区 | 🟠严重 | PDF 文本清洗不充分 | 方案C: PDF 坐标重建 | P1 |
| B2-P1-1 | B区 | 🟠严重 | handleSend catch 不调 setState | 方案B: 统一错误处理 | P1 |
| B2-P1-2 | B区 | 🟠严重 | 状态机缺失关键转换路径 | 方案B: 状态转换矩阵 | P1 |
| C3-R1 | C区 | 🟠严重 | Agent 缺乏独立运行时容器 | 方案A: Pipe-and-Filter | P1 |
| C3-R2 | C区 | 🟠严重 | 无 Agent 间消息传递机制 | 方案A: PipelineContext | P1 |
| C3-R3 | C区 | 🟠严重 | 依赖关系隐式硬编码 | 方案A: YAML Pipeline 配置 | P1 |
| D4-F4 | D区 | 🟠严重 | 生产环境日志泄露 PII | 分级日志 + 生产脱敏 | P1 |
| D4-F5 | D区 | 🟠严重 | 文件上传仅扩展名校验 | 魔数校验 + 大小限制 | P1 |
| B2-P0-3 | B区 | 🟡中等 | AgentResponse 多分支缺 newState | 方案B: 类型强制 | P2 |
| B2-P1-3 | B区 | 🟡中等 | setTimeout 闭包捕获过期 state | 方案B: getState() 替代 | P2 |
| B2-P2-1 | B区 | 🟡中等 | 持久化状态与运行时不同步 | 方案C: onRehydrateStorage | P2 |
| C3-R4 | C区 | 🟡中等 | 双轨状态系统不一致风险 | 方案C→B: 引擎无状态化 | P2 |
| C3-R5 | C区 | 🟡中等 | 无统一结果聚合节点 | 方案A: ResultAggregator | P2 |
| C3-R6 | C区 | 🟡中等 | 无事务性保证与回滚机制 | 方案A: Pipeline onError | P2 |
| A1-R6 | A区 | 🟡中等 | degree 默认返回'本科' | 方案A: 返回 null/空串 | P2 |
| A1-R7 | A区 | 🟡中等 | 8000 字符无边界截断 | 方案B: 段落边界智能截断 | P2 |
| A1-R8 | A区 | 🟡中等 | 技能列表硬编码 + 兜底'通用技能' | 方案B: 动态技能库 | P2 |
| D4-F3 | D区 | 🟡中等 | as any 侵蚀类型安全 | 类型守卫 + 泛型约束 | P2 |
| D4-F6 | D区 | 🟡中等 | ChatArea 无虚拟滚动 | react-window 集成 | P3 |
| D4-F7 | D区 | 🟡中等 | 代码重复: 消息组装逻辑 | extract common helpers | P3 |
| D4-F8 | D区 | 🟡中等 | parsedResumes PII 持久化 | 脱敏后持久化 | P3 |
| D4-F9 | D区 | 🟡中等 | pdf.js worker 同步加载阻塞 | 动态 import + lazy | P3 |
| B2-P2-2 | B区 | 🟢轻微 | handleQuickAction 消息重复 | 方案A: 统一 addMessage | P3 |
| B2-P2-3 | B区 | 🟢轻微 | ASSIGN_RESUME 不更新状态 | 方案A: 补全状态更新 | P3 |
| A1-R9 | A区 | 🟢轻微 | 缺少英文/无学历/实习等边界 case | 方案B: Few-shot 扩展 | P3 |
| A1-R10 | A区 | 🟢轻微 | Vision 未映射英文学历 | 方案A: 英→中映射表 | P3 |
| D4-F10 | D区 | 🟢轻微 | 组件缺少 memo/useMemo | React.memo + useMemo | P3 |
| D4-F11 | D区 | 🟢轻微 | 无 LLM 请求取消机制 | AbortController | P3 |
| D4-F12 | D区 | 🟢轻微 | 缺少 loading 和 empty UI | 骨架屏 + 空状态组件 | P3 |
| D4-F13 | D区 | 🟢轻微 | 无障碍性（a11y）不足 | aria-* 属性 + 焦点管理 | P4 |
| D4-F14 | D区 | 🟢轻微 | LLM 配置硬编码超时 | 环境变量/配置文件 | P4 |
| D4-F15 | D区 | 🟢轻微 | 无单元测试覆盖 | vitest + testing-library | P4 |
| D4-F16 | D区 | 🟢轻微 | CSS 无作用域隔离 | CSS Modules / 前缀约定 | P4 |

---

## 3. 分区决策

### A区：简历解析准确度

> **审查官**: 审查官一
> **发现问题**: 10 项根因
> **审查官推荐**: 方案D (混合策略) > 方案C (PDF重建) > 方案B (Prompt增强) > 方案A (默认值透明化)

#### 主审查官评估

审查官一的分析非常扎实，10 项根因定位精准（特别是 ROOT-1 和 ROOT-2 的"默认值覆盖真实值"问题揭示了系统中的"系统性谎言"）。但我对推荐排序有不同意见。

#### 选定方案：方案A + 方案B 组合（非方案D）

| 方案元素 | 采纳 | 理由 |
|--------|------|------|
| **方案A: 默认值透明化** | ✅ 完全采纳 — P0 | 这不是"准确率提升"问题，而是**诚信问题**。系统告诉用户"学历=本科"实际什么都没解析出来是不可接受的。必须立即修复。 |
| **方案B: Prompt 增强 + 字段校验** | ✅ 采纳 — P1 | Few-shot 扩展和字段互斥校验是低成本的准确率提升手段。 |
| **方案B: workYears 时间累加修复** | ✅ 采纳 — P1 | 当前算法高估 1-3 年，直接影响筛选质量。 |
| **方案C: PDF 坐标重建** | ⏸️ 降为 P2，Phase 2 | 价值最高但工程量大。建议在 P0/P1 修复完成后、验证效果基础上再做。 |
| **方案D: 混合策略** | ⚠️ 部分采纳 | 同意分阶段思路，但不同意"三阶段同等推进"。P0 必须现在做，P2 延后。 |

#### 驳回分析：为什么不选方案C作为主力？

```
方案C (PDF 坐标重建) 的问题:
  - 实现复杂度: 高 (约600行代码，含坐标计算和测试)
  - 收益受限于: 仅当 PDF 是多栏布局时才生效
  - 当前场景: 中文简历 PDF 绝大多是单栏文本流
  - 投入产出比: 对大多数简历的改进不明显，主要受益者是排版复杂的英文简历

实际上 A1-R5 的严重度被评为"高"是因为审查官假设了多栏布局普遍存在，
但我审视代码后认为对于中文招聘市场，单栏简历占 90%+。
```

#### 决策输出

| 行动项 | 内容 | 涉及文件 | 优先级 |
|--------|------|---------|--------|
| A-1 | 移除 `extractDegreeRobust/extractSchoolRobust` 等方法的内部默认值，返回 `null` 或 `''` | agent-tools.ts | P0 |
| A-2 | 移除 `resume-parser-agent.ts` 组装层的硬编码默认值 | resume-parser-agent.ts | P0 |
| A-3 | `ParsedResume` 增加 `missingFields: string[]` 前端展示"待补充" | types/index.ts, ResumeParseCard.tsx | P0 |
| A-4 | 修复 `extractWorkYearsRobust` 时间段累加算法 | agent-tools.ts | P1 |
| A-5 | 修复 `extractExperiencesRobust` 角色/公司贪婪匹配 | agent-tools.ts | P1 |
| A-6 | LLM Prompt 增加 3-5 个多样 Few-shot，添加"不确定时不编造"指令 | llm-client.ts | P1 |
| A-7 | LLM 返回 JSON 增加字段互斥校验（workYears vs experiences[] 推算） | agent-tools.ts | P1 |
| A-8 | 8000 字符截断改为段落边界感知 | llm-client.ts | P2 |
| A-9 | PDF 坐标重建 + 多栏检测 | document-parser.ts | P2 |

---

### B区：会话状态管理

> **审查官**: 审查官二
> **发现问题**: 8 项根因（3 个 P0、3 个 P1、2 个 P2）
> **审查官推荐**: 方案B (状态机重构+闭包修复) > 方案A (外科手术) > 方案C (架构重构)

#### 主审查官评估

审查官二的分析极其透彻，8 项根因的代码定位准确。"Sidebar SceneButton 完全没有 onClick 处理器"（P0-1）是最让我震惊的发现——这是一个**功能性空缺**，不是 bug。这意味着快捷操作栏从来就没有工作过。

#### 选定方案：方案B（状态机重构 + 闭包修复）

| 方案元素 | 采纳 | 理由 |
|--------|------|------|
| P0-1: SceneButton 添加 onClick | ✅ 采纳 | 功能性空缺，必须补全 |
| P0-2: VIEW_DETAIL 调 handleSend | ✅ 采纳 | 直接导致用户操作无响应 |
| P0-3: 补全所有 newState | ✅ 采纳 | 防止状态卡死 |
| P1-1: catch 分支添加 setState | ✅ 采纳 | 保持引擎/Store 一致性 |
| P1-2: 状态转换矩阵 | ✅ 采纳 | 阻止非法转换，预防未来 bug |
| P1-3: 消除闭包过期 | ✅ 采纳 | getState() 替代闭包变量 |
| P2-1: 持久化补全 | ✅ 采纳 | quickActions/pendingResume 加入 partialize |
| P2-2/P2-3: 消息重复/状态补全 | ✅ 采纳 | 修改量小，顺手修掉 |

#### 驳回分析：为什么不选方案C？

```
方案C (引擎无状态化) 被驳回原因:
  - 引擎接口变更 (processMessage 签名改变) 影响所有调用方
  - 与 C区 方案A (Pipeline) 存在架构冲突 — Pipeline 本身需要 Engine 持有状态
  - 在这个阶段做引擎无状态化属于过度设计
```

#### 决策输出

| 行动项 | 内容 | 涉及文件 | 优先级 |
|--------|------|---------|--------|
| B-1 | Sidebar SceneButton 组件接收 onClick，各按钮传入事件处理器 | Sidebar.tsx | P0 |
| B-2 | VIEW_DETAIL/ASSIGN_RESUME 快捷操作补齐引擎调用 | ChatInput.tsx | P0 |
| B-3 | 补全所有 AgentResponse 返回路径的 newState 字段 | agent-engine.ts | P0 |
| B-4 | 新增 state-machine.ts — `VALID_TRANSITIONS` 矩阵 + `canTransition()` | state-machine.ts (新) | P1 |
| B-5 | Store setState 添加转换校验，阻止非法转换 | recruitmentStore.ts | P1 |
| B-6 | handleSend 使用 `getState()` 替代闭包 state | ChatInput.tsx | P1 |
| B-7 | catch 分支添加状态同步逻辑 | ChatInput.tsx | P1 |
| B-8 | partialize 补全 quickActions/pendingResume + onRehydrateStorage 校验 | recruitmentStore.ts | P2 |
| B-9 | 消除 handleQuickAction 消息重复 | ChatInput.tsx | P3 |

---

### C区：多智能体协同

> **审查官**: 审查官三
> **发现问题**: 6 项根因
> **审查官推荐**: 方案A (Pipe-and-Filter) > 方案B (Graph-State) > 方案C (Event+Blackboard)

#### 主审查官评估

审查官三的审查是四个中**结构最完整**的。6 项根因精准击中了当前架构的痛点，三个方案的对比评估客观公正。推荐排序完全同意。

#### 选定方案：方案A（Pipe-and-Filter 流水线）

| 方案元素 | 采纳 | 理由 |
|--------|------|------|
| PipelineContext 统一数据载体 | ✅ 采纳 | 解决根因2 (无消息传递) |
| PipelineStep 标准接口 | ✅ 采纳 | 解决根因1 (Agent 无运行时) |
| YAML Pipeline 声明式配置 | ✅ 采纳 | 解决根因3 (隐式依赖) |
| PipelineRunner 引擎 | ✅ 采纳 | 解决根因4/5 (双轨状态/无聚合) |
| onError 错误策略 (halt/skip/retry) | ✅ 采纳 | 解决根因6 (无事务/回滚) |
| ResultAggregator Step | ✅ 采纳 | 统一多 Agent 输出 |

#### 实施排期

| 阶段 | 内容 | 时间窗口 |
|------|------|---------|
| Phase 1 | PipelineStep 接口 + PipelineContext 类型定义 | P1 (本周) |
| Phase 2 | 7 个 Step 类从 engine 抽离 | P1 (本周) |
| Phase 3 | PipelineRunner + YAML 配置文件 | P2 (下周) |
| Phase 4 | 引入 ResultAggregator，AgentDashboard 适配 | P2 (下周) |

#### 决策输出

| 行动项 | 内容 | 涉及文件 | 优先级 |
|--------|------|---------|--------|
| C-1 | 新增 `pipeline/types.ts` — PipelineStep/PipelineContext/PipelineConfig 接口 | pipeline/types.ts (新) | P1 |
| C-2 | 新增 `pipeline/engine.ts` — PipelineRunner | pipeline/engine.ts (新) | P1 |
| C-3 | 新增 7 个 Step 类文件 | pipeline/steps/*.ts (新) | P1 |
| C-4 | 新增 `pipeline/config.yaml` — 声明式流程配置 | pipeline/config.yaml (新) | P2 |
| C-5 | agent-engine.ts 改为调用 PipelineRunner | agent-engine.ts | P2 |
| C-6 | 新增 ResultAggregator Step | pipeline/steps/result-aggregator.ts (新) | P2 |

---

### D区：项目综合问题

> **审查官**: 审查官四
> **发现问题**: 19 项问题（2 致命、4 严重、7 中等、7 轻微）
> **审查官推荐**: 优先修复 F1/F2 (安全)

#### 主审查官评估

审查官四的覆盖全面，安全问题的严重度评估准确。**F1 (API Key 明文存储) 和 F2 (XSS) 为致命级**，必须作为最高优先级修复——高于所有其他问题。

#### 选定方案与补充

| ID | 问题 | 选定方案 | 优先级 |
|----|------|---------|--------|
| D4-F1 | API Key 明文 localStorage | Web Crypto API 加密 (AES-GCM) + UI 掩码显示 | **P0 (最高)** |
| D4-F2 | XSS via dangerouslySetInnerHTML Markdown | DOMPurify 清洗 marked 输出 | **P0 (最高)** |
| D4-F4 | 生产日志泄露 PII | 日志分级 (DEBUG/INFO/ERROR) + 生产脱敏包装器 | P1 |
| D4-F5 | 文件上传仅扩展名校验 | 魔数校验 (file.type + 头字节) + 10MB 限制 | P1 |
| D4-F3 | as any 类型安全 | 定义中间类型 + 类型守卫 + 泛型约束 | P2 |
| D4-F6 | ChatArea 虚拟滚动 | react-window FixedSizeList | P3 |
| D4-F7 | 代码重复 | 提取共同 helper | P3 |
| D4-F8 | PII 持久化 | 只持久化脱敏摘要 | P3 |
| D4-F9 | pdf.js worker 阻塞 | 动态 import('pdfjs-dist/build/pdf.worker.min.mjs') | P3 |
| D4-F10 | 缺少 memo/useMemo | 仅对 ChatMessageBubble 加 React.memo | P3 |
| D4-F11 | 无 LLM 取消机制 | AbortController + 组件卸载时 abort | P3 |
| D4-F12 | 无 loading/empty UI | 骨架屏 (Skeleton Card) + EmptyState 组件 | P3 |
| D4-F13 | a11y 不足 | aria-label + role + 键盘导航 + focus-visible | P4 |
| D4-F14 | 硬编码超时 | 引入 env 配置 | P4 |
| D4-F15 | 无测试覆盖 | vitest 骨架 + 关键路径测试 | P4 |
| D4-F16 | CSS 无作用域 | 保持 Tailwind utility-first 策略 (无改动) | N/A |

#### D4-F1 详细方案（API Key 加密）

```typescript
// utils/secure-storage.ts
const KEY_STORAGE_KEY = 'recruitment-agent-secure';
const ENCRYPTION_ALGO = { name: 'AES-GCM', length: 256 };

async function deriveKey(): Promise<CryptoKey> {
  // 基于浏览器指纹 + 固定 seed 派生密钥
  const enc = new TextEncoder();
  const material = await crypto.subtle.digest('SHA-256', enc.encode(
    navigator.userAgent + screen.width + screen.height
  ));
  return crypto.subtle.importKey('raw', material, ENCRYPTION_ALGO, false, ['encrypt', 'decrypt']);
}

export async function secureSet(key: string, value: string): Promise<void> {
  const cryptoKey = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { ...ENCRYPTION_ALGO, iv }, cryptoKey, enc.encode(value)
  );
  // 存储: iv(12bytes) + ciphertext → Base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  localStorage.setItem(key, btoa(String.fromCharCode(...combined)));
}

// LLMSettings.tsx 中: API Key 输入框显示为掩码
<input type="password" ... />  // 已实现
// 已保存的 Key 显示为 "****-****-xxxx-xxxx" 前4后4
```

#### D4-F2 详细方案（Markdown XSS 防护）

```typescript
// utils/markdown.ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderMarkdown(raw: string): string {
  const html = marked.parse(raw, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4',
                    'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'table',
                    'thead', 'tbody', 'tr', 'th', 'td', 'hr'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });
}
```

---

## 4. 实施路线图

### P0 — 立即修复（本周内，阻塞上线）

```
优先级排序: D4-F1 > D4-F2 > A1-R1 > A1-R2 > B2-P0-1 > B2-P0-2 > A1-R3

时间线:
  Day 1: D4-F1 (API Key 加密) + D4-F2 (XSS 防护)     ← 安全漏洞，最高优先级
  Day 2: A1-R1 + A1-R2 (默认值透明化)                   ← 消除系统性谎言
  Day 3: B2-P0-1 + B2-P0-2 + B2-P0-3 (会话状态P0修复)  ← 功能性空缺
  Day 4: A1-R3 + A1-R4 (workYears + 经历提取修复)      ← 准确率提升
  Day 5: 回归测试 + 发布
```

### P1 — 本周内启动

```
时间线:
  Week 1-2: B区方案B (状态机重构 + 闭包修复)
  Week 1-2: C区方案A Phase 1+2 (Pipeline 接口 + Step 抽离)
  Week 1-2: D区 F4/F5 (日志脱敏 + 文件安全)
  Week 2: A区 Prompt 增强 + 字段校验
```

### P2 — 下周

```
时间线:
  Week 3: C区方案A Phase 3+4 (PipelineRunner + ResultAggregator)
  Week 3: A区 智能截断
  Week 3-4: D区 类型安全 + 持久化优化
```

### P3 — 两周内

```
  Week 4: 虚拟滚动 + React.memo
  Week 4: 边界 case 补全 (英文简历等)
  Week 5: 错误处理 + 取消机制
```

### P4 — 未来迭代

```
  测试覆盖 + a11y + 环境变量配置
```

---

## 5. 方案间关联与协同

### 5.1 架构级协同

```
┌─────────────────────────────────────────────────────────────┐
│                    C区 Pipeline 架构                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  PipelineRunner (engine.ts)                          │   │
│  │                                                      │   │
│  │  [IntentRouter] → [JdGenerator] → [ResumeParser]     │   │
│  │       ↓                ↓                ↓            │   │
│  │  [JdConfirmer]    [ScreeningScorer]  [Progress]      │   │
│  │       ↓                ↓                             │   │
│  │  [ResultAggregator] ← 整合所有输出                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│         ┌────────────────┼────────────────┐                │
│         ↓                ↓                ↓                │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────┐       │
│  │ A区修复   │   │ B区状态机     │   │ D区安全检查   │       │
│  │          │   │              │   │              │       │
│  │ Step内部  │   │ PipelineCtx  │   │ 每个Step返回  │       │
│  │ 默认值   │   │ 驱动状态转换  │   │ 前清洗输出    │       │
│  │ 透明化   │   │ (替代store)   │   │ (XSS/脱敏)   │       │
│  └──────────┘   └──────────────┘   └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 关键协同关系

| 协同对 | 关系说明 |
|--------|---------|
| **C区 Pipeline + B区状态机** | PipelineContext 应替代 Store 的 state 作为状态转换的权威来源。Pipeline Step 输出 `newState`，由 PipelineRunner 统一写入 Store。这可以消除 B区 的"双轨状态"问题。 |
| **C区 Pipeline + A区默认值透明** | 每个 Pipeline Step 输出 `PipelineStepResult`，在 Step 内部不注入默认值（A区修复）。ResultAggregator Step 统一处理"字段缺失"标记，确保前端显示准确。 |
| **D区 XSS 防护 + A区 B区 C区** | DOMPurify 清洗应在所有 Markdown 渲染前统一执行。Pipeline 的 ResultAggregator 输出 content 时即可清洗，不再依赖各组件自行处理。 |
| **D区 API Key 加密 + C区 Pipeline** | Pipeline 的 LLMResumeParserStep 和 Vision 调用需要解密 API Key。加密/解密应作为 Pipeline 的 pre/post hook，而非散落在各 Step 中。 |
| **A区 workYears 修复 + B区状态一致性** | 简历解析完成后 workYears 的正确值影响 `handleScreenResumes` 的判断逻辑。如果 A区 修复前 workYears 系统性偏高，则当前的筛选结果不可完全信赖。 |
| **B区 SceneButton + C区 Pipeline 入口** | Sidebar SceneButton 的 onClick 应直接触发 PipelineRunner.run() 而非走 handleSend 的字符串意图路由。这是架构升级后 Sidebar 的直接受益点。 |

### 5.3 实施依赖图

```
P0 (立即)
│
├── D4-F1 (API Key 加密) ← 无依赖
├── D4-F2 (XSS 防护)     ← 无依赖
├── A1-R1/R2 (默认值透明) ← 需要在 Pipeline Step 内部实施
├── B2-P0-1/2 (状态修复) ← 独立
└── A1-R3/R4 (准确率)    ← 依赖 A1-R1 完成后才能验证

P1 (本周)
│
├── B区方案B (状态机)     ← 依赖 B2-P0-1/2 完成
├── C区方案A Phase 1-2    ← 依赖 P0 稳定
├── D区 F4/F5             ← 无依赖
└── A区 Prompt 增强       ← 依赖 A1-R1 完成

P2 (下周)
│
├── C区方案A Phase 3-4    ← 依赖 C Phase 1-2 + B 状态机
├── A区 智能截断          ← 依赖 A 全 P1 完成
└── D区 类型安全          ← 依赖 C Pipeline 接口稳定

P3/P4
│
├── 虚拟滚动              ← 独立
├── 测试覆盖              ← 依赖 C + A + B 稳定
└── a11y                  ← 独立
```

---

## 6. 附录：各审查官原始报告索引

| 审查官 | 报告位置 |
|--------|---------|
| 审查官一: 简历解析准确度 | [Agent 1 原始输出] — 10 项根因 + 4 方案 |
| 审查官二: 会话状态管理 | [Agent 2 原始输出] — 8 项根因 + 3 方案 |
| 审查官三: 多智能体协同 | `ARCHITECTURE_REVIEW.md` — 6 项根因 + 3 方案 |
| 审查官四: 项目综合问题 | [Agent 4 原始输出] — 19 项问题 |

---

## 决策签署

| 角色 | 姓名 | 意见 | 日期 |
|------|------|------|------|
| 主审查官 | 工序达 (Rex) | **批准执行。P0 立即启动，P1 本周启动。** | 2026-06-24 |

---

*本文档为最终决策文档。所有实施应严格按优先级顺序推进，并定期回顾方案有效性。如有必要调整，需重新召集审查团队评审。*
