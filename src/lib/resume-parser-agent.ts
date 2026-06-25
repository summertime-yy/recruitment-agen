/* ============================================================
   Resume Parser Agent — 简历解析智能体

   职责：
     1. 接收简历文件（File）或文本（string）
     2. 编排 Tool 调用管道：文档解析 → 信号检测 → LLM/本地规则提取
     3. 通过 Tracer 记录完整的 Agent + Tool 调用链路
     4. 返回结构化 ParsedResume 结果

   设计原则：
     - LLM 可用时优先用 LLM，但不受 LLM 不可达阻塞
     - 每个 Tool 调用独立追踪，Dashboard 可观测
     - 文本/文件统一入口，Agent 内部判断路径
   ============================================================ */

import type {
  ParsedResume, AgentResponse, JobPosition, ConversationContext, ConversationState,
} from '../types';
import type { LLMConfig } from './llm-client';
import {
  getAgentTracer, type AgentTracer, type AgentName,
} from './agent-tracer';
import {
  getDocumentParserTool, getLLMResumeParserTool, getLocalRuleParserTool,
  getVisionStructuredParserTool,
  type ParsedResumeFields,
} from './agent-tools';
import { NON_RESUME_RESPONSE } from '../agents/resume-parser';

/** 计算 ParsedResume 中缺失的关键字段 */
function computeMissingFields(resume: { name: string; degree: string; school: string; major: string; workYears: number; skills: string[]; experiences: unknown[] }): string[] {
  const missing: string[] = [];
  if (!resume.name) missing.push('姓名');
  if (!resume.degree) missing.push('学历');
  if (!resume.school) missing.push('院校');
  if (!resume.major) missing.push('专业');
  if (!resume.workYears && resume.experiences.length === 0) missing.push('工作年限');
  if (resume.skills.length === 0) missing.push('技能');
  return missing;
}

// ============================================================
// Agent 调用上下文
// ============================================================

export interface ResumeParserContext {
  /** 当前对话状态 */
  state: ConversationState;
  /** 当前岗位 ID */
  currentJobId: string | null;
  /** 已有岗位列表 */
  jobs: JobPosition[];
}

/** 文档元数据 — 从 DocumentParser 传递来的原始信息 */
export interface DocumentMeta {
  /** 解析来源 */
  source: 'txt' | 'docx' | 'pdf_text' | 'pdf_scanned';
  /** 文件名 */
  fileName: string;
  /** 总字符数（截断前） */
  textLength: number;
  /** 总页数 */
  pageCount?: number;
  /** 是否为扫描版 */
  isScanned?: boolean;
}

export interface ResumeParserInput {
  /** 文件对象（用户上传的 PDF/DOCX/TXT）*/
  file?: File;
  /** 文本内容（直接粘贴的简历文本）*/
  text?: string;
  /** 文档元数据（文件上传时传递，影响解析策略） */
  documentMeta?: DocumentMeta;
}

/** Agent 执行结果 */
export interface ResumeParserResult {
  /** 是否成功解析为有效简历 */
  isResume: boolean;
  /** 解析出的结构化简历（isResume=true 时有效）*/
  resume?: ParsedResume;
  /** 响应对象（可直接渲染到聊天界面） */
  response: AgentResponse;
  /** 执行的 Tool 调用链路摘要 */
  toolTraces: Array<{ toolName: string; success: boolean; duration?: number; error?: string }>;
}

// ============================================================
// Resume Parser Agent
// ============================================================

export class ResumeParserAgent {
  readonly name = 'resume-parser';
  readonly agentName: AgentName = 'resume-parser';

  private tracer: AgentTracer;
  private llmConfig?: Partial<LLMConfig>;

  constructor(llmConfig?: Partial<LLMConfig>) {
    this.tracer = getAgentTracer();
    this.llmConfig = llmConfig;
  }

  /**
   * 执行简历解析
   *
   * 管道流程：
   *   1. [DocumentParser Tool] 文件 → 纯文本
   *   2. [LocalRuleParser Tool] 信号检测 — 判断是否为简历
   *   3a. [LLMResumeParser Tool] LLM 提取（如果可用）
   *   3b. [LocalRuleParser Tool] 本地规则提取（降级路径）
   *   4. 组装 ParsedResume + AgentResponse
   */
  async run(input: ResumeParserInput, context: ResumeParserContext): Promise<ResumeParserResult> {
    const agentTraceId = this.tracer.startTrace(
      this.agentName,
      input.file
        ? `file-upload: ${input.file.name} (${this.formatSize(input.file.size)})`
        : `text-input: ${(input.text || '').slice(0, 100)}`,
      {
        conversationId: context.currentJobId || 'unknown',
        state: context.state,
        inputType: input.file ? 'file' : 'text',
      },
    );

    const toolTraces: ResumeParserResult['toolTraces'] = [];
    const startTime = Date.now();

    try {
      // ============================================================
      // Step 1: 文档解析（仅文件输入）
      // ============================================================
      let resumeText: string;
      let fileName: string | undefined;

      if (input.file) {
        fileName = input.file.name;
        const docParser = getDocumentParserTool();
        const docResult = await docParser.execute({ file: input.file });

        toolTraces.push({
          toolName: docParser.name,
          success: docResult.success,
          duration: docResult.duration,
          error: docResult.error,
        });

        if (!docResult.success) {
          this.tracer.errorTrace(agentTraceId, `[document-parser] ${docResult.error}`);
          return {
            isResume: false,
            response: {
              type: 'bot_text',
              content: `❌ 文件解析失败：${docResult.error}\n\n请确认文件未损坏，或尝试粘贴简历文本。`,
              newState: context.state,
            },
            toolTraces,
          };
        }

        resumeText = docResult.data!.text;

        // 从 DocumentParser 结果构建元数据
        input.documentMeta = {
          source: docResult.data!.source,
          fileName: docResult.data!.fileName,
          textLength: docResult.data!.text.length,
          pageCount: docResult.data!.pageCount,
          isScanned: docResult.data!.isScanned,
        };

        console.log(`[ResumeParserAgent] 文档解析完成: ${docResult.data!.source} | ${resumeText.length} 字符 | 扫描版: ${docResult.data!.isScanned} | ${docResult.data!.pageCount}页`);
      } else if (input.text) {
        resumeText = input.text;
        fileName = '粘贴文本';
        // 粘贴文本标记来源（用于本地规则调整策略）
        input.documentMeta = { source: 'txt', fileName: '粘贴文本', textLength: input.text.length };
      } else {
        this.tracer.errorTrace(agentTraceId, 'no-input');
        return {
          isResume: false,
          response: {
            type: 'bot_text',
            content: '⚠️ 未收到简历内容，请重新上传或粘贴。',
            newState: context.state,
          },
          toolTraces: [],
        };
      }

      // ===== 根据文档来源类型调整 LLM 调用策略 =====
      const docMeta = input.documentMeta;
      const isPdfText = docMeta?.source === 'pdf_text';
      const isDocx = docMeta?.source === 'docx';
      const sourceHint = isPdfText ? 'pdf_text' : isDocx ? 'docx' : docMeta?.source ?? 'txt';

      // ============================================================
      // Step 2: 判断 LLM 是否可用
      // ============================================================
      const llmAvailable = this.llmConfig?.enabled && !!this.llmConfig?.apiKey && !this.isLLMCircuitOpen();

      // ============================================================
      // Step 3: 简历解析 — 三路径策略
      //   3a. 扫描版 PDF → VisionStructuredParser（键值对直接映射）
      //   3b. 常规文本 + LLM 可用 → LLMResumeParser（Few-shot prompt）
      //   3c. LLM 不可用 → LocalRuleParser（正则+启发式）
      // ============================================================
      let parsedFields: ParsedResumeFields | null = null;

      // === 路径 A: 扫描版 PDF — 用 Vision 结构化解析（不调 LLM） ===
      if (docMeta?.source === 'pdf_scanned') {
        console.log('[ResumeParserAgent] 扫描版 PDF → 使用 Vision 结构化解析路径');
        const visionTool = getVisionStructuredParserTool();
        const visionResult = await visionTool.execute({ visionText: resumeText, fileName });

        toolTraces.push({
          toolName: visionTool.name,
          success: visionResult.success,
          duration: visionResult.duration,
          error: visionResult.error,
        });

        if (visionResult.success && visionResult.data) {
          parsedFields = visionResult.data;
          console.log('[ResumeParserAgent] Vision 结构化解析完成:', parsedFields.name);
        } else {
          console.warn('[ResumeParserAgent] Vision 解析失败，降级到本地规则');
          // 降级继续 — parsedFields 仍为 null，会走路径 C
        }
      }

      // === 路径 B: 常规文本 — LLM 解析 ===
      if (!parsedFields && llmAvailable) {
        console.log(`[ResumeParserAgent] 尝试 LLM 简历解析 (来源: ${sourceHint})...`);
        const llmTool = getLLMResumeParserTool(this.llmConfig);
        const llmResult = await llmTool.execute({ resumeText, fileName, sourceHint });

        toolTraces.push({
          toolName: llmTool.name,
          success: llmResult.success,
          duration: llmResult.duration,
          error: llmResult.error,
        });

        if (llmResult.success && llmResult.data?.isResume) {
          parsedFields = llmResult.data;
          console.log('[ResumeParserAgent] LLM 解析成功:', parsedFields.name);
        } else if (llmResult.error) {
          console.warn('[ResumeParserAgent] LLM 解析失败，降级到本地规则:', llmResult.error);
          // 打开短路器
          if (llmResult.error.includes('timeout') || llmResult.error.includes('timed out') || llmResult.error.includes('fetch')) {
            this.openLLMCircuit(`LLM 超时: ${llmResult.error}`);
          }
        } else if (llmResult.data?.isResume === false) {
          // LLM 判定非简历
          console.log('[ResumeParserAgent] LLM 判定非简历内容');
          parsedFields = llmResult.data;  // isResume: false
        }
      }

      // ============================================================
      // 降级/融合到本地规则
      //   - LLM 成功 (= parsedFields 有值) → 调用本地规则做「融合」：LLM 空字段用本地规则补
      //   - LLM 失败 (= parsedFields 为 null) → 纯本地规则
      //   融合策略：接收 LLM 提取的字段作为 llmFields 入参，execute 内部做优先级判断
      // ============================================================
      if (!parsedFields || parsedFields.isResume) {
        const mergeTag = parsedFields ? 'fuse-with-llm' : 'pure-local';
        console.log(`[ResumeParserAgent] 本地规则解析 (${mergeTag}, 来源: ${sourceHint})...`);
        const localTool = getLocalRuleParserTool();
        const localResult = await localTool.execute({
          resumeText,
          sourceHint,
          llmFields: parsedFields || undefined,
          fileName,
        });

        toolTraces.push({
          toolName: localTool.name,
          success: localResult.success,
          duration: localResult.duration,
          error: localResult.error,
        });

        if (localResult.success && localResult.data) {
          parsedFields = localResult.data;
          console.log('[ResumeParserAgent] 解析完成:', parsedFields.name || '(无姓名)',
            '| 置信度:', parsedFields.confidence,
            '| 字段来源:', JSON.stringify(parsedFields.fieldConfidences));
        } else if (!parsedFields) {
          // LLM 也失败了，本地规则也失败了 → 致命错误
          this.tracer.errorTrace(agentTraceId, `[local-rule-parser] ${localResult.error || 'unknown error'}`);
          return {
            isResume: false,
            response: {
              type: 'bot_text',
              content: `❌ 简历解析失败：${localResult.error || '未知错误'}\n\n💡 请尝试粘贴简历文本到输入框。`,
              newState: context.state,
            },
            toolTraces,
          };
        }
      }

      // ============================================================
      // Step 4: 组装结果
      // ============================================================
      if (!parsedFields.isResume) {
        this.tracer.completeTrace(agentTraceId, 'not-a-resume', undefined,
          { isResume: false, toolTraces });
        return {
          isResume: false,
          response: { type: 'bot_text', content: NON_RESUME_RESPONSE, newState: context.state },
          toolTraces,
        };
      }

      // 计算缺失字段（必须在构造 ParsedResume 之前，避免 TDZ 错误）
      const missingFields = computeMissingFields({
        name: parsedFields.name || '',
        degree: parsedFields.degree || '',
        school: parsedFields.school || '',
        major: parsedFields.major || '',
        workYears: parsedFields.workYears || 0,
        skills: parsedFields.skills || [],
        experiences: parsedFields.experiences || [],
      });

      // 构造 ParsedResume
      const resumeId = `res_${Date.now()}`;
      const parsedResume: ParsedResume = {
        id: resumeId,
        jobId: context.currentJobId || '',
        name: parsedFields.name || '',
        degree: parsedFields.degree || '',
        school: parsedFields.school || '',
        major: parsedFields.major || '',
        workYears: parsedFields.workYears || 0,
        city: parsedFields.city || '',
        experiences: parsedFields.experiences || [],
        skills: parsedFields.skills || [],
        confidence: parsedFields.confidence || 'medium',
        parsedAt: Date.now(),
        fileName: fileName || '简历内容',
        age: parsedFields.age,
        missingFields,
        // v1.4: 附带原始文本和文件类型用于前端对照核查
        originalText: resumeText,
        sourceFileType: docMeta?.source === 'pdf_text' || docMeta?.source === 'pdf_scanned' ? 'pdf'
          : docMeta?.source === 'docx' ? 'word'
          : 'txt',
      };

      // 构造 AgentResponse
      const response: AgentResponse = {
        type: 'bot_card',
        content: '## 📄 简历解析完成',
        cardType: 'resume_parse',
        cardData: {
          resume: parsedResume,
          jobs: context.jobs,
          requirePositionSelection: !context.currentJobId || context.jobs.length === 0,
        },
        quickActions: context.jobs.map(j => ({
          label: `🔗 关联到 ${j.title}`,
          action: `ASSIGN_RESUME:${parsedResume.id}:${j.id}`,
          primary: j.id === context.currentJobId,
        })),
        newState: context.state,
        resumeUpdate: parsedResume,
      };

      const duration = Date.now() - startTime;
      this.tracer.completeTrace(agentTraceId, JSON.stringify(parsedFields), undefined,
        { name: parsedResume.name, confidence: parsedResume.confidence, duration, toolTraces });

      console.log(`[ResumeParserAgent] ✅ 解析完成 | 姓名: ${parsedResume.name} | 学历: ${parsedResume.degree} | 学校: ${parsedResume.school} | 耗时: ${duration}ms`);

      return { isResume: true, resume: parsedResume, response, toolTraces };

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[ResumeParserAgent] 未捕获异常:', errorMsg);
      this.tracer.errorTrace(agentTraceId, errorMsg);

      return {
        isResume: false,
        response: {
          type: 'bot_text',
          content: `❌ 简历解析异常：${errorMsg}\n\n💡 请重试或粘贴简历文本到输入框。`,
          newState: context.state,
        },
        toolTraces,
      };
    }
  }

  // ============================================================
  // LLM 短路器
  // ============================================================
  private llmCircuitOpen: boolean = false;
  private llmCircuitUntil: number = 0;

  private isLLMCircuitOpen(): boolean {
    if (this.llmCircuitOpen) {
      if (Date.now() < this.llmCircuitUntil) return true;
      this.llmCircuitOpen = false;
      console.log('[ResumeParserAgent] LLM 短路器已重置');
    }
    return false;
  }

  private openLLMCircuit(reason: string) {
    console.warn(`[ResumeParserAgent] LLM 短路器打开: ${reason}，30秒内跳过 LLM`);
    this.llmCircuitOpen = true;
    this.llmCircuitUntil = Date.now() + 30000;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
}

// ============================================================
// 单例
// ============================================================
let agentInstance: ResumeParserAgent | null = null;

export function getResumeParserAgent(config?: Partial<LLMConfig>): ResumeParserAgent {
  if (!agentInstance) {
    agentInstance = new ResumeParserAgent(config);
  }
  return agentInstance;
}

export function resetResumeParserAgent(): void {
  agentInstance = null;
}
