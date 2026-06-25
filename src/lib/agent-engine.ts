/* ============================================================
   Agent Engine — 智能招聘 Agent 核心引擎
   
   双模式架构：
     1. LLM 模式（生产环境）：对接真实 LLM API
     2. 本地模拟模式（开发/演示）：本地规则引擎
   
   集成 Agent Tracer 实现全链路可观测
   ============================================================ */

import type {
  ConversationState, IntentType, AgentResponse,
  JobPosition, ParsedResume, ConversationContext, CandidateScore,
} from '../types';
import {
  FALLBACK_RESPONSE,
} from '../agents/intent-router';
import {
  NON_RESUME_RESPONSE,
} from '../agents/resume-parser';
import {
  INSUFFICIENT_RESUMES_RESPONSE,
} from '../agents/screening-scorer';
import {
  NO_ACTIVE_JOB_RESPONSE,
} from '../agents/progress-tracker';
import {
  LLMClient, getLLMClient, type LLMConfig, type LLMMessage,
  INTENT_SYSTEM_PROMPT, getJDGeneratePrompt, getResumeParsePrompt,
  getScreeningPrompt, getProgressPrompt, getDetailPrompt,
} from './llm-client';
import {
  getAgentTracer, type AgentTracer,
} from './agent-tracer';
import {
  getResumeParserAgent, type ResumeParserContext,
} from './resume-parser-agent';
import { matchIntent } from './intent-rules';

// ============================================================
// RecruitmentAgentEngine — 重构版（LLM + Tracer）
// ============================================================

interface MockParsedResult {
  isResume: boolean;
  name: string;
  degree: string;
  school: string;
  major: string;
  workYears: number;
  city: string;
  skills: string[];
  experiences: Array<{ role: string; company: string; period: string; duration: string }>;
  confidence: 'high' | 'medium' | 'low';
  age?: number;
}

export class RecruitmentAgentEngine {
  private context: ConversationContext;
  private state: ConversationState;
  private llm: LLMClient;
  private tracer: AgentTracer;
  private llmEnabled: boolean;

  /** LLM 短路器：一次超时后，短时间内跳过所有 LLM 调用 */
  private llmCircuitOpen: boolean = false;
  private llmCircuitUntil: number = 0;

  constructor(config?: Partial<LLMConfig>) {
    this.context = { currentJobId: null, jobs: [], parsedResumes: [] };
    this.state = 'IDLE';
    this.llm = getLLMClient(config);
    this.tracer = getAgentTracer();
    this.llmEnabled = config?.enabled ?? false;
  }

  /** 更新 LLM 配置 */
  updateLLMConfig(config: Partial<LLMConfig>) {
    this.llm.updateConfig(config);
    this.llmEnabled = config.enabled ?? this.llmEnabled;
  }

  /** 是否启用 LLM */
  isLLMEnabled(): boolean {
    return this.llmEnabled && !!this.llm.getConfig().apiKey;
  }

  /** 检查 LLM 是否可用（考虑短路器） */
  private isLLMAvailable(): boolean {
    if (!this.llmEnabled || !this.llm.getConfig().apiKey) return false;
    // 短路器打开中 → 跳过 LLM
    if (this.llmCircuitOpen) {
      if (Date.now() < this.llmCircuitUntil) return false;
      // 短路器已过期，重置
      this.llmCircuitOpen = false;
      console.log('[AgentEngine] LLM 短路器已重置，恢复 LLM 调用');
    }
    return true;
  }

  /** 打开 LLM 短路器（持续 30s） */
  private openLLMCircuit(reason: string) {
    console.warn(`[AgentEngine] LLM 短路器打开: ${reason}，30秒内跳过所有 LLM 调用`);
    this.llmCircuitOpen = true;
    this.llmCircuitUntil = Date.now() + 30000;
  }

  setContext(context: ConversationContext, state: ConversationState) {
    this.context = context;
    this.state = state;
  }

  // ============================================================
  // 核心方法：处理用户消息
  // ============================================================
  async processMessage(userMessage: string): Promise<AgentResponse> {
    const conversationTags = {
      conversationId: this.context.currentJobId || 'unknown',
      state: this.state,
    };

    // Step 1: 意图识别
    const intent = await this.recognizeIntent(userMessage);

    // Step 2: 根据意图路由到对应的 Agent
    let response: AgentResponse;

    switch (intent) {
      case 'GENERATE_JD':
        response = await this.handleGenerateJD(userMessage);
        break;
      case 'MODIFY_JD':
        response = await this.handleModifyJD(userMessage);
        break;
      case 'MODIFY_RESUME':
        response = await this.handleModifyResume(userMessage);
        break;
      case 'CONFIRM_JD':
        response = await this.handleConfirmJD();
        break;
      case 'SUBMIT_RESUME':
        response = await this.handleSubmitResume(userMessage);
        break;
      case 'SCREEN_RESUMES':
        response = await this.handleScreenResumes();
        break;
      case 'QUERY_PROGRESS':
        response = await this.handleQueryProgress();
        break;
      case 'VIEW_DETAIL':
        response = await this.handleViewDetail(userMessage);
        break;
      default:
        response = await this.handleFallback();
    }

    return response;
  }

  /**
   * 文件上传简历解析 — 通过 ResumeParserAgent + Tool 管道
   *
   * Agent 内部编排：
   *   1. DocumentParser Tool → 文件 → 纯文本
   *   2. LocalRuleParser Tool → 信号检测
   *   3. LLMResumeParser Tool（如可用）→ LLM 提取
   *   4. LocalRuleParser Tool（降级）→ 本地规则提取
   *
   * 每个 Tool 调用都会被 Tracer 记录，Dashboard 可观测
   */
  async processResumeFile(resumeText: string): Promise<AgentResponse> {
    console.log('[AgentEngine.processResumeFile] === 通过 ResumeParserAgent 解析 ===');
    console.log('[AgentEngine.processResumeFile] 文本长度:', resumeText.length);

    const agentCtx: ResumeParserContext = {
      state: this.state,
      currentJobId: this.context.currentJobId,
      jobs: this.context.jobs,
    };

    const agent = getResumeParserAgent({
      enabled: this.llmEnabled,
      apiKey: this.llm.getConfig().apiKey,
      baseUrl: this.llm.getConfig().baseUrl,
      model: this.llm.getConfig().model,
      timeout: this.llm.getConfig().timeout,
    });

    // Agent.run() 接收 { text } 而非 { file }，因为文件解析在 ChatInput 已完成
    const result = await agent.run({ text: resumeText }, agentCtx);

    if (!result.isResume || !result.resume) {
      return result.response;
    }

    return this.buildResumeResponse(result.resume);
  }

  // ============================================================
  // 意图识别（LLM 增强 + 规则兜底）
  // ============================================================
  private async recognizeIntent(message: string): Promise<IntentType> {
    const cleanMessage = message.replace(/@招聘助手|@招聘机器人|@recruit/gi, '').trim();

    // 先用规则快速匹配（降低延迟）
    const ruleIntent = this.ruleBasedIntent(cleanMessage);
    if (ruleIntent) {
      // 所有规则高置信度匹配，直接返回（包括 SUBMIT_RESUME）
      // 之前的设计排除了 SUBMIT_RESUME 是为了让 LLM 二次确认，
      // 但实际简历文本已经足够长且规则匹配准确，跳过 LLM 可节省 60s 超时等待
      return ruleIntent;
    }

    // LLM 增强意图识别（仅在规则未命中 + LLM 可用时）
    if (this.isLLMAvailable()) {
      const traceId = this.tracer.startTrace('intent-router', cleanMessage.slice(0, 200),
        { conversationId: this.context.currentJobId || 'unknown', state: this.state }, cleanMessage);

      try {
        // 意图路由使用较短超时（10s，不需要 60s）
        const llmResult = await this.llm.complete({
          systemPrompt: INTENT_SYSTEM_PROMPT,
          messages: [
            { role: 'user', content: `当前对话状态: ${this.state}\n用户消息: ${cleanMessage}\n\n请分析意图并返回JSON。` },
          ],
          temperature: 0.1,
          maxTokens: 256,
        });

        // 解析 LLM 返回的 JSON
        const parsed = this.safeParseJSON(llmResult);
        if (parsed?.intent) {
          const validIntents: IntentType[] = [
            'GENERATE_JD', 'MODIFY_JD', 'MODIFY_RESUME', 'CONFIRM_JD', 'SUBMIT_RESUME',
            'SCREEN_RESUMES', 'QUERY_PROGRESS', 'VIEW_DETAIL', 'FALLBACK',
          ];
          if (validIntents.includes(parsed.intent)) {
            this.tracer.completeTrace(traceId, JSON.stringify(parsed), undefined,
              { intent: parsed.intent, params: parsed.params });
            return parsed.intent;
          }
        }

        // LLM 返回了无效意图，降级到 FALLBACK
        this.tracer.completeTrace(traceId, 'fallback-to-rules', undefined, { fallback: true });
        return 'FALLBACK';
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AgentEngine] intent-router LLM failed:`, errorMsg);
        this.tracer.errorTrace(traceId, errorMsg);

        // LLM 出错 → 打开短路器
        if (errorMsg.includes('timeout') || errorMsg.includes('timed out') || errorMsg.includes('fetch')) {
          this.openLLMCircuit(`intent-router: ${errorMsg}`);
        }

        // 降级到 FALLBACK
        return 'FALLBACK';
      }
    }

    // 非 LLM 模式或规则匹配成功
    return 'FALLBACK';
  }

  /** 基于规则的意图识别（快速匹配） — 委托给独立模块以便测试 */
  private ruleBasedIntent(content: string): IntentType | null {
    return matchIntent(content, this.state);
  }

  // ============================================================
  // Agent 1: JD 生成（LLM 增强）
  // ============================================================
  private async handleGenerateJD(userMessage: string): Promise<AgentResponse> {
    const content = userMessage.replace(/@招聘助手|@招聘机器人|@recruit/gi, '').trim();

    // 信息不足检查
    if (content.length < 10 || /帮我招个人$/.test(content)) {
      return this.insufficientInfoResponse();
    }

    // LLM 模式
    if (this.isLLMAvailable()) {
      const traceId = this.tracer.startTrace('jd-generator', content.slice(0, 200),
        { conversationId: this.context.currentJobId || 'unknown' }, content);

      try {
        const result = await this.llm.complete({
          systemPrompt: '你是一个专业的招聘JD撰写专家。',
          messages: [{ role: 'user', content: getJDGeneratePrompt(content) }],
          temperature: 0.7,
          maxTokens: 2048,
        });

        const parsed = this.safeParseJSON(result);
        if (parsed?.title) {
          const jobId = `job_${Date.now()}`;
          const newJob: JobPosition = {
            id: jobId,
            title: parsed.title,
            department: parsed.department || '待确认',
            location: parsed.location || '待确认',
            reportTo: parsed.reportTo || '待确认',
            headcount: parsed.headcount || 2,
            responsibilities: parsed.responsibilities || ['待补充'],
            hardRequirements: parsed.hardRequirements || ['待补充'],
            bonusRequirements: parsed.bonusRequirements || ['待补充'],
            status: 'draft',
            createdAt: Date.now(),
            resumeCount: 0,
          };

          this.tracer.completeTrace(traceId, JSON.stringify(parsed), result);

          return {
            type: 'bot_card',
            content: parsed.summary ? `## 📋 ${parsed.summary}` : `## 📋 根据描述生成岗位JD`,
            cardType: 'jd',
            cardData: newJob,
            quickActions: [
              { label: '✅ 确认JD', action: 'CONFIRM_JD', primary: true },
              { label: '✏️ 修改JD', action: 'MODIFY_JD' },
            ],
            newState: 'JD_CONFIRMING',
            jobUpdate: newJob,
          };
        }

        // LLM 返回了非标准 JSON，降级到模拟模式
        this.tracer.completeTrace(traceId, 'fallback-to-mock', undefined, { fallback: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AgentEngine] jd-generator LLM failed:`, errorMsg);
        this.tracer.errorTrace(traceId, errorMsg);
        if (errorMsg.includes('timeout') || errorMsg.includes('timed out') || errorMsg.includes('fetch')) {
          this.openLLMCircuit(`jd-generator: ${errorMsg}`);
        }
      }
    }

    // 降级到本地模拟模式
    return this.mockGenerateJD(content);
  }

  /** 本地模拟 JD 生成 */
  private mockGenerateJD(content: string): AgentResponse {
    const jobTitle = this.extractJobTitle(content) || '待确认岗位';
    const skills = this.extractSkills(content);
    const department = this.extractDepartment(content) || '待确认';
    const location = this.extractLocation(content) || '待确认';

    const jobId = `job_${Date.now()}`;
    const newJob: JobPosition = {
      id: jobId,
      title: jobTitle,
      department,
      location,
      reportTo: '待确认',
      headcount: 2,
      responsibilities: [
        `负责${jobTitle}相关工作的执行与交付`,
        `参与团队技术方案的讨论与实施`,
        `编写相关技术文档和报告`,
      ],
      hardRequirements: [
        '本科及以上学历，相关专业',
        '3年以上相关工作经验',
        ...(skills.length > 0 ? [`熟练掌握 ${skills.slice(0, 3).join('、')}`] : []),
      ],
      bonusRequirements: [
        '有大型项目经验优先',
        '良好的沟通协作能力',
      ],
      status: 'draft',
      createdAt: Date.now(),
      resumeCount: 0,
    };

    return {
      type: 'bot_card',
      content: `## 📋 根据描述生成岗位JD`,
      cardType: 'jd',
      cardData: newJob,
      quickActions: [
        { label: '✅ 确认JD', action: 'CONFIRM_JD', primary: true },
        { label: '✏️ 修改JD', action: 'MODIFY_JD' },
      ],
      newState: 'JD_CONFIRMING',
      jobUpdate: newJob,
    };
  }

  private insufficientInfoResponse(): AgentResponse {
    return {
      type: 'bot_text',
      content: `🤔 信息有点少，能多告诉我一些吗？比如：
• 岗位名称是什么？
• 需要哪些核心技能？
• 是哪个团队在招人？`,
      quickActions: [
        { label: '👤 嵌入式软件工程师', action: 'JD_GENERATE:嵌入式软件工程师' },
        { label: '👤 数字IC设计工程师', action: 'JD_GENERATE:数字IC设计工程师' },
      ],
      newState: 'IDLE',
    };
  }

  // ============================================================
  // Agent 2: JD 修改（LLM 增强）
  // ============================================================
  private async handleModifyJD(userMessage: string): Promise<AgentResponse> {
    const content = userMessage.replace(/@招聘助手|@招聘机器人|@recruit/gi, '').trim();
    const currentJob = this.context.jobs.find(j => j.id === this.context.currentJobId);

    if (!currentJob) {
      return { type: 'bot_text', content: '⚠️ 未找到当前岗位，请先生成JD。', newState: this.state };
    }

    // LLM 模式：让 LLM 理解修改意图并更新整个 JD
    if (this.isLLMAvailable()) {
      const traceId = this.tracer.startTrace('jd-generator', content.slice(0, 200),
        { conversationId: this.context.currentJobId || 'unknown', subAction: 'modify' }, content);

      try {
        const result = await this.llm.complete({
          systemPrompt: '你是招聘JD修改专家。根据用户修改指令，返回更新后的完整JD JSON。只修改用户提到的部分，其他保持不变。',
          messages: [{
            role: 'user',
            content: `当前JD：\n${JSON.stringify(currentJob, null, 2)}\n\n用户修改指令：${content}\n\n返回更新后的完整JD JSON。`,
          }],
          temperature: 0.3,
          maxTokens: 2048,
        });

        const parsed = this.safeParseJSON(result);
        if (parsed?.title) {
          const updatedJob = { ...currentJob, ...parsed, modificationSummary: ['根据描述微调JD'] };
          this.tracer.completeTrace(traceId, JSON.stringify(parsed), result);

          return {
            type: 'bot_card',
            content: `## 📋 岗位JD（已更新）`,
            cardType: 'jd',
            cardData: updatedJob,
            quickActions: [
              { label: '✅ 确认JD', action: 'CONFIRM_JD', primary: true },
              { label: '✏️ 继续修改', action: 'MODIFY_JD' },
            ],
            newState: 'JD_CONFIRMING',
            jobUpdate: updatedJob,
          };
        }
        this.tracer.completeTrace(traceId, 'fallback-to-mock', undefined, { fallback: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AgentEngine] jd-modifier LLM failed:`, errorMsg);
        this.tracer.errorTrace(traceId, errorMsg);
        if (errorMsg.includes('timeout') || errorMsg.includes('timed out') || errorMsg.includes('fetch')) {
          this.openLLMCircuit(`jd-modifier: ${errorMsg}`);
        }
      }
    }

    // 降级到本地规则
    return this.mockModifyJD(content, currentJob);
  }

  private mockModifyJD(content: string, currentJob: JobPosition): AgentResponse {
    const updates: Partial<JobPosition> = {};
    const changes: string[] = [];

    const locMatch = content.match(/(?:地点|地址|城市)(?:改成|改为|换成|是)\s*(.+)/);
    if (locMatch) { updates.location = locMatch[1].trim(); changes.push(`工作地点 → ${updates.location}`); }

    const countMatch = content.match(/(\d+)\s*(?:人|个)/);
    if (countMatch) { updates.headcount = parseInt(countMatch[1]); changes.push(`招聘人数 → ${updates.headcount}人`); }

    const addMatch = content.match(/(?:加上|增加|新增|添加)(.+?)(?:要求|经验|技能|$)/);
    if (addMatch) {
      const newSkills = addMatch[1].trim().split(/[,，、]/).map(s => s.trim());
      updates.bonusRequirements = [...currentJob.bonusRequirements, ...newSkills];
      changes.push(`加分项新增: ${newSkills.join('、')}`);
    }

    const removeMatch = content.match(/(?:去掉|移除|删除|不要)(.+?)(?:要求|经验|技能|$)/);
    if (removeMatch) {
      const removeSkills = removeMatch[1].trim().split(/[,，、]/).map(s => s.trim());
      updates.bonusRequirements = currentJob.bonusRequirements.filter(
        s => !removeSkills.some(r => s.includes(r))
      );
      changes.push(`移除: ${removeSkills.join('、')}`);
    }

    const yearMatch = content.match(/(\d+)\s*(?:年|年经验|年工作)/);
    if (yearMatch) {
      const years = yearMatch[1];
      const updatedReqs = currentJob.hardRequirements.map(r =>
        r.includes('年') ? `${years}年以上相关工作经验` : r
      );
      if (!currentJob.hardRequirements.some(r => r.includes('年'))) {
        updatedReqs.unshift(`${years}年以上相关工作经验`);
      }
      updates.hardRequirements = updatedReqs;
      changes.push(`经验要求 → ${years}年以上`);
    }

    if (changes.length === 0) changes.push('根据描述微调JD措辞和表述');

    const updatedJob = { ...currentJob, ...updates };

    return {
      type: 'bot_card',
      content: `## 📋 岗位JD（已更新）`,
      cardType: 'jd',
      cardData: { ...updatedJob, modificationSummary: changes },
      quickActions: [
        { label: '✅ 确认JD', action: 'CONFIRM_JD', primary: true },
        { label: '✏️ 继续修改', action: 'MODIFY_JD' },
      ],
      newState: 'JD_CONFIRMING',
      jobUpdate: updatedJob,
    };
  }

  // ============================================================
  // Agent 2b: 简历字段修改（MODIFY_RESUME）
  // ============================================================
  private handleModifyResume(userMessage: string): AgentResponse {
    const content = userMessage.replace(/@招聘助手|@招聘机器人|@recruit/gi, '').trim();

    // 找到最近解析的简历
    const parsedResumes = this.context.parsedResumes || [];
    if (parsedResumes.length === 0) {
      return {
        type: 'bot_text',
        content: '⚠️ 当前没有已解析的简历，请先提交一份简历。',
        newState: this.state,
      };
    }

    const resume = { ...parsedResumes[parsedResumes.length - 1] };
    const changes: string[] = [];

    // ──── 解析修改指令 ────
    // 支持格式：修改XX：YY；XX改成YY；XX改为YY；修改XX为YY
    const patterns: [RegExp, keyof ParsedResume, (v: string) => unknown, string][] = [
      [/姓名[：:是为改]+\s*(.{2,4})/, 'name', (v: string) => v.trim(), '姓名'],
      [/年龄[：:是为改]+?\s*(\d+)/, 'age', (v: string) => parseInt(v), '年龄'],
      [/学历[：:是为改]+?\s*(博士|硕士|本科|大专|高中)/, 'degree', (v: string) => v.trim(), '学历'],
      [/学校[：:是为改]+?\s*(.+?)(?:[；;，,\n]|$)/, 'school', (v: string) => v.trim(), '学校'],
      [/专业[：:是为改]+?\s*(.+?)(?:[；;，,\n]|$)/, 'major', (v: string) => v.trim(), '专业'],
      [/工作年限[：:是为改]+?\s*(\d+)/, 'workYears', (v: string) => parseInt(v), '工作年限'],
      [/城市[：:是为改]+?\s*(.+?)(?:[；;，,\n]|$)/, 'city', (v: string) => v.trim(), '城市'],
      [/技能[：:是为改]+?\s*(.+?)(?:[；;，\n]|$)/, 'skills',
        (v: string) => v.split(/[,，、]/).map(s => s.trim()).filter(Boolean), '技能'],
    ];

    for (const [regex, field, parse, label] of patterns) {
      const match = content.match(regex);
      if (match) {
        const value = parse(match[1]);
        (resume as Record<string, unknown>)[field] = value;
        changes.push(`${label} → ${match[1].trim().slice(0, 20)}`);
      }
    }

    if (changes.length === 0) {
      return {
        type: 'bot_text',
        content: '⚠️ 未能识别有效的简历字段修改指令。\n\n支持修改的字段：姓名、年龄、学历、学校、专业、工作年限、城市、技能。\n\n示例：`修改姓名：张三；工作年限：5`',
        newState: this.state,
      };
    }

    // 更新 context 中的简历
    this.context.parsedResumes[parsedResumes.length - 1] = resume;

    return {
      type: 'bot_card',
      content: `## 📄 简历已更新\n\n已修改：${changes.join('、')}`,
      cardType: 'resume_parse',
      cardData: {
        resume,
        jobs: this.context.jobs,
        requirePositionSelection: !this.context.currentJobId || this.context.jobs.length === 0,
      },
      quickActions: [
        { label: '✏️ 继续修改', action: 'MODIFY_RESUME' },
      ],
      newState: this.state,
      resumeUpdate: resume,
    };
  }

  // ============================================================
  // Agent 3: JD 确认
  // ============================================================
  private async handleConfirmJD(): Promise<AgentResponse> {
    const currentJob = this.context.jobs.find(j => j.id === this.context.currentJobId);
    if (!currentJob) {
      return { type: 'bot_text', content: '⚠️ 未找到当前岗位，请先生成JD。', newState: this.state };
    }

    const updatedJob = { ...currentJob, status: 'active' as const };

    return {
      type: 'bot_text',
      content: `✅ JD已保存！岗位【${currentJob.title}】进入简历收集阶段。

📤 现在可以直接发送候选人的简历给我：
• 拖拽或点击 📎 发送 PDF/Word 文件
• 或直接粘贴简历文本

📌 收集满3份后可以让我帮你筛选评分。`,
      quickActions: [
        { label: '📎 发送简历文件', action: 'UPLOAD_RESUME', primary: true },
      ],
      newState: 'COLLECTING',
      jobUpdate: updatedJob,
    };
  }

  // ============================================================
  // Agent 4: 简历提交与解析（通过 ResumeParserAgent + Tool 管道）
  // ============================================================
  private async handleSubmitResume(userMessage: string): Promise<AgentResponse> {
    // ===== 诊断：记录输入 =====
    console.log('[AgentEngine.handleSubmitResume] === 通过 ResumeParserAgent 解析（文本粘贴）===');
    console.log('[AgentEngine.handleSubmitResume] 文本长度:', userMessage.length);
    console.log('[AgentEngine.handleSubmitResume] 前500字符预览:', userMessage.slice(0, 500));

    // 委托给 ResumeParserAgent — 与文件上传共用同一 Agent
    const agentCtx: ResumeParserContext = {
      state: this.state,
      currentJobId: this.context.currentJobId,
      jobs: this.context.jobs,
    };

    const agent = getResumeParserAgent({
      enabled: this.llmEnabled,
      apiKey: this.llm.getConfig().apiKey,
      baseUrl: this.llm.getConfig().baseUrl,
      model: this.llm.getConfig().model,
      timeout: this.llm.getConfig().timeout,
    });

    const result = await agent.run({ text: userMessage }, agentCtx);

    if (!result.isResume || !result.resume) {
      return result.response;
    }

    return this.buildResumeResponse(result.resume);
  }

  private buildResumeResponse(parsedResume: ParsedResume): AgentResponse {
    return {
      type: 'bot_card',
      content: `## 📄 简历解析完成`,
      cardType: 'resume_parse',
      cardData: {
        resume: parsedResume,
        jobs: this.context.jobs,
        requirePositionSelection: !this.context.currentJobId || this.context.jobs.length === 0,
      },
      quickActions: this.context.jobs.map(j => ({
        label: `🔗 关联到 ${j.title}`,
        action: `ASSIGN_RESUME:${parsedResume.id}:${j.id}`,
        primary: j.id === this.context.currentJobId,
      })),
      newState: this.state,
      resumeUpdate: parsedResume,
    };
  }

  // ============================================================
  // Agent 5: 筛选评分（LLM 增强）
  // ============================================================
  private async handleScreenResumes(): Promise<AgentResponse> {
    const resumes = this.context.parsedResumes;
    if (resumes.length < 3) {
      return { type: 'bot_text', content: INSUFFICIENT_RESUMES_RESPONSE(resumes.length), newState: this.state };
    }

    // LLM 模式
    if (this.isLLMAvailable()) {
      const currentJob = this.context.jobs.find(j => j.id === this.context.currentJobId);
      const jobTitle = currentJob?.title || '当前岗位';
      const requirements = currentJob?.hardRequirements || [];
      const resumesText = resumes.map(r =>
        `【${r.name}】${r.degree} | ${r.school} | ${r.major} | ${r.workYears}年经验 | 技能：${r.skills.join('、')} | 经历：${r.experiences.map(e => `${e.role}@${e.company}(${e.period})`).join('；')}`
      ).join('\n---\n');

      const traceId = this.tracer.startTrace('screening-scorer',
        `${resumes.length} candidates for ${jobTitle}`,
        { conversationId: this.context.currentJobId || 'unknown', candidateCount: String(resumes.length) });

      try {
        const result = await this.llm.complete({
          systemPrompt: '你是专业的招聘筛选评分专家。',
          messages: [{ role: 'user', content: getScreeningPrompt(jobTitle, requirements, resumesText) }],
          temperature: 0.3,
          maxTokens: 4096,
        });

        const parsed = this.safeParseJSON(result);
        if (parsed?.candidates && parsed.candidates.length > 0) {
          const topCandidates = parsed.candidates.slice(0, 5).map((c: CandidateScore & { name: string }, i: number) => ({
            ...c,
            resumeId: resumes[i]?.id || '',
            candidateName: c.name,
            rank: i + 1,
          }));

          this.tracer.completeTrace(traceId, JSON.stringify({ topCount: topCandidates.length, recommendedCount: parsed.recommendedCount }), result);

          return {
            type: 'bot_card',
            content: parsed.summary ? `## 🌟 ${parsed.summary}` : `## 🌟 筛选报告`,
            cardType: 'screening_report',
            cardData: {
              jobTitle,
              totalResumes: resumes.length,
              scoredResumes: resumes.length,
              recommendedCount: parsed.recommendedCount || topCandidates.length,
              topCandidates,
              averageScore: Math.round(topCandidates.reduce((sum: number, c: { totalScore: number }) => sum + c.totalScore, 0) / topCandidates.length),
              generatedAt: Date.now(),
            },
            quickActions: topCandidates.slice(0, 3).map((c: { candidateName: string; resumeId: string }) => ({
              label: `👤 查看 ${c.candidateName} 详情`,
              action: `VIEW_DETAIL:${c.resumeId}`,
            })),
            newState: 'SCREENING_RESULT',
          };
        }
        this.tracer.completeTrace(traceId, 'fallback-to-mock', undefined, { fallback: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AgentEngine] screening-scorer LLM failed:`, errorMsg);
        this.tracer.errorTrace(traceId, errorMsg);
        if (errorMsg.includes('timeout') || errorMsg.includes('timed out') || errorMsg.includes('fetch')) {
          this.openLLMCircuit(`screening-scorer: ${errorMsg}`);
        }
      }
    }

    // 降级到本地模拟
    const scored = this.mockScreening(resumes);
    return {
      type: 'bot_card',
      content: `## 🌟 筛选报告`,
      cardType: 'screening_report',
      cardData: {
        jobTitle: this.context.jobs.find(j => j.id === this.context.currentJobId)?.title || '当前岗位',
        ...scored,
      },
      quickActions: scored.topCandidates.slice(0, 3).map(c => ({
        label: `👤 查看 ${c.candidateName} 详情`,
        action: `VIEW_DETAIL:${c.resumeId}`,
      })),
      newState: 'SCREENING_RESULT',
    };
  }

  // ============================================================
  // Agent 6: 进度查询（LLM 增强）
  // ============================================================
  private async handleQueryProgress(): Promise<AgentResponse> {
    const currentJob = this.context.jobs.find(j => j.id === this.context.currentJobId);
    if (!currentJob) {
      return { type: 'bot_text', content: NO_ACTIVE_JOB_RESPONSE, newState: this.state };
    }

    const jobResumes = this.context.parsedResumes.filter(r => r.jobId === currentJob.id);

    // LLM 模式：让 LLM 生成更智能的下一步建议
    if (this.isLLMAvailable()) {
      const traceId = this.tracer.startTrace('progress-tracker', `Query progress for ${currentJob.title}`,
        { conversationId: this.context.currentJobId || 'unknown' });

      try {
        const contextSummary = `岗位：${currentJob.title} | 状态：${this.state} | 简历数：${jobResumes.length} | JD状态：${currentJob.status} | 已筛选：${this.state === 'SCREENING_RESULT'}`;
        const result = await this.llm.complete({
          systemPrompt: '你是招聘进度管理专家。',
          messages: [{ role: 'user', content: getProgressPrompt(contextSummary) }],
          temperature: 0.3,
          maxTokens: 512,
        });

        const parsed = this.safeParseJSON(result);
        if (parsed?.nextAction) {
          this.tracer.completeTrace(traceId, JSON.stringify(parsed), result);
          return this.buildProgressResponse(currentJob, jobResumes.length, parsed.nextAction, parsed.actionLabel, parsed.actionType);
        }
        this.tracer.completeTrace(traceId, 'fallback-to-default', undefined, { fallback: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AgentEngine] progress-tracker LLM failed:`, errorMsg);
        this.tracer.errorTrace(traceId, errorMsg);
        if (errorMsg.includes('timeout') || errorMsg.includes('timed out') || errorMsg.includes('fetch')) {
          this.openLLMCircuit(`progress-tracker: ${errorMsg}`);
        }
      }
    }

    // 默认进度响应
    const resumeCount = jobResumes.length;
    const hasScreening = this.state === 'SCREENING_RESULT';
    const nextAction = resumeCount >= 3 && !hasScreening
      ? '📤 已收集3份以上简历，可以触发筛选评分'
      : hasScreening
        ? '✅ 筛选已完成，回复"查看 [姓名] 详情"看评分明细'
        : '📤 继续发送简历';
    const actionLabel = resumeCount >= 3 && !hasScreening ? '开始筛选评分' : '发送简历';
    const actionType = resumeCount >= 3 && !hasScreening ? 'SCREEN_RESUMES' : 'UPLOAD_RESUME';

    return this.buildProgressResponse(currentJob, resumeCount, nextAction, actionLabel, actionType);
  }

  private buildProgressResponse(
    currentJob: JobPosition, resumeCount: number,
    nextAction: string, actionLabel: string, actionType: string,
  ): AgentResponse {
    const stateMap: Record<ConversationState, string> = {
      IDLE: '🟡 待启动', JD_GENERATING: '⏳ JD生成中', JD_CONFIRMING: '📋 待确认JD',
      COLLECTING: '📥 简历收集中', SCREENING: '⏳ 筛选中', SCREENING_RESULT: '✅ 筛选完成',
    };

    const hasScreening = this.state === 'SCREENING_RESULT';
    const scoredCount = resumeCount;
    const recommendedCount = hasScreening ? Math.min(3, resumeCount) : 0;

    return {
      type: 'bot_card',
      content: `## 📊 招聘进度`,
      cardType: 'progress',
      cardData: {
        jobTitle: currentJob.title,
        state: stateMap[this.state],
        jdGenerated: true,
        jdConfirmed: currentJob.status === 'active',
        resumeCount,
        parsedCount: resumeCount,
        scoredCount: hasScreening ? scoredCount : 0,
        recommendedCount,
        lastOperation: hasScreening ? 'AI筛选评分完成' : '简历收集中',
        lastOperator: '杨经理 (HR)',
        lastOperatedAt: Date.now(),
        nextAction,
      },
      quickActions: actionType !== 'NONE' ? [{ label: actionLabel, action: actionType, primary: true }] : [],
      newState: this.state,
    };
  }

  // ============================================================
  // Agent 7: 候选人详情（LLM 增强）
  // ============================================================
  private async handleViewDetail(userMessage: string): Promise<AgentResponse> {
    const content = userMessage.replace(/@招聘助手|@招聘机器人|@recruit/gi, '').trim();
    const nameMatch = content.match(/查看\s*(.+?)\s*(的)?(详情|评分)/);
    const name = nameMatch ? nameMatch[1].trim() : content.trim();

    const resume = this.context.parsedResumes.find(r => r.name === name);
    if (!resume) {
      return { type: 'bot_text', content: `⚠️ 未找到 ${name} 的简历信息。请确认姓名是否正确。`, newState: this.state };
    }

    const currentJob = this.context.jobs.find(j => j.id === this.context.currentJobId);
    const jobTitle = currentJob?.title || '当前岗位';

    // LLM 模式
    if (this.isLLMAvailable()) {
      const traceId = this.tracer.startTrace('progress-tracker', `Detail for ${name}`,
        { conversationId: this.context.currentJobId || 'unknown', subAction: 'detail' });

      try {
        const candidateInfo = `姓名：${resume.name} | 学历：${resume.degree} | 学校：${resume.school} | 专业：${resume.major} | 工作年限：${resume.workYears}年 | 城市：${resume.city} | 技能：${resume.skills.join('、')} | 经历：${resume.experiences.map(e => `${e.role}@${e.company}(${e.period})`).join('；')}`;

        const result = await this.llm.complete({
          systemPrompt: '你是专业的候选人评估专家。',
          messages: [{ role: 'user', content: getDetailPrompt(candidateInfo, jobTitle) }],
          temperature: 0.4,
          maxTokens: 2048,
        });

        const parsed = this.safeParseJSON(result);
        if (parsed?.dimensions && parsed.dimensions.length === 5) {
          this.tracer.completeTrace(traceId, JSON.stringify({ totalScore: parsed.totalScore, recommendationLevel: parsed.recommendationLevel }), result);

          return {
            type: 'bot_card',
            content: `## 🔍 ${name} — 评分明细`,
            cardType: 'detail',
            cardData: {
              candidateName: name,
              totalScore: parsed.totalScore,
              dimensions: parsed.dimensions,
              matchedKeywords: resume.skills.join(', '),
              gaps: parsed.dimensions.flatMap((d: { gaps: string[] }) => d.gaps).join('；') || '无显著差距',
              summary: parsed.summary || `${resume.workYears}年${resume.major}经验，${resume.degree}学历`,
            },
            newState: this.state,
          };
        }
        this.tracer.completeTrace(traceId, 'fallback-to-mock', undefined, { fallback: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AgentEngine] view-detail LLM failed:`, errorMsg);
        this.tracer.errorTrace(traceId, errorMsg);
        if (errorMsg.includes('timeout') || errorMsg.includes('timed out') || errorMsg.includes('fetch')) {
          this.openLLMCircuit(`view-detail: ${errorMsg}`);
        }
      }
    }

    // 降级到本地模拟
    return this.mockDetailResponse(name, resume);
  }

  private mockDetailResponse(name: string, resume: ParsedResume): AgentResponse {
    const dimensions = [
      { name: '技能匹配度', score: 18, maxScore: 20, reason: `核心技能与JD要求匹配度较高`, matchedKeywords: resume.skills.slice(0, 4), gaps: [] },
      { name: '经验匹配度', score: 17, maxScore: 20, reason: `${resume.workYears}年工作经验，行业背景相关`, matchedKeywords: [], gaps: [] },
      { name: '学历匹配度', score: resume.degree === '博士' ? 19 : resume.degree === '硕士' ? 17 : 13, maxScore: 20, reason: `${resume.degree}学历，${resume.major}专业`, matchedKeywords: [resume.degree, resume.major], gaps: [] },
      { name: '项目匹配度', score: 16, maxScore: 20, reason: '项目经验与岗位需求有一定匹配度', matchedKeywords: [], gaps: [] },
      { name: '稳定性', score: 16, maxScore: 20, reason: '平均在职时长合理，无明显频繁跳槽', matchedKeywords: [], gaps: [] },
    ];

    const totalScore = dimensions.reduce((sum, d) => sum + d.score, 0);

    return {
      type: 'bot_card',
      content: `## 🔍 ${name} — 评分明细`,
      cardType: 'detail',
      cardData: {
        candidateName: name,
        totalScore,
        dimensions,
        matchedKeywords: resume.skills.join(', '),
        gaps: '无显著差距',
        summary: `${resume.workYears}年${resume.major}经验，${resume.degree}学历，技能匹配度较高`,
      },
      newState: this.state,
    };
  }

  // ============================================================
  // Fallback
  // ============================================================
  private async handleFallback(): Promise<AgentResponse> {
    return { type: 'bot_text', content: FALLBACK_RESPONSE, newState: this.state };
  }

  // ============================================================
  // 辅助方法
  // ============================================================
  /**
   * 安全解析 JSON — 支持多种 LLM 返回格式
   *
   * LLM 可能返回：
   * 1. ` + "`" + ` + "`" + `json\n{...}\n` + "`" + ` + "`" + `` + `
   * 2. 纯 JSON 本身
   * 3. JSON 前后有解释文字
   * 4. JSON 含常见语法错误（尾逗号、中文引号、单引号）
   * 5. 嵌套 JSON 对象（需要括号平衡而非贪婪正则）
   */
  private safeParseJSON(text: string): Record<string, unknown> | null {
    if (!text || text.trim().length === 0) {
      console.warn('[safeParseJSON] 输入为空');
      return null;
    }

    // 策略1：提取 markdown 代码块
    const codeBlockMatch = text.match(/` + "`" + `(?:json)?\\s*([\\s\\S]*?)` + "`" + `/);
    const candidate = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

    // 策略2：用括号平衡算法精确提取最外层 JSON 对象
    const jsonBlock = this.extractBalancedJSON(candidate);

    if (!jsonBlock) {
      console.warn('[safeParseJSON] 未找到有效的 JSON 块，原始文本前200字符:', text.slice(0, 200));
      return null;
    }

    // 策略3：尝试直接解析
    try {
      return JSON.parse(jsonBlock) as Record<string, unknown>;
    } catch (err) {
      // 策略4：修复常见 JSON 语法错误后重试
      try {
        const fixed = this.fixCommonJSONErrors(jsonBlock);
        if (fixed !== jsonBlock) {
          console.log('[safeParseJSON] 原始 JSON 有语法错误，尝试修复...');
          return JSON.parse(fixed) as Record<string, unknown>;
        }
      } catch {
        // 修复也失败，继续输出诊断
      }

      console.error('[safeParseJSON] JSON 解析失败！');
      console.error('[safeParseJSON] 错误:', (err as Error).message);
      console.error('[safeParseJSON] JSON 前200字符:', jsonBlock.slice(0, 200));
      console.error('[safeParseJSON] JSON 末200字符:', jsonBlock.slice(-200));
      return null;
    }
  }

  /**
   * 用括号平衡算法提取最外层 { } 包裹的有效 JSON
   * 替代贪婪正则 /\{[\s\S]*\}/（会错误匹配非 JSON 文本）
   */
  private extractBalancedJSON(text: string): string | null {
    // 找到第一个 {
    const startIdx = text.indexOf('{');
    if (startIdx === -1) return null;

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (ch === '\\' && inString) {
        escapeNext = true;
        continue;
      }

      if (ch === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          // 找到最外层配对的 }
          return text.slice(startIdx, i + 1);
        }
      }
    }

    // 没有找到配对的大括号
    console.warn('[extractBalancedJSON] 括号未配对！起始位置:', startIdx, '文本长度:', text.length);
    return null;
  }

  /**
   * 修复 LLM 输出中常见的 JSON 语法错误
   * - 尾随逗号
   * - 中文引号 "" '' 
   * - 单引号字符串
   * - 没有引号的 key
   */
  private fixCommonJSONErrors(json: string): string {
    let fixed = json;

    // 1. 移除尾随逗号（array/object 中的最后一个元素后面的逗号）
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

    // 2. 中文引号替换
    fixed = fixed.replace(/[\u201c\u201d]/g, '"');  // " "
    fixed = fixed.replace(/[\u2018\u2019]/g, "'");  // ' '

    // 3. 修复中文冒号
    fixed = fixed.replace(/\uFF1A/g, ':');  // ：→ :

    // 4. 修复常见的中文逗号（JSON key/value 中不应出现，但 value 字符串中可能有）
    //    只在 JSON 结构位置修复（key 后面、value 分隔）
    fixed = fixed.replace(/,\s*(\n\s*[}\]])/g, '$1');

    return fixed;
  }

  private extractJobTitle(text: string): string | null {
    const patterns = [
      /(?:招|招聘|需要)\s*(?:一个|一名)\s*(.+?)(?:，|,|工程师|岗位|$)/,
      /(?:帮我招|帮我招聘)\s*(?:一个|一名)?\s*(.+?)(?:，|,|负责|需要|$)/,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        let title = m[1].trim();
        if (title.length < 15 && !title.includes('负责')) {
          if (!title.includes('工程师')) title += '工程师';
          return title;
        }
      }
    }
    return null;
  }

  private extractSkills(text: string): string[] {
    const knownSkills = [
      'SystemVerilog', 'UVM', 'Python', 'C++', 'Java', 'Verilog', 'VHDL',
      'FPGA', 'SoC', 'DFT', '芯片验证', '覆盖率分析', '回归测试',
      'Perl', 'Tcl', 'Shell', 'Linux', '嵌入式', 'Docker', 'Kubernetes',
      'React', 'Vue', 'Node.js', 'TypeScript', 'Go', 'Rust', 'AI',
    ];
    return knownSkills.filter(s => text.toLowerCase().includes(s.toLowerCase()));
  }

  private extractDepartment(text: string): string | null {
    const m = text.match(/(?:芯片|软件|硬件|验证|设计|测试|系统|算法|前端|后端|数据)\s*(?:组|团队|部门)/);
    return m ? m[0] : null;
  }

  private extractLocation(text: string): string | null {
    const cities = ['北京', '上海', '深圳', '广州', '杭州', '成都', '南京', '武汉', '西安', '长沙'];
    for (const c of cities) { if (text.includes(c)) return c; }
    return null;
  }


  private mockScreening(resumes: ParsedResume[]) {
    const scored = resumes.map((r, i) => {
      const baseScore = 75 - i * 5 + Math.floor(Math.random() * 8);
      const totalScore = Math.min(98, Math.max(60, baseScore));
      return {
        resumeId: r.id, candidateName: r.name, totalScore,
        dimensions: [
          { name: '技能匹配度', score: Math.min(20, 15 + Math.floor(Math.random() * 5)), maxScore: 20, reason: '技能匹配度较高', matchedKeywords: r.skills.slice(0, 3), gaps: [] as string[] },
          { name: '经验匹配度', score: Math.min(20, 14 + Math.floor(Math.random() * 5)), maxScore: 20, reason: `${r.workYears}年相关经验`, matchedKeywords: [] as string[], gaps: [] as string[] },
          { name: '学历匹配度', score: r.degree === '博士' ? 19 : r.degree === '硕士' ? 17 : 13, maxScore: 20, reason: `${r.degree}学历`, matchedKeywords: [r.degree], gaps: [] as string[] },
          { name: '项目匹配度', score: Math.min(20, 15 + Math.floor(Math.random() * 5)), maxScore: 20, reason: '项目经验丰富', matchedKeywords: [] as string[], gaps: [] as string[] },
          { name: '稳定性', score: Math.min(20, 15 + Math.floor(Math.random() * 5)), maxScore: 20, reason: '在职稳定', matchedKeywords: [] as string[], gaps: [] as string[] },
        ],
        highlight: `${r.workYears}年${r.major}经验，${r.degree}学历`,
        rank: 0,
      };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);
    scored.forEach((s, i) => { s.rank = i + 1; });

    const recommendedCount = scored.filter(s => s.totalScore >= 75).length;
    return {
      totalResumes: resumes.length, scoredResumes: resumes.length, recommendedCount,
      topCandidates: scored.slice(0, 3),
      averageScore: Math.round(scored.reduce((sum, s) => sum + s.totalScore, 0) / scored.length),
      generatedAt: Date.now(),
    };
  }
}

// ============================================================
// 单例工厂
// ============================================================
let engineInstance: RecruitmentAgentEngine | null = null;

export function getAgentEngine(config?: Partial<LLMConfig>): RecruitmentAgentEngine {
  if (!engineInstance) {
    engineInstance = new RecruitmentAgentEngine(config);
  }
  if (config) {
    engineInstance.updateLLMConfig(config);
  }
  return engineInstance;
}

export function resetAgentEngine(): void {
  engineInstance = null;
}
