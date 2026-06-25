/* ============================================================
   Agent Tool System — 简历解析 Agent 可调用的工具集

   每个 Tool 是 Agent 可调用的原子能力单元。
   Agent 负责编排 Tool 的调用顺序，Tracer 记录每次 Tool 调用。
   ============================================================ */

import { getAgentTracer, type AgentTracer, type AgentName } from './agent-tracer';
import { extractDocumentText, type DocumentParseResult } from './document-parser';
import { getLLMClient, type LLMClient, type LLMConfig,
  getResumeParsePrompt } from './llm-client';

// ============================================================
// Tool 类型定义
// ============================================================

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** 工具执行耗时 (ms) */
  duration?: number;
  /** 附加元信息 */
  metadata?: Record<string, unknown>;
}

export interface AgentTool<TParams = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  /** 该工具归属的 Agent，用于 tracer 记录 */
  agentName: AgentName;
  execute(params: TParams): Promise<ToolResult<TResult>>;
}

// ============================================================
// Tool 1: 文档解析器 (Document Parser Tool)
// 把 PDF/DOCX/TXT 文件转换为纯文本
// ============================================================

interface DocumentParserParams {
  file: File;
}

export class DocumentParserTool implements AgentTool<DocumentParserParams, DocumentParseResult> {
  name = 'document-parser';
  description = '解析 PDF/DOCX/TXT 简历文件，提取纯文本内容。自动识别扫描版 PDF 并生成页面截图。';
  agentName: AgentName = 'resume-parser';

  private tracer: AgentTracer;

  constructor() {
    this.tracer = getAgentTracer();
  }

  async execute(params: DocumentParserParams): Promise<ToolResult<DocumentParseResult>> {
    const traceId = this.tracer.startTrace(
      this.agentName,
      `parse-doc: ${params.file.name} (${this.formatSize(params.file.size)})`,
      { tool: this.name, fileName: params.file.name },
    );

    const startTime = Date.now();

    try {
      const doc = await extractDocumentText(params.file);

      const duration = Date.now() - startTime;
      this.tracer.completeTrace(traceId,
        `extracted ${doc.text.length} chars, source=${doc.source}, scanned=${doc.isScanned}`,
        doc.text.slice(0, 500),
        { tool: this.name, textLength: doc.text.length, source: doc.source, isScanned: doc.isScanned, duration },
      );

      return { success: true, data: doc, duration, metadata: { source: doc.source, isScanned: doc.isScanned, pageCount: doc.pageCount } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;
      this.tracer.errorTrace(traceId, `[${this.name}] ${errorMsg}`);
      return { success: false, error: errorMsg, duration };
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
}

// ============================================================
// P1 修复 (A-7): 字段互斥校验
// 校验 workYears 与 experiences 累计时长的合理性
// ============================================================

/**
 * 校验 workYears 与 experiences[] 的一致性
 *
 * 如果 workYears 与 experiences 累计时长偏差过大 (>2年)，则信任 experiences 的计算结果。
 * LLM 有时会错误地使用 "当前年份 - 最早年份" 计算 workYears 导致高估。
 */
function validateFieldConsistency(fields: ParsedResumeFields): void {
  if (!fields.experiences || fields.experiences.length === 0) return;

  // 从 experiences 累加估算 workYears
  let accumulatedYears = 0;
  for (const exp of fields.experiences) {
    const periodMatch = exp.period?.match(/(\d{4})[.\-/]?(\d{1,2})?\s*[-–—至~到]+\s*(\d{4})[.\-/]?(\d{1,2})?/);
    if (periodMatch) {
      const startYear = parseInt(periodMatch[1]);
      const endYear = parseInt(periodMatch[3]);
      const startMonth = periodMatch[2] ? parseInt(periodMatch[2]) : 1;
      const endMonth = periodMatch[4] ? parseInt(periodMatch[4]) : 12;
      if (endYear >= startYear && startYear >= 1990) {
        const months = (endYear - startYear) * 12 + (endMonth - startMonth);
        accumulatedYears += months / 12;
      }
    } else {
      // 检查"至今"格式
      const ongoingMatch = exp.period?.match(/(\d{4})[.\-/]?(\d{1,2})?\s*[-–—至~到]+\s*(?:至今|现在)/);
      if (ongoingMatch) {
        const startYear = parseInt(ongoingMatch[1]);
        const startMonth = ongoingMatch[2] ? parseInt(ongoingMatch[2]) : 1;
        const now = new Date();
        const months = (now.getFullYear() - startYear) * 12 + (now.getMonth() + 1 - startMonth);
        accumulatedYears += Math.max(0, months / 12);
      }
    }
  }

  // 偏差 > 2 年则纠正 workYears
  if (Math.abs(fields.workYears - accumulatedYears) > 2 && accumulatedYears > 0) {
    console.warn(
      `[validateFieldConsistency] workYears=${fields.workYears} 与 experiences 累计=${accumulatedYears.toFixed(1)} 偏差过大，` +
      `自动纠正为 ${Math.round(accumulatedYears)}`,
    );
    fields.workYears = Math.round(accumulatedYears);
  }
}

// ============================================================
// Tool 2: LLM 简历解析器 (LLM Resume Parser Tool)
// 使用大模型从文本中提取结构化简历信息
// ============================================================

export interface ParsedResumeFields {
  isResume: boolean;
  name: string;
  age?: number;
  degree: string;
  school: string;
  major: string;
  workYears: number;
  city: string;
  skills: string[];
  experiences: Array<{ role: string; company: string; period: string; duration: string }>;
  confidence: 'high' | 'medium' | 'low';
  /** 逐字段置信度：标明每个字段是 llm 提取、regex 提取还是默认值 */
  fieldConfidences?: {
    name: 'llm' | 'regex' | 'vision' | 'default';
    age: 'llm' | 'regex' | 'vision' | 'default';
    degree: 'llm' | 'regex' | 'vision' | 'default';
    school: 'llm' | 'regex' | 'vision' | 'default';
    major: 'llm' | 'regex' | 'vision' | 'default';
    workYears: 'llm' | 'regex' | 'vision' | 'default';
    city: 'llm' | 'regex' | 'vision' | 'default';
    skills: 'llm' | 'regex' | 'vision' | 'default';
    experiences: 'llm' | 'regex' | 'vision' | 'default';
  };
}

interface LLMResumeParserParams {
  resumeText: string;
  fileName?: string;
  /** 文档来源提示，帮助 LLM 更好地处理 PDF/DOCX 特定噪声 */
  sourceHint?: string;
}

export class LLMResumeParserTool implements AgentTool<LLMResumeParserParams, ParsedResumeFields> {
  name = 'llm-resume-parser';
  description = '调用 LLM 大模型从简历文本中提取结构化字段：姓名、学历、学校、专业、工作年限、技能、经历等。';
  agentName: AgentName = 'resume-parser';

  private llm: LLMClient;
  private tracer: AgentTracer;

  constructor(config?: Partial<LLMConfig>) {
    this.llm = getLLMClient(config);
    this.tracer = getAgentTracer();
  }

  async execute(params: LLMResumeParserParams): Promise<ToolResult<ParsedResumeFields>> {
    const traceId = this.tracer.startTrace(
      this.agentName,
      `llm-parse: ${params.resumeText.slice(0, 100)}...`,
      { tool: this.name, textLength: String(params.resumeText.length) },
      params.resumeText.slice(0, 6000),
    );

    const startTime = Date.now();

    try {
      const result = await this.llm.complete({
        systemPrompt: '你是简历解析专家，从文本中提取结构化信息。',
        messages: [{ role: 'user', content: getResumeParsePrompt(params.resumeText, params.sourceHint) }],
        temperature: 0.1,
        maxTokens: 2048,
      });

      console.log('[LLMResumeParserTool] LLM 原始返回长度:', result.length);
      console.log('[LLMResumeParserTool] LLM 返回前300字符:', result.slice(0, 300));

      const parsed = this.safeParseJSON(result);

      if (!parsed) {
        console.error('[LLMResumeParserTool] ❌ safeParseJSON 返回 null — LLM 响应无法解析为 JSON');
        console.error('[LLMResumeParserTool] LLM 原始响应全文:', result);
        const duration = Date.now() - startTime;
        this.tracer.completeTrace(traceId, 'json-parse-failed', result.slice(0, 500),
          { tool: this.name, fallback: true, duration });
        return { success: false, error: 'JSON解析失败', duration, metadata: { rawResponse: result.slice(0, 500) } };
      }

      if (parsed.isResume === false) {
        const duration = Date.now() - startTime;
        this.tracer.completeTrace(traceId, 'not-a-resume', JSON.stringify(parsed),
          { tool: this.name, isResume: false, duration });
        return { success: true, data: { isResume: false, name: '', degree: '', school: '', major: '', workYears: 0, city: '', skills: [], experiences: [], confidence: 'low' }, duration };
      }

      // 构造结构化结果
      const fields: ParsedResumeFields = {
        isResume: true,
        name: (parsed as Record<string, unknown>).name as string || '',
        age: (parsed as Record<string, unknown>).age as number | undefined,
        degree: (parsed as Record<string, unknown>).degree as string || '',
        school: (parsed as Record<string, unknown>).school as string || '',
        major: (parsed as Record<string, unknown>).major as string || '',
        workYears: (parsed as Record<string, unknown>).workYears as number ?? 0,
        city: (parsed as Record<string, unknown>).city as string || '',
        skills: (parsed as Record<string, unknown>).skills as string[] || [],
        experiences: ((parsed as Record<string, unknown>).experiences || []) as ParsedResumeFields['experiences'],
        confidence: ((parsed as Record<string, unknown>).confidence as ParsedResumeFields['confidence']) || 'medium',
        // LLM 提取的字段全部标记为 'llm'
        fieldConfidences: {
          name: 'llm', age: 'llm', degree: 'llm', school: 'llm',
          major: 'llm', workYears: 'llm', city: 'llm', skills: 'llm', experiences: 'llm',
        },
      };

      // 诊断日志: LLM 提取到的关键字段
      const extractedKeys = Object.entries(parsed as Record<string, unknown>)
        .filter(([k]) => k !== 'isResume' && k !== 'confidence')
        .filter(([, v]) => {
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === 'number') return v !== 0;
          return v !== '' && v !== undefined && v !== null;
        })
        .map(([k]) => k);
      console.log('[LLMResumeParserTool] ✅ JSON 解析成功 | 有效字段:', extractedKeys.join(', ') || '(全部空)');
      console.log('[LLMResumeParserTool] 解析的 JSON 对象:', JSON.stringify(parsed).slice(0, 500));

      // P1 修复 (A-7): 字段互斥校验 — workYears 与 experiences 累计时长一致性
      validateFieldConsistency(fields);

      const duration = Date.now() - startTime;
      this.tracer.completeTrace(traceId, JSON.stringify(fields), result,
        { tool: this.name, name: fields.name, confidence: fields.confidence, duration });

      return { success: true, data: fields, duration };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;
      console.error(`[LLMResumeParserTool] 调用失败:`, errorMsg);
      this.tracer.errorTrace(traceId, `[${this.name}] ${errorMsg}`);
      return { success: false, error: errorMsg, duration };
    }
  }

  /**
   * 安全 JSON 解析（增强版 v2）
   *
   * LLM 经常违抗"不要输出 markdown"的指令，在 JSON 前后添加解释文字。
   * 此方法逐步尝试多种提取策略，并在失败时输出诊断日志。
   */
  private safeParseJSON(text: string): Record<string, unknown> | null {
    if (!text?.trim()) return null;

    // ── 策略 1: 提取 markdown 代码块 ──
    // 支持 ```json, ```JSON, ``` 三种格式
    const codeBlock = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
    if (codeBlock) {
      const parsed = this.tryParseJSON(codeBlock[1].trim());
      if (parsed) return parsed;
    }

    // ── 策略 2: 去除 LLM 常见的开场白 ──
    // "好的，以下是解析结果：\n{...}" → 从第一个 { 开始提取
    const stripped = text
      .replace(/^[\s\S]*?(?=\{|\[)/, '')  // 去掉第一个 { 或 [ 之前的所有内容
      .trim();

    const parsed2 = this.tryExtractAndParse(stripped);
    if (parsed2) return parsed2;

    // ── 策略 3: 去除末尾解释文字，重试 ──
    // "{...}\n以上是从简历中提取的信息。" → 去掉最后一个 } 之后的内容
    const lastBrace = stripped.lastIndexOf('}');
    if (lastBrace > 0) {
      const truncated = stripped.slice(0, lastBrace + 1);
      const parsed3 = this.tryExtractAndParse(truncated);
      if (parsed3) return parsed3;
    }

    // ── 策略 4: 修复常见 JSON 语法错误后重试 ──
    const jsonBlock = this.extractBalancedJSON(stripped);
    if (jsonBlock) {
      const parsed4 = this.tryHealAndParse(jsonBlock);
      if (parsed4) return parsed4;
    }

    // ═══ 全部策略失败 → 输出诊断日志 ═══
    console.error('[safeParseJSON] ═══ JSON 解析失败 ═══');
    console.error('[safeParseJSON] 原始响应长度:', text.length);
    console.error('[safeParseJSON] 原始响应前 1000 字符:', text.slice(0, 1000));
    console.error('[safeParseJSON] 原始响应后 200 字符:', text.slice(-200));
    console.error('[safeParseJSON] stripped 前 500 字符:', stripped.slice(0, 500));
    if (jsonBlock) {
      console.error('[safeParseJSON] 括号平衡提取 前 500 字符:', jsonBlock.slice(0, 500));
    } else {
      console.error('[safeParseJSON] 括号平衡提取: null (未找到完整 JSON 对象)');
    }
    return null;
  }

  /** 尝试直接 JSON.parse */
  private tryParseJSON(candidate: string): Record<string, unknown> | null {
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** 尝试提取括号平衡的 JSON 然后解析 */
  private tryExtractAndParse(text: string): Record<string, unknown> | null {
    const jsonBlock = this.extractBalancedJSON(text);
    if (!jsonBlock) return null;
    const parsed = this.tryParseJSON(jsonBlock);
    if (parsed) return parsed;
    return this.tryHealAndParse(jsonBlock);
  }

  /** 修复常见 JSON 语法错误后解析 */
  private tryHealAndParse(jsonBlock: string): Record<string, unknown> | null {
    try {
      const fixed = jsonBlock
        .replace(/,\s*(\s*[}\]])/g, '$1')       // 尾随逗号
        .replace(/[\u201c\u201d]/g, '"')          // 中文引号 → 半角
        .replace(/[\u2018\u2019]/g, "'")          // 中文单引号
        .replace(/\uFF1A/g, ':')                  // 全角冒号
        .replace(/[\uFF0C]/g, ',')                 // 全角逗号
        .replace(/\n/g, ' ')                       // 换行 → 空格（JSON 内换行无害但有时造成问题）
        .replace(/\s+/g, ' ')                      // 压缩空白
        .replace(/"\s*:\s*"/g, '":"');            // 修复键值对之间的多余空格
      return JSON.parse(fixed) as Record<string, unknown>;
    } catch {
      // 最后尝试：移除所有不可见控制字符
      try {
        const ultraClean = jsonBlock.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
        return JSON.parse(ultraClean) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }

  private extractBalancedJSON(text: string): string | null {
    const startIdx = text.indexOf('{');
    if (startIdx === -1) return null;

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (ch === '\\' && inString) { escapeNext = true; continue; }
      if (ch === '"' && !escapeNext) { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(startIdx, i + 1);
      }
    }
    return null;
  }
}

// ============================================================
// Tool 3: 本地规则简历解析器 (Local Rule Parser Tool)
// 基于正则表达式和启发式规则提取简历字段
// ============================================================

interface LocalRuleParserParams {
  resumeText: string;
  /** 文档来源，影响文本预处理策略 */
  sourceHint?: string;
  /** LLM 已提取的字段（用于多策略融合：LLM 有值的不覆盖，LLM 空的用本地规则补充） */
  llmFields?: Partial<ParsedResumeFields>;
  /** 文件名（用于无法从文本中提取姓名时的回退匹配） */
  fileName?: string;
}

export class LocalRuleParserTool implements AgentTool<LocalRuleParserParams, ParsedResumeFields> {
  name = 'local-rule-parser';
  description = '使用本地正则表达式和启发式规则从简历文本中提取结构化字段。不依赖网络，零延迟。';
  agentName: AgentName = 'resume-parser';

  private tracer: AgentTracer;

  constructor() {
    this.tracer = getAgentTracer();
  }

  async execute(params: LocalRuleParserParams): Promise<ToolResult<ParsedResumeFields>> {
    const traceId = this.tracer.startTrace(
      this.agentName,
      `local-rule-parse: ${params.resumeText.slice(0, 100)}...`,
      { tool: this.name, textLength: String(params.resumeText.length) },
    );

    const startTime = Date.now();

    try {
      const normalized = this.normalizeResumeText(params.resumeText, params.sourceHint);
      const signals = this.detectResumeSignals(normalized);

      const strongSignals = (signals.hasName ? 1 : 0) + (signals.hasEducation ? 1 : 0) + (signals.hasWork ? 1 : 0) + (signals.hasContact ? 1 : 0);
      const isResume = signals.totalScore >= 3 || strongSignals >= 2;

      if (!isResume) {
        const duration = Date.now() - startTime;
        this.tracer.completeTrace(traceId, 'not-a-resume', JSON.stringify(signals),
          { tool: this.name, isResume: false, totalScore: signals.totalScore, duration });
        return {
          success: true,
          data: { isResume: false, name: '', degree: '', school: '', major: '', workYears: 0, city: '', skills: [], experiences: [], confidence: 'low' },
          duration,
        };
      }

      // === 多策略融合：如果 LLM 提供了部分字段，优先使用 LLM 结果 ===
      const llmFields = params.llmFields;
      const fields: ParsedResumeFields = {
        isResume: true,
        name: llmFields?.name || this.extractNameRobust(normalized, params.fileName) || '',
        age: llmFields?.age ?? this.extractAgeRobust(normalized),
        degree: llmFields?.degree || this.extractDegreeRobust(normalized) || '',
        school: llmFields?.school || this.extractSchoolRobust(normalized) || '',
        major: llmFields?.major || this.extractMajorRobust(normalized) || '',
        workYears: llmFields?.workYears ?? this.extractWorkYearsRobust(normalized) ?? 0,
        city: llmFields?.city || this.extractCityRobust(normalized) || '',
        skills: (llmFields?.skills && llmFields.skills.length > 0) ? llmFields.skills : (this.extractSkillsRobust(normalized) || []),
        experiences: (llmFields?.experiences && llmFields.experiences.length > 0) ? llmFields.experiences : this.extractExperiencesRobust(normalized),
        confidence: signals.totalScore >= 7 ? 'high' : signals.totalScore >= 5 ? 'medium' : 'low',
      };

      // 字段置信度：在 fields 初始化之后再计算，避免 TDZ 错误
      fields.fieldConfidences = {
        name: llmFields?.name ? 'llm' : fields.name ? 'regex' : 'default',
        age: llmFields?.age !== undefined ? 'llm' : fields.age !== undefined ? 'regex' : 'default',
        degree: llmFields?.degree ? 'llm' : fields.degree !== '本科' ? 'regex' : 'default',
        school: llmFields?.school ? 'llm' : fields.school !== '未知院校' ? 'regex' : 'default',
        major: llmFields?.major ? 'llm' : fields.major !== '未知专业' ? 'regex' : 'default',
        workYears: llmFields?.workYears ? 'llm' : fields.workYears > 0 ? 'regex' : 'default',
        city: llmFields?.city ? 'llm' : fields.city !== '未知' ? 'regex' : 'default',
        skills: (llmFields?.skills && llmFields.skills.length > 0) ? 'llm' : (fields.skills[0] !== '通用技能' ? 'regex' : 'default'),
        experiences: (llmFields?.experiences && llmFields.experiences.length > 0) ? 'llm' : (fields.experiences.length > 0 ? 'regex' : 'default'),
      };

      // P1 修复 (A-7): 字段互斥校验
      validateFieldConsistency(fields);

      const duration = Date.now() - startTime;
      this.tracer.completeTrace(traceId, JSON.stringify(fields), undefined,
        { tool: this.name, name: fields.name, confidence: fields.confidence, totalScore: signals.totalScore, duration });

      return { success: true, data: fields, duration };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;
      this.tracer.errorTrace(traceId, `[${this.name}] ${errorMsg}`);
      return { success: false, error: errorMsg, duration };
    }
  }

  // ============================================================
  // 以下方法从 agent-engine.ts 抽离（避免重复引用）
  // ============================================================

  /** 文本规范化 — 针对不同来源做差异化预处理 */
  private normalizeResumeText(text: string, sourceHint?: string): string {
    let result = text;

    // ===== PDF 特定预处理 =====
    const isPdf = sourceHint === 'pdf_text' || sourceHint === 'pdf_scanned';
    if (isPdf) {
      // 1. 移除页码（独立行上的纯数字）
      result = result.replace(/^\s*\d{1,3}\s*$/gm, '');
      // 2. 移除常见页眉/页脚噪声
      result = result.replace(/^\s*(?:个人简历|简历|resume|cv|curriculum\s*vitae|第\s*\d+\s*页)\s*$/gim, '');
      // 3. 合并因换页被截断的词语（"工作经\n验" → "工作经验"）
      result = result.replace(/([\u4e00-\u9fff])\n([\u4e00-\u9fff])/g, '$1$2');
      // 4. PDF 文本项有时以视觉顺序返回，修复换页导致的反序标题
      result = result.replace(/([：:])\s*\n\s*([^\n]{2,20})\s*\n/g, '$1$2');
      // 5. 修复 pdf.js 提取中常见的表格行拆分为多行的问题
      //    "袁佳琪\n男\n25岁\n本科" → 尝试合并短行
      result = this.mergePdfShortLines(result);
    }

    // ===== DOCX 特定预处理 =====
    if (sourceHint === 'docx') {
      // Word 文档带样式信息，通常质量较好，做最小处理
      // 移除制表符（转为空格）
      result = result.replace(/\t/g, ' ');
    }

    // ===== 通用规范化 =====
    // 1. CJK 字符间的多余空格合并
    result = result.replace(/([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])\s+([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/g, '$1$2');
    // 2. 行首/行尾零宽字符和空格移除
    result = result.replace(/^[\s\u200b\u200c\u200d\u2060\uFEFF]+/gm, '');
    result = result.replace(/[\s\u200b\u200c\u200d\u2060\uFEFF]+$/gm, '');
    // 3. 多个连续换行合并为最多两个
    result = result.replace(/\n{3,}/g, '\n\n');
    // 4. 全角冒号 → 半角冒号（正则统一）
    result = result.replace(/([^\s\u4e00-\u9fff])：/g, '$1:');
    // 5. 全角逗号/句号 → 保持原样（简历中的中文标点是正常的），但统一全角空格
    result = result.replace(/\u3000/g, ' ');
    // 6. 中文数字 → 阿拉伯数字（年龄/年限提取需要）
    result = result.replace(/二十([一二三四五六七八九])/g, (_, d) => `2${'一二三四五六七八九'.indexOf(d) + 1}`);
    result = result.replace(/三十([一二三四五六七八九])/g, (_, d) => `3${'一二三四五六七八九'.indexOf(d) + 1}`);
    result = result.replace(/四十([一二三四五六七八九])/g, (_, d) => `4${'一二三四五六七八九'.indexOf(d) + 1}`);
    result = result.replace(/(?:二十|廿)/g, '20'); // 二十 → 20 (用于年龄)
    result = result.replace(/(?:三十|卅)/g, '30');
    // 7. 移除纯分隔线
    result = result.replace(/^[-=_*]{3,}\s*$/gm, '');
    // 8. 清除不可见控制字符（保留换行和 tab）
    result = result.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');

    return result.trim();
  }

  /** PDF 短行合并：尝试将独立的单行短文本合并为完整行，但保留字段值对 */
  private mergePdfShortLines(text: string): string {
    const lines = text.split('\n');
    const merged: string[] = [];
    let pendingShort = '';

    /** 判断该行是否看起来像一个独立的字段值（不应参与合并） */
    const isFieldValue = (line: string): boolean => {
      const t = line.trim();
      // 手机号
      if (/^1[3-9]\d{9}$/.test(t)) return true;
      // 邮箱
      if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(t)) return true;
      // 日期范围（如 "2026.09 - 2027.06"）
      if (/^\d{4}[.\-/]\d{1,2}\s*[-–—至~到]+\s*(?:\d{4}[.\-/]\d{1,2}|至今|现在)$/.test(t)) return true;
      // 字段标签:值（如 "姓名：周晓雪"、"base：珠海"、"GPA: 3.8"、"年龄：25"）
      if (/^[A-Za-z\u4e00-\u9fff]{1,8}\s*[：:]/.test(t)) return true;
      // 纯数字/百分比/GPA
      if (/^[\d.]+(\/[\d.]+)?\s*(?:岁|年)?$/.test(t)) return true;
      return false;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      // 空行 → 结束之前的聚合
      if (!trimmed) {
        if (pendingShort) { merged.push(pendingShort); pendingShort = ''; }
        merged.push('');
        continue;
      }
      // 章节标题 → 不参与合并
      if (/^(工作经历|教育经历|项目经验|技能|自我评价|求职意向|个人总结|联系方式?|教育背景|实习经历)\s*[：:]*$/.test(trimmed)) {
        if (pendingShort) { merged.push(pendingShort); pendingShort = ''; }
        merged.push(trimmed);
        continue;
      }
      // 字段值行 → 不参与合并，直接输出
      if (isFieldValue(trimmed)) {
        if (pendingShort) { merged.push(pendingShort); pendingShort = ''; }
        merged.push(trimmed);
        continue;
      }
      // 短行（≤15字符且无标点结尾）→ 暂存尝试合并
      if (trimmed.length <= 15 && !/[。！？\.!\?]$/.test(trimmed)) {
        pendingShort += (pendingShort ? ' ' : '') + trimmed;
        continue;
      }
      // 常规行 → 先输出暂存再输出当前行
      if (pendingShort) { merged.push(pendingShort); pendingShort = ''; }
      merged.push(trimmed);
    }
    if (pendingShort) merged.push(pendingShort);

    return merged.join('\n');
  }

  private detectResumeSignals(text: string): Record<string, boolean | number> {
    const t = text.toLowerCase();
    const educationKeywords = ['学历', '学位', '毕业', '本科', '硕士', '博士', '大专', '教育背景', '教育经历', '院校', '大学', '学院'];
    const hasEducation = educationKeywords.some(k => t.includes(k));
    const yearRangePattern = /20(0\d|1\d|2\d)[-–—.]*(20(0\d|1\d|2\d)|至今|到现在)/;
    const hasYearRanges = yearRangePattern.test(t);
    const schoolSuffixes = ['大学', '学院', '理工', '科技', '师范', '财经', '交通'];
    const hasSchoolHint = schoolSuffixes.some(s => t.includes(s));

    const workKeywords = ['工作经历', '工作', '实习', '经验', '项目', '负责', '参与', '公司', '有限公司', '集团', '科技有限公司'];
    const hasWork = workKeywords.some(k => t.includes(k));
    const workTimeRolePattern = /\d{4}[.\-/]\d{1,2}\s*[-–—至~到]+\s*(\d{4}|至今)/;
    const hasWorkTimeFormat = workTimeRolePattern.test(t);
    const jobTitles = ['工程师', '开发', '设计师', '经理', '专员', '主管', '架构师', '产品', '运营', '分析师', '研究员', '测试', '前端', '后端', '算法', '数据'];
    const hasJobTitle = jobTitles.some(j => t.includes(j));

    const namePatterns = [
      /^(?:姓名|名字|name)\s*[：:\s]\s*.{1,4}/im,
      /^[张王李刘陈杨黄赵周吴徐孙马朱胡郭何林高郑罗谢梁唐冯韩董曾萧蔡曹袁邓许傅沈彭苏卢吕蒋魏叶贾余潘杜丁薛钟汪任姜范崔方廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段漕钱汤尹黎易常武乔贺赖龚文樊佟][\u4e00-\u9fff]{1,2}(?:[\s|\|｜\/])/m,
      /^[\u4e00-\u9fff]{2,4}[\s|\|｜\/]/m,
    ];
    const hasName = namePatterns.some(p => p.test(text)) || /(?:姓名|名字)[：:]/.test(t);

    const contactPatterns = [/1[3-9]\d{9}/, /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, /微信|wechat|phone|tel|邮箱|邮件/i];
    const hasContact = contactPatterns.some(p => p.test(t));

    const structureKeywords = ['自我评价', '求职意向', '个人总结', '技能', '专业技能', '特长', '证书', '荣誉', '奖项', '语言能力'];
    const hasStructure = structureKeywords.filter(k => t.includes(k)).length >= 1;

    const allSkillWords = [
      'python', 'java', 'javascript', 'typescript', 'c\+\+', 'go', 'rust', 'ruby', 'php', 'swift', 'kotlin',
      'react', 'vue', 'angular', 'nodejs', 'spring', 'django', 'flask', '.net', 'laravel',
      'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch', 'oracle', 'sql',
      'docker', 'kubernetes', 'linux', 'nginx', 'git', 'ci/cd', 'jenkins', 'aws', 'azure', '阿里云',
      'ai', '机器学习', '深度学习', 'nlp', '计算机视觉', '大数据', '数据分析',
      'systemverilog', 'uvm', 'verilog', 'vhdl', 'fpga', 'soc', 'ic设计', '芯片', '嵌入式',
      'matlab', 'simulink', 'cadence', 'synopsys',
      'office', 'excel', 'powerpoint', 'word', 'photoshop', 'figma', 'sketch',
    ];
    const skillCount = allSkillWords.filter(s => t.includes(s)).length;
    const hasHighSkillDensity = skillCount >= 3;

    let totalScore = 0;
    if (hasEducation) totalScore += 2;
    if (hasYearRanges) totalScore += 1;
    if (hasSchoolHint) totalScore += 1;
    if (hasWork) totalScore += 2;
    if (hasWorkTimeFormat) totalScore += 1;
    if (hasJobTitle) totalScore += 1;
    if (hasContact) totalScore += 1;
    if (hasStructure) totalScore += 1;
    if (hasHighSkillDensity) totalScore += 1;
    if (hasName) totalScore += 1;
    if (text.length > 200) totalScore += 1;
    if (text.length > 1000) totalScore += 1;

    return { hasName, hasEducation: hasEducation || hasSchoolHint || hasYearRanges, hasWork: hasWork || hasWorkTimeFormat || hasJobTitle, hasContact, hasStructure, hasHighSkillDensity, skillCount, textLength: text.length, totalScore };
  }

  /** 姓名提取：支持 8 种格式，自动跳过 PDF 页眉噪声 */
  private extractNameRobust(text: string, fileName?: string): string {
    // 预处理：移除页眉/标题行干扰
    const cleanText = text
      .replace(/^\s*(?:简历|个人简历|resume|cv|curriculum\s*vitae|第\s*\d+\s*页)\s*$/gim, '')
      .trim();

    // 1. 标签匹配：“姓名：xxx”
    const labeledMatch = cleanText.match(/(?:姓名|名字|name|氏名)\s*[：:\s=]\s*([^\s\n\r,，|｜\/]{2,4})/i);
    if (labeledMatch && /^[\u4e00-\u9fff]{2,4}$/.test(labeledMatch[1].trim())) return labeledMatch[1].trim();

    // 2. 首行（跳过明显的页眉/标题行）
    const lines = cleanText.split('\n').filter(l => l.trim());
    const firstContentLine = lines.find(l => {
      const t = l.trim();
      // 跳过页码、页眉、标题行
      if (/^[\s\d]+$/.test(t)) return false;  // "1", "  2  "
      if (/^(?:个人简历|简历|resume|cv|curriculum\s*vitae|求职意向|个人总结|自我评价)\s*$/i.test(t)) return false;
      // 跳过太短的行（<2字符无法是姓名）
      if (t.length < 2) return false;
      return true;
    }) || '';

    // 尝试从首行提取姓名
    if (firstContentLine) {
      const fl = firstContentLine.trim();
      // 2a. "袁佳琪 | 男 | 25岁" 表格格式
      const tableNameMatch = fl.match(/^([\u4e00-\u9fff]{2,4})\s*[|｜]/);
      if (tableNameMatch) return tableNameMatch[1];
      // 2b. "张三，男" 逗号分隔
      const commaNameMatch = fl.match(/^([\u4e00-\u9fff]{2,4})\s*[，,]/);
      if (commaNameMatch) return commaNameMatch[1];
      // 2c. "李四/男" 斜线分隔
      const slashNameMatch = fl.match(/^([\u4e00-\u9fff]{2,4})\s*[/／]/);
      if (slashNameMatch) return slashNameMatch[1];
      // 2d. 纯姓名行
      const soloNameMatch = fl.match(/^([\u4e00-\u9fff]{2,4})\s*$/);
      if (soloNameMatch) return soloNameMatch[1];
    }

    // 3. 常见姓氏 + 上下文中匹配
    const surnames = '张王李刘陈杨黄赵周吴徐孙马朱胡郭何林高郑罗谢梁唐冯韩董曾萧蔡曹袁邓许傅沈彭苏卢吕蒋魏叶贾余潘杜丁薛钟汪任姜范崔方邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段漕钱汤尹黎易常武乔贺赖龚文樊佟';
    const surNamePat = `[${surnames}]`;

    // 3a. 姓氏开头的行
    const nameAtStart = cleanText.match(new RegExp(`^${surNamePat}[\\u4e00-\\u9fff]{1,2}\\s*[|｜\\/\\n,，\\s]`, 'm'));
    if (nameAtStart && /^[\u4e00-\u9fff]{2,4}$/.test(nameAtStart[0].replace(/[|｜\/\s,，\n\r]+$/, '').trim())) {
      return nameAtStart[0].replace(/[|｜\/\s,，\n\r]+$/, '').trim();
    }
    // 3b. 独立行姓氏
    const lineNameMatch = cleanText.match(new RegExp(`^${surNamePat}[\\u4e00-\\u9fff]{1,2}\\s*$`, 'm'));
    if (lineNameMatch) return lineNameMatch[0].trim();
    // 3c. 管道分隔符后
    const pipeNameMatch = cleanText.match(/(?:^|\n)([\u4e00-\u9fff]{2,4})\s*[|｜\/]/m);
    if (pipeNameMatch && surnames.includes(pipeNameMatch[1][0])) return pipeNameMatch[1];
    // 3d. 紧密标签
    const tightLabel = cleanText.match(/姓名[：:]([\u4e00-\u9fff]{2,4})/);
    if (tightLabel) return tightLabel[1];

    // 4. 英文简历
    const engNameMatch = cleanText.match(/(?:name|candidate)\s*[:]\s*([A-Za-z\s]{2,20})/i);
    if (engNameMatch) return engNameMatch[1].trim();

    // 5. 兜底：第一个非标题、非关键词、2-4字的纯中文行
    const firstNonEmpty = lines.find(l => {
      const t = l.trim();
      if (t.length < 2 || t.length > 6) return false;
      if (/^(?:教育|工作|项目|技能|经验|联系|自我|求职|电话|邮箱|手机|年龄|性别|出生|姓名|名字)/.test(t)) return false;
      return /^[\u4e00-\u9fff]{2,4}$/.test(t) && surnames.includes(t[0]);
    });
    if (firstNonEmpty) return firstNonEmpty.trim();

    // 6. 文件名回退匹配（如 "[职位] 周宇瑞 26年应届生.pdf"、"周宇瑞_简历.pdf"）
    if (fileName) {
      // 提取不含扩展名和括号标签的纯文件名部分
      const namePart = fileName.replace(/\.[^.]+$/, '').replace(/\[.*?\]/g, ' ').replace(/[_\-\d]+/g, ' ');
      const nameMatch = namePart.match(new RegExp(`[${surnames}][\\u4e00-\\u9fff]{1,2}`));
      if (nameMatch && /^[\u4e00-\u9fff]{2,4}$/.test(nameMatch[0]) && surnames.includes(nameMatch[0][0])) {
        return nameMatch[0];
      }
    }

    return '';
  }

  private extractAgeRobust(text: string): number | undefined {
    const ageLabel = text.match(/(?:年龄|岁数)\s*[：:\s]*\s*(\d{1,2})\s*(?:岁)?/i);
    if (ageLabel) { const a = parseInt(ageLabel[1]); if (a >= 18 && a <= 70) return a; }
    const inlineAge = text.match(/[\s|｜\/,，]+(\d{1,2})\s*岁[\s|｜\/,，]/);
    if (inlineAge) { const a = parseInt(inlineAge[1]); if (a >= 18 && a <= 70) return a; }
    const birthYear = text.match(/(?:出生|生于|生日|birth)[^0-9]*(\d{4})/i);
    if (birthYear) { const year = parseInt(birthYear[1]); if (year >= 1970 && year <= 2010) return new Date().getFullYear() - year; }
    const birthDate = text.match(/(19|20)\d{2}[.\-/](0[1-9]|1[0-2])/);
    if (birthDate) { const year = parseInt(birthDate[0].slice(0, 4)); if (year >= 1970 && year <= 2010) return new Date().getFullYear() - year; }
    const firstLine = text.split('\n')[0];
    const firstLineAge = firstLine.match(/(\d{1,2})\s*岁/);
    if (firstLineAge) { const a = parseInt(firstLineAge[1]); if (a >= 18 && a <= 70) return a; }
    return undefined;
  }

  private extractDegreeRobust(text: string): string {
    const labeled = text.match(/(?:学历|学位|degree)\s*[：:\s]\s*(博士|硕士|本科|大专|高中)/i);
    if (labeled) return labeled[1];
    // 博士: 完整匹配 "博士研究生" | "ph.d" | "doctor" | 单独的 "博士"（需要上下文验证）
    if (/博士研究生|ph\.?d|doctor/i.test(text)) return '博士';
    if (/(?:^|\s|[，,|｜\/]|\d{4})(?:博士)[\s\n,，|｜\/]|博士(?:学历|学位|毕业)/i.test(text)) return '博士';
    // 硕士: 完整匹配 "硕士研究生" | "master" | 单独的 "硕士"（需要上下文验证）
    if (/硕士研究生|master/i.test(text)) return '硕士';
    if (/(?:^|\s|[，,|｜\/]|\d{4})(?:硕士)[\s\n,，|｜\/]|硕士(?:学历|学位|毕业)/i.test(text)) return '硕士';
    // 模糊匹配：在简历上下文中出现了"/硕士"模式（常见于 "人工智能硕士"、"计算机硕士" 等复合词）
    // 注意排除 "硕" 字引起的误匹配，仅匹配 "硕士" 二字
    if (/\S{1,8}(?:硕士|硕士$)/.test(text) && !/硕士(?:生|论文|答辩|导师)/.test(text)) return '硕士';
    if (/学士|bachelor|本科/i.test(text)) return '本科';
    if (/专科|大专|associate/i.test(text)) return '大专';
    return '';
  }

  // 学历名列表（这些不应该被当作学校名）
  private readonly DEGREE_LABELS = ['博士', '硕士', '本科', '大专', '高中', '学士', 'Bachelor', 'Master', 'PhD'];

  private extractSchoolRobust(text: string): string {
    // 预处理：合并同一字段标签的重复值（"学校：硕士|院校：北京航空航天大学" → 保留院校值）
    const consolidated = text.replace(
      /(学校|院校|毕业院校)\s*[：:]\s*([^|\n]+)[|｜]+(?:学校|院校)\s*[：:]\s*([^|\n]+)/gi,
      (_m, _label, v1, v2) => {
        // 第一个值如果是学历 → 保留第二个
        if (this.DEGREE_LABELS.some(d => v1.trim() === d)) return `院校：${v2.trim()}`;
        return `学校：${v1.trim()}`;
      }
    );

    const patterns = [
      /(?:毕业院校|院校|学校|教育背景|毕业于|graduated from|university)\s*[：:\sfrom]*\s*(.+?)(?:\n|[,，|｜])/i,
    ];
    for (const p of patterns) {
      const m = consolidated.match(p);
      if (m) {
        const val = m[1].trim();
        if (val.length >= 3 && val.length <= 30 && !this.DEGREE_LABELS.some(d => val === d)) {
          return val.replace(/[（(].*[）)]/, '');
        }
      }
    }
    // 非贪婪匹配学校名: 只捕获紧邻"大学"/"学院"之前的 2-15 个非空格字符
    // 从后往前找最近的学校名，避免捕获前缀噪声（如"珠海教育背景香港科技大学"→只要"香港科技大学"）
    const uniCandidates = [...text.matchAll(/([\u4e00-\u9fffA-Za-z]{2,15})(?:大学|学院|University|College|Institute)/g)];
    for (const match of uniCandidates) {
      const name = match[0].replace(/[（(].*[）)]/, '').trim();
      // 过滤噪声：学校名不应包含明显非学校词汇
      if (name.length >= 3 && name.length <= 20 && !/驳回|清单|格式|通过|第\s*\d+\s*页|页眉/.test(name)) {
        return name;
      }
    }
    return '';
  }

  private extractMajorRobust(text: string): string {
    const labeled = text.match(/(?:专业|major)\s*[：:\s]\s*(.+?)(?:\n|[,，|｜]|$)/i);
    if (labeled) { const m = labeled[1].trim(); if (m.length >= 2 && m.length <= 30) return m.replace(/[（(].*[）)]/, ''); }
    const majors = ['计算机科学与技术', '软件工程', '电子信息工程', '通信工程', '电子科学与技术', '自动化', '微电子学', '集成电路', '机械工程', '数学', '统计学', '物理学', '化学', '生物医学', '工商管理', '市场营销', '会计学', '金融学', '经济学', '法学', '英语', '中文', '人工智能', '数据科学', '网络工程', '信息安全', '物联网', '数字媒体'];
    for (const major of majors) { if (text.includes(major)) return major; }
    return '';
  }

  /** P1 修复 (A1-R3): 时间段累加算法替代 currentYear - earliestYear
   *  旧算法: new Date().getFullYear() - earliestYear → 系统性高估1-3年
   *  新算法: 逐段累加每段工作的实际时长，合并重叠时间段 */
  private extractWorkYearsRobust(text: string): number {
    // 优先级1: 明确的 "X年经验" 声明（排除 "XX年应届生"、"XX年毕业"、"202X年" 等伪匹配）
    const expMatchWithContext = text.match(/(\d+)\s*(?:年经验|年工作经验|年\s+经验|years?\s*(?:of)?\s*experience)/i);
    if (expMatchWithContext) {
      const yrs = parseInt(expMatchWithContext[1]);
      if (yrs >= 0 && yrs <= 50) return yrs;
    }
    // 宽松匹配的 "X年" — 需要上下文排除 "应届生"、"毕业" 等
    const looseYearMatch = text.match(/(\d+)\s*年(?![应届生|毕业|份|级|月|日])/);
    if (looseYearMatch) {
      const yrs = parseInt(looseYearMatch[1]);
      if (yrs >= 1 && yrs <= 50 && !/应届|在读|在校|实习期|毕业/.test(text.slice(
        Math.max(0, looseYearMatch.index! - 5),
        looseYearMatch.index! + looseYearMatch[0].length + 15
      ))) {
        return yrs;
      }
    }

    // 优先级2: 逐段累加 — 解析每个工作经历的起止时间，去重后求和
    const timeMatches = [
      ...text.matchAll(/(\d{4}[.\-/]\d{1,2})\s*[-–—至~到]+\s*(\d{4}[.\-/]\d{1,2}|至今|现在)/g),
    ];
    if (timeMatches.length > 0) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      // 解析每段时间段
      interface Period { startYear: number; startMonth: number; endYear: number; endMonth: number }
      const periods: Period[] = [];

      for (const m of timeMatches) {
        const startParts = m[1].split(/[.\-/]/);
        const startYear = parseInt(startParts[0]);
        const startMonth = startParts[1] ? parseInt(startParts[1]) : 1;
        let endYear: number;
        let endMonth: number;
        if (m[2] === '至今' || m[2] === '现在') {
          endYear = currentYear;
          endMonth = currentMonth;
        } else {
          const endParts = m[2].split(/[.\-/]/);
          endYear = parseInt(endParts[0]);
          endMonth = endParts[1] ? parseInt(endParts[1]) : 12;
        }
        if (startYear >= 1990 && startYear <= currentYear + 1 && endYear >= startYear) {
          periods.push({ startYear, startMonth, endYear, endMonth });
        }
      }

      if (periods.length > 0) {
        // 按开始时间排序
        periods.sort((a, b) => a.startYear !== b.startYear ? a.startYear - b.startYear : a.startMonth - b.startMonth);

        // 合并重叠/相邻的时间段
        const merged: Period[] = [{ ...periods[0] }];
        for (let i = 1; i < periods.length; i++) {
          const last = merged[merged.length - 1];
          const curr = periods[i];
          const lastEndMonths = last.endYear * 12 + last.endMonth;
          const currStartMonths = curr.startYear * 12 + curr.startMonth;
          if (currStartMonths <= lastEndMonths + 2) {
            // 重叠或间隔≤2个月 → 合并
            if (curr.endYear * 12 + curr.endMonth > lastEndMonths) {
              last.endYear = curr.endYear;
              last.endMonth = curr.endMonth;
            }
          } else {
            merged.push({ ...curr });
          }
        }

        // 累加合并后的总月份
        let totalMonths = 0;
        for (const p of merged) {
          totalMonths += (p.endYear - p.startYear) * 12 + (p.endMonth - p.startMonth);
        }
        // 去除明显异常值（负值、超大值）
        if (totalMonths > 0 && totalMonths < 600) {
          return Math.round((totalMonths / 12) * 10) / 10; // 保留1位小数
        }
      }
    }

    // 优先级3: "工作X年" 模式
    const workedMatch = text.match(/工作\s*(\d+)\s*年/);
    if (workedMatch) return parseInt(workedMatch[1]);

    return 0;
  }

  private extractCityRobust(text: string): string {
    const labeled = text.match(/(?:城市|现居|所在地|location|city)\s*[：:\s]\s*(.+?)(?:\n|[,，|｜])/i);
    if (labeled) return labeled[1].trim().slice(0, 10);
    const cities = ['北京', '上海', '深圳', '广州', '杭州', '成都', '南京', '武汉', '西安', '长沙', '重庆', '天津', '苏州', '青岛', '大连', '厦门', '合肥', '福州', '无锡', '东莞', '佛山', '珠海'];
    for (const c of cities) { if (text.includes(c)) return c; }
    return '';
  }

  private extractSkillsRobust(text: string): string[] {
    const t = text.toLowerCase();
    const allSkills = [
      'Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'Dart', 'R', 'Scala', 'Shell', 'Bash', 'Perl', 'Lua',
      'React', 'Vue', 'Angular', 'Next.js', 'Nuxt.js', 'Svelte', 'jQuery', 'HTML', 'CSS', 'Sass', 'Less', 'Tailwind', 'Webpack', 'Vite',
      'Node.js', 'Express', 'Koa', 'Spring Boot', 'Spring Cloud', 'Django', 'Flask', 'FastAPI', '.NET Core', 'Laravel', 'Rails', 'Gin', 'Echo',
      'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Oracle', 'SQLite', 'SQL Server', 'Cassandra', 'Dynamodb', 'InfluxDB',
      'Docker', 'Kubernetes', 'Jenkins', 'GitLab CI', 'GitHub Actions', 'Terraform', 'Ansible', 'Linux', 'Nginx', 'AWS', 'Azure', 'GCP', '阿里云', '腾讯云', '华为云',
      'TensorFlow', 'PyTorch', 'Keras', 'Scikit-learn', 'Pandas', 'NumPy', 'OpenCV', 'LangChain', 'Hugging Face',
      'SystemVerilog', 'UVM', 'Verilog', 'VHDL', 'FPGA', 'SoC', 'ASIC', 'IC设计', '芯片验证', 'DFT', 'RTL', 'Synthesis',
      'Cadence', 'Synopsys', 'Mentor Graphics', 'ModelSim', 'VCS', 'Xcelium', 'Verdi', 'SpyGlass', 'DC', 'ARM', 'RISC-V', 'x86', 'AMBA', 'AXI', 'APB', 'AHB',
      '嵌入式', 'STM32', 'ESP32', 'FreeRTOS', 'RTOS', 'PCB', 'Altium Designer', 'Keil', 'IAR',
      'Git', 'SVN', 'Jira', 'Confluence', 'Figma', 'Sketch', 'Photoshop', 'Office', 'Excel', 'PowerPoint', 'Visio', 'XMind',
    ];
    const found: string[] = [];
    for (const skill of allSkills) { if (t.includes(skill.toLowerCase())) found.push(skill); }
    return found.slice(0, 15);
  }

  /** P1 修复 (A1-R4): 非贪婪角色/公司匹配，消除虚假数据
   *  旧问题: 贪婪正则匹配到不相关文本，guessRoleFromContext 无条件返回 '工程师'
   *  新方案: 非贪婪匹配 + 角色有效性校验 + 公司名最低长度校验 */
  private extractExperiencesRobust(text: string): Array<{ role: string; company: string; period: string; duration: string }> {
    const experiences: Array<{ role: string; company: string; period: string; duration: string }> = [];

    // 尝试从"工作经历"区块提取
    const sectionMatch = text.match(/工作经历[：:]*\s*([\s\S]+?)(?=项目经验|教育经历|技能|自我评价|求职意向|个人总结|证书|$)/i);
    if (sectionMatch) {
      const section = sectionMatch[1];
      const timeLines = [...section.matchAll(/(\d{4}[.\-/]\d{1,2})\s*[-–—至~到]+\s*(\d{4}|至今|现在)/g)];

      if (timeLines.length > 0) {
        for (let i = 0; i < Math.min(timeLines.length, 3); i++) {
          const fullMatch = timeLines[i][0];
          const startPos = section.indexOf(fullMatch);
          const contextAfter = section.slice(startPos).slice(0, 150);

          // 非贪婪角色匹配：限制前缀不超过8字符，且必须以中文/字母开头
          const roleMatch = contextAfter.match(/([\u4e00-\u9fffA-Za-z]{2,8}?)(?:工程师|开发|设计师|经理|主管|专员|师|员|专家|架构师)/);
          const role = roleMatch ? roleMatch[0] : this.guessRoleFromContext(contextAfter);

          // 非贪婪公司匹配：必须有公司后缀
          const companyMatch = contextAfter.match(/([^\s,，]{2,25}?)(?:公司|有限|集团|科技|网络|技术|系统|实验室|研究所|银行|保险|证券)/);
          // 校验：公司名不能太短或仅数字
          const companyRaw = companyMatch ? companyMatch[1].trim() : '';
          const company = companyRaw.length >= 2 && !/^\d+$/.test(companyRaw) ? companyRaw : '';

          experiences.push({
            role: role || '',
            company,
            period: timeLines[i][0],
            duration: '',
          });
        }
        return experiences;
      }
    }

    // 全局兜底匹配：从全文搜索时间范围旁边的公司信息
    const globalTimeMatches = [
      ...text.matchAll(/(\d{4}[.\-/]\d{1,2})\s*[-–—至~到]+\s*(\d{4}|至今|现在)[^\n]{0,80}((?:有限公司|有限责任公司|集团|科技|网络|技术|实验室|研究所|银行))/g),
    ];
    for (let i = 0; i < Math.min(globalTimeMatches.length, 3); i++) {
      const context = globalTimeMatches[i][0];
      experiences.push({
        role: this.guessRoleFromContext(context),
        company: '', // 无法精确提取公司名
        period: `${globalTimeMatches[i][1]} - ${globalTimeMatches[i][2]}`,
        duration: '',
      });
    }
    return experiences;
  }

  /** 根据上下文猜角色 — 无匹配时返回空字符串（而非假数据'工程师'） */
  private guessRoleFromContext(context: string): string {
    const roleMap: [RegExp, string][] = [
      [/验证|verification/i, '芯片验证工程师'], [/开发|develop|frontend|前端/i, '开发工程师'],
      [/design|设计(?!师)/i, '设计工程师'], [/测试|test|qa/i, '测试工程师'],
      [/产品|product|pm/i, '产品经理'], [/分析|analysis|analyst/i, '分析师'],
      [/运维|devops|ops/i, '运维工程师'], [/算法|algorithm|ml|ai/i, '算法工程师'],
      [/数据|data/i, '数据工程师'], [/管理|manage|lead|manager|负责人/i, '技术经理'],
      [/架构|architect/i, '架构师'], [/后端|backend/i, '后端工程师'],
      [/全栈|fullstack|full-stack/i, '全栈工程师'], [/安全|security/i, '安全工程师'],
    ];
    for (const [pattern, role] of roleMap) { if (pattern.test(context)) return role; }
    return ''; // P1 修复：不编造假数据
  }
}

// ============================================================
// Tool 4: Vision 结构化文本解析器
// Vision API 返回的是 "姓名：张三\n学历：本科\n..." 这种结构化键值对文本
// 不需要经过 LLM→JSON 管道，直接做键值映射即可
// ============================================================

interface VisionStructuredTextParams {
  /** Vision API 返回的结构化文本 */
  visionText: string;
  /** 文件名（用于日志） */
  fileName?: string;
}

export class VisionStructuredParserTool implements AgentTool<VisionStructuredTextParams, ParsedResumeFields> {
  name = 'vision-structured-parser';
  description = '解析 Vision API 返回的结构化键值对文本（"姓名：张三\\n学历：本科"），直接映射为结构化字段，不调用 LLM。';
  agentName: AgentName = 'resume-parser';

  private tracer: AgentTracer;

  constructor() {
    this.tracer = getAgentTracer();
  }

  async execute(params: VisionStructuredTextParams): Promise<ToolResult<ParsedResumeFields>> {
    const traceId = this.tracer.startTrace(
      this.agentName,
      `vision-parse: ${params.visionText.slice(0, 100)}...`,
      { tool: this.name, textLength: String(params.visionText.length) },
    );

    const startTime = Date.now();

    try {
      const fields = this.parseVisionText(params.visionText);
      const duration = Date.now() - startTime;

      this.tracer.completeTrace(traceId, JSON.stringify(fields), undefined,
        { tool: this.name, name: fields.name, confidence: fields.confidence, duration });

      return { success: true, data: fields, duration };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;
      this.tracer.errorTrace(traceId, `[${this.name}] ${errorMsg}`);
      return { success: false, error: errorMsg, duration };
    }
  }

  /** 键值对文本 → 结构化字段 */
  private parseVisionText(text: string): ParsedResumeFields {
    const t = text.replace(/\r/g, '');

    // 逐行提取键值对
    const extract = (key: string): string => {
      const re = new RegExp(`${key}[\\s：:]*([^\\n]{0,60})`, 'i');
      const m = t.match(re);
      return m ? m[1].trim().replace(/[|｜\/,，]+$/, '').replace(/[（(].*[）)]/, '') : '';
    };

    const name = extract('姓名') || extract('名字') || extract('name');
    const ageStr = extract('年龄') || extract('age');
    const age = ageStr ? parseInt(ageStr) : undefined;
    const degree = extract('学历') || extract('学位') || extract('最高学历') || extract('degree');
    const school = extract('毕业院校') || extract('学校') || extract('院校') || extract('school') || extract('university');
    const major = extract('专业') || extract('major');
    const workYearsStr = extract('工作年限') || extract('工作经验') || extract('年限') || extract('workYears');
    const workYears = workYearsStr ? parseInt(workYearsStr) : 0;
    const city = extract('城市') || extract('所在地') || extract('现居') || extract('city') || extract('location');

    // 技能 — Vision 通常返回逗号/顿号分隔的列表
    const skillsRaw = extract('技能') || extract('专业技能') || extract('技术栈') || extract('skills');
    const skills = skillsRaw
      ? skillsRaw.split(/[,，、\s|｜]+/).filter(s => s.length >= 2 && s.length <= 20)
      : [];

    // 工作经历 — Vision 返回的多行结构
    const experiences = this.parseVisionExperiences(t);

    // 姓名第一行兜底
    const finalName = name || t.split('\n')[0].replace(/[：:].*/, '').trim().slice(0, 4);

    const fieldCount = [finalName, degree, school, major].filter(Boolean).length;
    const confidence: ParsedResumeFields['confidence'] =
      fieldCount >= 3 && experiences.length >= 1 ? 'high' :
      fieldCount >= 2 ? 'medium' : 'low';

    return {
      isResume: fieldCount >= 1 || skills.length >= 3,
      name: finalName || '',
      age: (age && age >= 18 && age <= 70) ? age : undefined,
      degree: degree || '',
      school: school || '',
      major: major || '',
      workYears: workYears || 0,
      city: city || '',
      skills: skills.slice(0, 15),
      experiences: experiences.length > 0 ? experiences : [],
      confidence,
      fieldConfidences: {
        name: finalName ? 'vision' : 'default',
        age: age ? 'vision' : 'default',
        degree: degree ? 'vision' : 'default',
        school: school ? 'vision' : 'default',
        major: major ? 'vision' : 'default',
        workYears: workYears ? 'vision' : 'default',
        city: city ? 'vision' : 'default',
        skills: skills.length > 0 ? 'vision' : 'default',
        experiences: experiences.length > 0 ? 'vision' : 'default',
      },
    };
  }

  /** 从 Vision 文本中提取工作经历 */
  private parseVisionExperiences(text: string): ParsedResumeFields['experiences'] {
    const result: ParsedResumeFields['experiences'] = [];

    // 匹配时间范围格式
    const timePattern = /(\d{4}[.\-/]\d{1,2})\s*[-–—至~到]+\s*(\d{4}[.\-/]\d{1,2}|至今|现在)/g;
    let match: RegExpExecArray | null;

    while ((match = timePattern.exec(text)) !== null) {
      const start = match[1];
      const end = match[2];
      // 取时间后的上下文（最多 80 字符）
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 80);

      // 提取角色
      const roleMatch = after.match(/[：:\s]*(.{2,20}?)(?:工程师|开发|设计师|经理|主管|专员|师|员|架构师|实习生|助理)/);
      const role = roleMatch ? roleMatch[0].replace(/^[\s：:]+/, '') : '';

      // 提取公司
      const companyMatch = after.match(/(.{2,25}?)(?:公司|集团|有限|科技|网络|技术股份|实验室|研究所|银行|保险|证券|医院)/);
      const company = companyMatch ? companyMatch[1].trim() : '';

      result.push({ role: role || '', company: company || '', period: `${start}至${end}`, duration: '' });
      if (result.length >= 3) break;
    }

    return result;
  }
}

let documentParserToolInstance: DocumentParserTool | null = null;
let llmResumeParserToolInstance: LLMResumeParserTool | null = null;
let localRuleParserToolInstance: LocalRuleParserTool | null = null;
let visionStructuredParserToolInstance: VisionStructuredParserTool | null = null;

export function getDocumentParserTool(): DocumentParserTool {
  if (!documentParserToolInstance) documentParserToolInstance = new DocumentParserTool();
  return documentParserToolInstance;
}

export function getLLMResumeParserTool(config?: Partial<LLMConfig>): LLMResumeParserTool {
  if (!llmResumeParserToolInstance) llmResumeParserToolInstance = new LLMResumeParserTool(config);
  return llmResumeParserToolInstance;
}

export function getLocalRuleParserTool(): LocalRuleParserTool {
  if (!localRuleParserToolInstance) localRuleParserToolInstance = new LocalRuleParserTool();
  return localRuleParserToolInstance;
}

export function getVisionStructuredParserTool(): VisionStructuredParserTool {
  if (!visionStructuredParserToolInstance) visionStructuredParserToolInstance = new VisionStructuredParserTool();
  return visionStructuredParserToolInstance;
}
