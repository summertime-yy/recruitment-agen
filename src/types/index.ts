/* ============================================================
   智能招聘智能体 - 核心类型定义
   PRD v1.2 | MVP 最小闭环
   ============================================================ */

// === 会话状态机（PRD 7.2.1：6个状态） ===
export type ConversationState =
  | 'IDLE'               // 空闲，等待指令
  | 'JD_GENERATING'      // 正在生成JD
  | 'JD_CONFIRMING'      // JD已生成，等待确认
  | 'COLLECTING'         // 等待HR提交简历
  | 'SCREENING'          // 正在评分
  | 'SCREENING_RESULT';  // 报告已推送

// === 意图类型（PRD 4.2.1） ===
export type IntentType =
  | 'GENERATE_JD'
  | 'MODIFY_JD'
  | 'MODIFY_RESUME'
  | 'CONFIRM_JD'
  | 'SUBMIT_RESUME'
  | 'SCREEN_RESUMES'
  | 'QUERY_PROGRESS'
  | 'VIEW_DETAIL'
  | 'FALLBACK';

// === 岗位数据 ===
export interface JobPosition {
  id: string;
  title: string;
  department: string;
  location: string;
  reportTo: string;
  headcount: number;
  responsibilities: string[];
  hardRequirements: string[];
  bonusRequirements: string[];
  status: 'draft' | 'active' | 'closed';
  createdAt: number;
  resumeCount: number;
}

// === 简历解析结果（PRD US-2） ===
export interface ParsedResume {
  id: string;
  jobId: string;
  name: string;
  age?: number;
  degree: string;
  school: string;
  major: string;
  workYears: number;
  city: string;
  experiences: WorkExperience[];
  skills: string[];
  confidence: 'high' | 'medium' | 'low';
  parsedAt: number;
  fileName: string;
  /** 标记哪些关键字段解析失败（空），前端可显示"待补充" */
  missingFields?: string[];
  /** 【v1.4】原始简历文本 — 用于前端对照核查解析准确性 */
  originalText?: string;
  /** 【v1.4】原始文件类型 */
  sourceFileType?: 'pdf' | 'word' | 'txt';
}

export interface WorkExperience {
  role: string;
  company: string;
  period: string;
  duration: string;
}

// === 评分维度（PRD US-3：5维度，各0-20分） ===
export interface ScoreDimension {
  name: string;
  score: number;        // 0-20
  maxScore: number;     // 20
  reason: string;       // 评分理由
  matchedKeywords: string[];
  gaps: string[];
}

export interface CandidateScore {
  resumeId: string;
  candidateName: string;
  totalScore: number;   // 0-100
  dimensions: ScoreDimension[];
  highlight: string;
  rank?: number;
}

// === 筛选报告 ===
export interface ScreeningReport {
  jobId: string;
  jobTitle: string;
  totalResumes: number;
  scoredResumes: number;
  recommendedCount: number;
  topCandidates: CandidateScore[];
  generatedAt: number;
}

// === 进度摘要 ===
export interface ProgressSummary {
  jobId: string;
  jobTitle: string;
  state: ConversationState;
  jdGenerated: boolean;
  jdConfirmed: boolean;
  resumeCount: number;
  parsedCount: number;
  scoredCount: number;
  recommendedCount: number;
  lastOperation: string;
  lastOperator: string;
  lastOperatedAt: number;
}

// === 聊天消息 ===
export type MessageType = 'system' | 'user' | 'user_file' | 'bot_text' | 'bot_card';

export interface ChatMessage {
  id: string;
  type: MessageType;
  content: string;
  timestamp: number;
  sender?: string;
  file?: FileAttachment;
  cardType?: CardType;
  cardData?: unknown;
  quickActions?: QuickAction[];
}

export interface FileAttachment {
  name: string;
  size: string;
  type: 'pdf' | 'word' | 'image' | 'text';
}

export type CardType = 'jd' | 'resume_parse' | 'screening_report' | 'progress' | 'detail' | 'analysis' | 'error';

export interface QuickAction {
  label: string;
  action: string;
  primary?: boolean;
}

// === Agent 交互 ===
export interface AgentRequest {
  conversationId: string;
  groupId: string;
  message: string;
  state: ConversationState;
  context: ConversationContext;
}

export interface ConversationContext {
  currentJobId: string | null;
  jobs: JobPosition[];
  parsedResumes: ParsedResume[];
  pendingResume?: ParsedResume;
}

export interface AgentResponse {
  type: MessageType;
  content: string;
  cardType?: CardType;
  cardData?: unknown;
  quickActions?: QuickAction[];
  newState?: ConversationState;
  jobUpdate?: Partial<JobPosition>;
  resumeUpdate?: Partial<ParsedResume>;
}

// === 会话 ===
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  state: ConversationState;
  context: ConversationContext;
  createdAt: number;
  updatedAt: number;
}

// === 主题 ===
export type ThemeMode = 'light' | 'dark' | 'system';
