/* ============================================================
   LLM Client — OpenAI-compatible API 客户端
   支持 streaming、参数配置、错误处理
   ============================================================ */

// === LLM 配置类型 ===
export interface LLMConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;       // e.g. https://api.openai.com/v1
  model: string;          // e.g. gpt-4o-mini
  temperature: number;
  maxTokens: number;
  timeout: number;        // ms
}

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  enabled: false,
  apiKey: '',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seed-2-1-turbo-260628',
  temperature: 0.7,
  maxTokens: 4096,
  timeout: 60000,
};

// === LLM 消息格式 ===

/** 多模态内容块（Vision 模式） */
export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export type MultimodalContent = TextContent | ImageContent;

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  /** 纯文本模式用 string，多模态模式用 MultimodalContent[] */
  content: string | MultimodalContent[];
}

export interface LLMCallOptions {
  systemPrompt?: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface LLMStreamChunk {
  content: string;
  done: boolean;
}

// === 事件回调 ===
export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

// ============================================================
// LLM Client 类
// ============================================================
export class LLMClient {
  private config: LLMConfig;

  constructor(config: Partial<LLMConfig> = {}) {
    this.config = { ...DEFAULT_LLM_CONFIG, ...config };
  }

  /** 更新配置 */
  updateConfig(updates: Partial<LLMConfig>) {
    this.config = { ...this.config, ...updates };
  }

  /** 获取当前配置 */
  getConfig(): Readonly<LLMConfig> {
    return this.config;
  }

  /** 非流式调用 — 返回完整响应 */
  async complete(options: LLMCallOptions): Promise<string> {
    const messages: LLMMessage[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push(...options.messages);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: options.temperature ?? this.config.temperature,
          max_tokens: options.maxTokens ?? this.config.maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new LLMError(`LLM API error ${response.status}: ${errText}`, response.status);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      return content;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof LLMError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new LLMError('LLM request timed out', 408);
      }
      throw new LLMError(`LLM request failed: ${(err as Error).message}`, 0);
    }
  }

  /** 流式调用 — 通过回调返回增量文本 */
  async streamComplete(options: LLMCallOptions, callbacks: StreamCallbacks): Promise<string> {
    const messages: LLMMessage[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push(...options.messages);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: options.temperature ?? this.config.temperature,
          max_tokens: options.maxTokens ?? this.config.maxTokens,
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new LLMError(`LLM API error ${response.status}: ${errText}`, response.status);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new LLMError('No response body for streaming', 0);

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              callbacks.onToken?.(delta);
            }
          } catch {
            // 跳过无法解析的行
          }
        }
      }

      callbacks.onComplete?.(fullText);
      return fullText;

    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof LLMError) {
        callbacks.onError?.(err);
        throw err;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        const timeoutErr = new LLMError('LLM request timed out', 408);
        callbacks.onError?.(timeoutErr);
        throw timeoutErr;
      }
      const wrappedErr = new LLMError(`LLM request failed: ${(err as Error).message}`, 0);
      callbacks.onError?.(wrappedErr);
      throw wrappedErr;
    }
  }

  // ============================================================
  // Vision / 多模态方法
  // ============================================================

  /**
   * 使用 LLM Vision 能力解析扫描版简历
   * 将 PDF 页面图片作为多模态输入，直接让模型"看"简历图片
   *
   * @param pageImages - Base64 data URL 数组（来自 DocumentParser）
   * @param fileName - 原始文件名（用于上下文）
   */
  async parseResumeWithVision(pageImages: string[], fileName: string): Promise<string> {
    const imageContents: ImageContent[] = pageImages.map(url => ({
      type: 'image_url' as const,
      image_url: { url, detail: 'high' as const },
    }));

    const userContent: MultimodalContent[] = [
      { type: 'text', text: RESUME_VISION_PROMPT.replace('{fileName}', fileName) },
      ...imageContents,
    ];

    const messages: LLMMessage[] = [
      { role: 'system', content: RESUME_VISION_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.2,    // 低温度确保提取准确
          max_tokens: this.config.maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new LLMError(`Vision API error ${response.status}: ${errText}`, response.status);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      return content;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof LLMError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new LLMError('Vision request timed out', 408);
      }
      throw new LLMError(`Vision request failed: ${(err as Error).message}`, 0);
    }
  }

  /**
   * 检查当前配置的模型是否支持 Vision（多模态）
   * 已知支持 Vision 的模型：
   *   gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-4-vision-preview
   *   gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash
   *   claude-sonnet-4-*, claude-3-5-sonnet
   *   qwen-vl-*, qwen2.5-vl-*
   *   glm-4v, cogvlm-*
   *   deepseek-chat（部分版本支持）
   */
  supportsVision(): boolean {
    const model = this.config.model.toLowerCase();
    const visionModels = [
      'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision',
      'gemini', 'gemini-2', 'gemini-pro-vision',
      'claude-3-5', 'claude-sonnet-4', 'claude-3-opus',
      'qwen-vl', 'qwen2.5-vl',
      'glm-4v', 'cogvlm',
      'pixtral', 'llava',
    ];
    return visionModels.some(prefix => model.includes(prefix));
  }
}

// ============================================================
// LLM 错误类
// ============================================================
export class LLMError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'LLMError';
    this.statusCode = statusCode;
  }
}

// ============================================================
// 全局 LLM Client 单例
// ============================================================
let llmClientInstance: LLMClient | null = null;

export function getLLMClient(config?: Partial<LLMConfig>): LLMClient {
  if (!llmClientInstance) {
    llmClientInstance = new LLMClient(config);
  }
  if (config) {
    llmClientInstance.updateConfig(config);
  }
  return llmClientInstance;
}

export function resetLLMClient(): void {
  llmClientInstance = null;
}

// ============================================================
// 预设 prompts 工厂
// ============================================================

/** 意图识别 prompt */
export const INTENT_SYSTEM_PROMPT = `你是一个智能招聘助手的意图路由引擎。
分析用户消息，返回一个 JSON 对象，包含意图类型和提取的参数。

## 意图类型（intent字段只能是以下值之一）
- GENERATE_JD: 用户想生成或创建招聘岗位JD
- MODIFY_JD: 用户想修改已有的JD（地点、人数、技能要求等）
- MODIFY_RESUME: 用户想修改已解析简历的字段（姓名、学历、工作年限、学校等）
- CONFIRM_JD: 用户确认JD（"确认"、"OK"、"没问题"等）
- SUBMIT_RESUME: 用户发送了简历内容（较长文本、包含姓名/学历/经验等）
- SCREEN_RESUMES: 用户要求筛选、打分、评估候选人
- QUERY_PROGRESS: 用户查询招聘进度、状态
- VIEW_DETAIL: 用户想查看某个候选人的详细评分
- FALLBACK: 无法识别的意图

## 返回格式
必须严格返回以下 JSON 格式，不要包含 markdown 代码块标记：
{"intent": "GENERATE_JD", "params": {}}

## 参数提取（params字段）
- GENERATE_JD: {"jobTitle": "岗位名称", "skills": ["技能1"], "department": "部门", "location": "城市"}
- MODIFY_JD: {"changes": [{"field": "字段名", "newValue": "新值"}]}
- VIEW_DETAIL: {"candidateName": "候选人姓名"}
- 其他意图: {}`;

/** JD 生成 prompt 模板 */
export function getJDGeneratePrompt(userInput: string): string {
  return `你是一个专业的招聘JD撰写专家。根据用户描述，生成一份结构化的岗位JD。

## 要求
1. 提取或推导出岗位名称、核心技能、部门、地点等关键信息
2. 生成至少5条岗位职责
3. 生成至少3条硬性条件（学历、经验、技能等）
4. 生成至少2条加分项

## 返回格式
严格返回以下 JSON 格式，不要包含 markdown 代码块标记：
{
  "title": "岗位名称",
  "department": "部门名称",
  "location": "工作地点",
  "reportTo": "汇报对象",
  "headcount": <人数>,
  "responsibilities": ["职责1", "职责2", "职责3", "职责4", "职责5"],
  "hardRequirements": ["硬性条件1", "硬性条件2", "硬性条件3"],
  "bonusRequirements": ["加分项1", "加分项2"],
  "salaryRange": "薪资范围（可选）",
  "summary": "一句话岗位概述"
}

## 用户需求
${userInput}

请直接返回 JSON，不要包含任何解释。`;
}

/** 简历解析 prompt 模板 — v3: 零编造 + 原文留痕 + 噪声示例 */
export function getResumeParsePrompt(resumeText: string, sourceHint?: string): string {
  // LLM 层面截断：保留前 8000 字符
  const truncated = resumeText.length > 8000
    ? resumeText.slice(0, 8000) + '\n\n（内容过长，已截断前 8000 字符）'
    : resumeText;

  return `你是一个专业的简历信息提取器。你的唯一任务是从给定的简历文本中**精确提取**结构化字段。

## 🚨 铁律：只提取，不编造（最高优先级，违反即为失败）

**你绝对不能做的事：**
- ❌ 文本中没有姓名 → 禁止编造"张三""未知"或任何名字
- ❌ 文本中没有学历 → 禁止猜测"本科"（很多简历不写学历）
- ❌ 文本中出现"格式的通过驳回清单"等噪声 → 禁止把它当作学校名
- ❌ 工作经历少于2年 → 禁止 workYears 填 2 或更大
- ❌ 技能列表中只有 3 个技能 → 禁止补充到 5 个

**你只能做的事：**
- ✅ 从文本中**逐字定位**到对应字段，然后提取
- ✅ 无法定位 → 字符串字段留空 ""，数字字段填 0
- ✅ 不确定 → 留空 ""。宁可少提取，绝不编造

## 文本来源提醒
${sourceHint === 'pdf_text' ? '⚠️ 该文本由 PDF 提取工具生成，可能存在以下噪声：\n- 中文字符间多余空格（"姓 名 ： 张 三" 请合并为 "姓名：张三"）\n- 表格布局导致文本项换行断裂（"袁佳琪\\n男\\n25岁" 请按逻辑关系解析）\n- 页眉页脚残留文字（如 "第1页""个人简历"，请忽略）\n- 跨页词语被截断（"工作经\\n验" 请合并为 "工作经验"）\n- **非简历内容的噪声文本**（如"格式的通过驳回清单"这类系统界面文字混入）→ 必须忽略，不要当作简历字段\n- **当字段值明显不是人名/学校名/专业名时**（如字段值超过15字、包含"驳回""清单""格式"等非简历词汇）→ 该字段留空 ""\n' : sourceHint === 'docx' ? '该文本来自 Word 文档，格式通常较为规范，保留有表格和段落结构。' : '该文本为手动粘贴内容，格式可能包含换行和缩进。'}

## Few-Shot 示例（对照学习）

### 示例 1：标准中文简历 — 全部可提取
输入：
"姓名：袁佳琪
性别：男 | 年龄：25岁
学历：本科 | 专业：计算机科学与技术
毕业院校：南京大学
工作经历：
2021-07至2023-06 深圳腾讯科技有限公司 前端开发工程师
2023-07至今 北京字节跳动科技有限公司 高级前端工程师
技能：React TypeScript Node.js Webpack"

输出：
{"isResume":true,"name":"袁佳琪","age":25,"degree":"本科","school":"南京大学","major":"计算机科学与技术","workYears":5,"city":"北京","skills":["React","TypeScript","Node.js","Webpack"],"experiences":[{"role":"前端开发工程师","company":"深圳腾讯科技有限公司","period":"2021-07至2023-06","duration":"2年"},{"role":"高级前端工程师","company":"北京字节跳动科技有限公司","period":"2023-07至今","duration":"3年"}],"confidence":"high"}

### 示例 2：PDF 噪声文本 — 需去噪后提取
输入：
"个 人 简 历
第1页
袁 佳 琪 | 男 | 25 岁 | 本 科
南 京 大 学 | 计 算 机 科 学 与 技 术
工 作 经 历
2021-07 至 2023-06 深 圳 腾 讯 前 端 开 发 工 程 师
2023-07 至 今 字 节 跳 动 高 级 前 端 工 程 师
技 能：React TypeScript Webpack"

输出：
{"isResume":true,"name":"袁佳琪","age":25,"degree":"本科","school":"南京大学","major":"计算机科学与技术","workYears":5,"city":"深圳","skills":["React","TypeScript","Webpack"],"experiences":[{"role":"前端开发工程师","company":"深圳腾讯","period":"2021-07至2023-06","duration":"2年"},{"role":"高级前端工程师","company":"字节跳动","period":"2023-07至今","duration":"3年"}],"confidence":"medium"}

### 示例 3：应届生/实习简历
输入：
"个人简历
姓名：王小明
性别：男 | 年龄：22岁
学历：本科 | 专业：电子科学与技术
毕业院校：电子科技大学
实习经历：
2025-03至2025-06 深圳华为技术有限公司 芯片验证实习生
项目经验：
- 参与5G基带芯片验证，编写UVM测试用例
- 使用SystemVerilog完成覆盖率收集
技能：SystemVerilog UVM Verilog Python
语言：英语 CET-6"

输出：
{"isResume":true,"name":"王小明","age":22,"degree":"本科","school":"电子科技大学","major":"电子科学与技术","workYears":0,"city":"深圳","skills":["SystemVerilog","UVM","Verilog","Python"],"experiences":[{"role":"芯片验证实习生","company":"深圳华为技术有限公司","period":"2025-03至2025-06","duration":"3个月"}],"confidence":"high"}

### 🆕 示例 4：噪声严重/字段缺失 — 宁可留空不编造
输入：
"个人简历
姓名：
性别：男
学历：
毕业院校：格式的通过驳回清单。华中师范大学
专业：软件工程
工作经历：
2019-09 - 2023 某科技公司 开发工程师
技能：Python Java R Vue HTML Spring Boot MySQL PCB Office XMind"

输出：
{"isResume":true,"name":"","age":0,"degree":"","school":"华中师范大学","major":"软件工程","workYears":4,"city":"","skills":["Python","Java","R","Vue","HTML","Spring Boot","MySQL"],"experiences":[{"role":"开发工程师","company":"","period":"2019-09至2023","duration":"4年"}],"confidence":"low"}

**解析要点说明：**
- name: 文本中"姓名："后为空 → 留空 ""
- age: 无年龄信息 → 0
- degree: "学历："后为空 → 留空 ""
- school: "格式的通过驳回清单。"是噪声文本 → 跳过，只提取"华中师范大学"
- skills: 只保留技术技能 → Python, Java, R, Vue, HTML, Spring Boot, MySQL
  (Office/XMind 非核心技术栈技能 → 不纳入)
- company: "某科技公司"过于模糊，不是真实公司名 → 留空 ""
- workYears: 2019-09 至 2023 = 4年（逐段累加）
  **注意**：不要用 "当前年份 - 最早年份" 计算！
- confidence: 姓名+学历缺失 → "low"

## 提取字段说明（每个字段附无法确认时的处理）

- **name**: 姓名（2-4个中文字符，或英文全名）。PDF 文本中的空格分词请自行合并。
  **无法确认时**：留空 "" ← 不要编"张三""未知"
- **age**: 年龄（数字），可从前缀 "年龄：25" / "25岁" / "男25岁" 中提取，或从出生年份推断。
  **无法确认时**：填 0 ← 不要编 25
- **degree**: 最高学历（博士/硕士/本科/大专/高中）。如文本仅出现"学士"或"Bachelor" → "本科"。
  **无法确认时**：留空 "" ← 不要猜测"本科"
- **school**: 毕业院校全称（如 "南京大学"）。**关键规则**：学校名应≤15个字符。如果提取出的值包含"驳回""清单""格式""通过"等非学校名词汇 → 这是噪声，需要从噪声中提取真正的学校名；如果无法分离 → 留空 ""。
  **无法确认时**：留空 "" ← 禁止填充噪声文本
- **major**: 专业全称。
  **无法确认时**：留空 ""
- **workYears**: 工作年限（数字）。**必须从工作经历各段时长逐段累加计算**（例: 2021-07至2023-06 = 2年 + 2023-07至今 = 3年 = 5年）。**禁止**用"当前年份 - 最早年份"（会高估）。如果只有实习（<1年），填 0。
  **无法确认时**：填 0
- **city**: 现居/期望城市。从"所在地""现居""城市："字段或最近工作经历的城市中推断。
  **无法确认时**：留空 ""
- **skills**: 技能标签数组。**只提取明确列出的技术栈技能**（编程语言/框架/工具/数据库/云平台等），不提取通用办公软件（如 Office/Word/Excel/PPT/XMind/Visio/Photoshop 等设计或办公工具）。
  **无法确认时**：空数组 []
- **experiences**: 工作经历数组。每段提取 role/company/period/duration。最多提取最近 3 段。
  **company 规则**：如果公司名包含"某""某某""一家""某个"等占位词 → 留空 ""（不是真实公司名）
  **无法确认时**：空数组 []
- **confidence**: 解析置信度。high=姓名+学历+学校+2段以上经历均提取成功；medium=部分字段缺失；low=姓名或学历缺失，或多个字段为噪声

## 输出格式（严格遵守，违反则解析失败）

**你只能回复一行 JSON 对象。** 不要包含以下任何内容：
- ❌ markdown 代码块标记（\`\`\`json 和 \`\`\`）
- ❌ 解释文字（"好的，以下是解析结果"、"根据简历内容" 等）
- ❌ 中文标点作为 JSON 语法（全角引号 ""、全角冒号 ：、全角逗号 ，）
- ❌ 尾随逗号

✅ 只回复：
{"isResume":true,"name":"张三","age":25,"degree":"硕士","school":"清华大学","major":"计算机科学与技术","workYears":3,"city":"北京","skills":["Python","Java"],"experiences":[{"role":"开发工程师","company":"某科技公司","period":"2021-07至2024-06","duration":"3年"}],"confidence":"high"}

如果内容明显不是简历（如纯数字、纯代码、聊天记录），只回复：
{"isResume":false}

## 待解析简历内容
${truncated}

只回复 JSON，不要回复其他任何内容。`;
}

/** 筛选评分 prompt 模板 */
export function getScreeningPrompt(jobTitle: string, requirements: string[], resumes: string): string {
  return `你是一个专业的招聘筛选专家。根据岗位JD对候选人简历进行五维度评分。

## 评分维度（各0-20分，总计100分）
1. 技能匹配度：候选人的硬技能与岗位要求的匹配程度
2. 经验匹配度：工作年限、行业背景与岗位的匹配程度
3. 学历匹配度：学历、专业与岗位要求的匹配程度
4. 项目匹配度：过往项目经验与岗位职责的匹配程度
5. 稳定性：职业连贯性、跳槽频率

## 岗位信息
岗位：${jobTitle}
硬性要求：${requirements.join('；')}

## 候选人简历
${resumes}

## 返回格式
严格返回以下 JSON 格式，不要包含 markdown 代码块标记：
{
  "candidates": [
    {
      "name": "候选人姓名",
      "totalScore": 85,
      "dimensions": [
        {"name": "技能匹配度", "score": 18, "reason": "评分理由", "matchedKeywords": ["..."], "gaps": ["..."]},
        {"name": "经验匹配度", "score": 17, "reason": "评分理由", "matchedKeywords": [], "gaps": []},
        {"name": "学历匹配度", "score": 16, "reason": "评分理由", "matchedKeywords": [], "gaps": []},
        {"name": "项目匹配度", "score": 17, "reason": "评分理由", "matchedKeywords": [], "gaps": []},
        {"name": "稳定性", "score": 17, "reason": "评分理由", "matchedKeywords": [], "gaps": []}
      ],
      "highlight": "一句话亮点总结"
    }
  ],
  "recommendedCount": 3,
  "summary": "整体评价"
}

请确保评分客观公正，按总分从高到低排序。直接返回 JSON，不要包含任何解释。`;
}

/** 进度查询 prompt 模板 */
export function getProgressPrompt(context: string): string {
  return `你是一个招聘进度管理专家。根据当前招聘状态，生成进度摘要和下一步建议。

## 当前状态
${context}

## 返回格式
严格返回以下 JSON 格式，不要包含 markdown 代码块标记：
{
  "stateDescription": "状态描述",
  "nextAction": "下一步建议",
  "actionLabel": "建议操作按钮文字",
  "actionType": "操作类型（SCREEN_RESUMES/UPLOAD_RESUME/VIEW_DETAIL/NONE）",
  "healthCheck": "整体评价（good/warning/critical）"
}`;
}

/** 详情评分 prompt 模板 */
export function getDetailPrompt(candidateInfo: string, jobTitle: string): string {
  return `你是一个专业的招聘评估专家。请对候选人的综合匹配度进行五维度详细评分。

## 候选人信息
${candidateInfo}

## 目标岗位
${jobTitle}

## 返回格式
严格返回以下 JSON 格式，不要包含 markdown 代码块标记：
{
  "candidateName": "姓名",
  "totalScore": 85,
  "dimensions": [
    {"name": "技能匹配度", "score": 18, "maxScore": 20, "reason": "详细理由", "matchedKeywords": ["..."], "gaps": ["..."]},
    {"name": "经验匹配度", "score": 17, "maxScore": 20, "reason": "详细理由", "matchedKeywords": [], "gaps": []},
    {"name": "学历匹配度", "score": 16, "maxScore": 20, "reason": "详细理由", "matchedKeywords": [], "gaps": []},
    {"name": "项目匹配度", "score": 17, "maxScore": 20, "reason": "详细理由", "matchedKeywords": [], "gaps": []},
    {"name": "稳定性", "score": 17, "maxScore": 20, "reason": "详细理由", "matchedKeywords": [], "gaps": []}
  ],
  "summary": "综合建议总结（一句话）",
  "recommendationLevel": "推荐面试/可考虑/暂不推荐"
}`;
}

// ============================================================
// Vision / 多模态 prompts
// ============================================================

/** Vision 简历解析 — 系统提示 */
export const RESUME_VISION_SYSTEM_PROMPT = `你是一个专业的简历解析专家。你将看到一份扫描版简历的图片，请从中提取所有关键信息。

## 需要提取的字段
- 姓名（如需脱敏，中间字用*替换）
- 性别（如果有）
- 年龄/出生年月
- 最高学历：博士/硕士/本科/大专/高中
- 毕业院校
- 专业
- 工作年限（数字，根据经历推断）
- 当前/期望城市
- 手机/邮箱（如果有，注意脱敏）
- 技能标签列表
- 工作经历（每条包含：公司名、职位、时间范围、主要职责/成就）
- 教育经历（每条包含：学校、学历、专业、时间）
- 项目经历（如果有）
- 证书/语言能力

## 重要提示
1. 仔细识别图片中的每一个文字
2. 如果某些信息不明确或无法确定，标注为"未知"而非编造
3. 工作经历按时间倒序排列

## 输出格式
请直接输出结构清晰的纯文本，如下格式：

姓名：xxx
学历：xx | xx大学 | xx专业
工作年限：x年
城市：xx
技能：xxx, xxx, xxx

工作经历：
- 职位 | 公司 | 2020.06-至今 | 主要职责...
- 职位 | 公司 | 2018.03-2020.05 | 主要职责...

教育经历：
- 硕士 | xx大学 | xx专业 | 2015-2018
- 本科 | xx大学 | xx专业 | 2011-2015

请直接输出以上格式的文本，不要包含额外的解释或说明。`;

/** Vision 简历解析 — 用户提示模板 */
export const RESUME_VISION_PROMPT = `请解析以下扫描版简历图片的文字内容。文件名：{fileName}

请严格按照系统提示的格式输出所有可识别信息。如果文字模糊或无法辨认的部分，标注"模糊/无法识别"。`;

