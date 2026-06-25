/* ============================================================
   Zustand 全局状态管理
   管理：会话列表、消息、状态机、岗位、简历、UI状态
   ============================================================ */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ConversationState, ChatMessage, JobPosition, ParsedResume,
  ConversationContext, ThemeMode, QuickAction, CandidateScore,
} from '../types';
import { canTransition } from '../lib/state-machine';

export interface RecruitmentStore {
  // === 会话 ===
  conversationId: string;
  messages: ChatMessage[];
  state: ConversationState;

  // === 岗位管理 ===
  jobs: JobPosition[];
  currentJobId: string | null;
  pendingResume: ParsedResume | null;

  // === 简历管理 ===
  parsedResumes: ParsedResume[];
  screeningResult: {
    totalResumes: number;
    scoredResumes: number;
    recommendedCount: number;
    topCandidates: CandidateScore[];
    generatedAt: number;
  } | null;

  // === UI 状态 ===
  theme: ThemeMode;
  isTyping: boolean;
  showFilePicker: boolean;
  quickActions: QuickAction[];
  sidebarOpen: boolean;
  /** Sidebar 快捷操作触发的待处理动作文本（ChatInput 侦听处理） */
  sceneAction: string | null;

  // === Actions ===
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  setTyping: (typing: boolean) => void;
  setState: (state: ConversationState) => void;
  setTheme: (theme: ThemeMode) => void;

  // 岗位操作
  addJob: (job: JobPosition) => void;
  updateJob: (jobId: string, updates: Partial<JobPosition>) => void;
  setCurrentJob: (jobId: string | null) => void;

  // 简历操作
  addResume: (resume: ParsedResume) => void;
  assignResumeToJob: (resumeId: string, jobId: string) => void;
  setPendingResume: (resume: ParsedResume | null) => void;

  // 筛选
  setScreeningResult: (result: RecruitmentStore['screeningResult']) => void;

  // UI actions
  setQuickActions: (actions: QuickAction[]) => void;
  setShowFilePicker: (show: boolean) => void;
  toggleSidebar: () => void;
  /** Sidebar 快捷操作触发 */
  triggerSceneAction: (text: string) => void;
  clearSceneAction: () => void;

  // 重置
  reset: () => void;

  // 获取上下文
  getContext: () => ConversationContext;
}

const initialState = {
  conversationId: 'conv_' + Date.now(),
  messages: [] as ChatMessage[],
  state: 'IDLE' as ConversationState,
  jobs: [] as JobPosition[],
  currentJobId: null as string | null,
  pendingResume: null as ParsedResume | null,
  parsedResumes: [] as ParsedResume[],
  screeningResult: null as RecruitmentStore['screeningResult'],
  theme: 'system' as ThemeMode,
  isTyping: false,
  showFilePicker: false,
  quickActions: [] as QuickAction[],
  sidebarOpen: true,
  sceneAction: null as string | null,
};

export const useRecruitmentStore = create<RecruitmentStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addMessage: (msg) => {
        const newMsg: ChatMessage = {
          ...msg,
          id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          timestamp: Date.now(),
        };
        set(state => ({ messages: [...state.messages, newMsg] }));
      },

      setTyping: (typing) => set({ isTyping: typing }),

      setState: (newState) => {
        // P1 修复 (B-5): 状态转换校验
        const currentState = get().state;
        const result = canTransition(currentState, newState);
        if (!result.allowed) {
          console.warn(`[Store.setState] ${result.reason} (当前: ${currentState}, 目标: ${newState})`);
          // 开发阶段记录警告但允许转换，避免硬阻断导致用户卡死
          // 生产环境可切换为严格拦截
        }
        set({ state: newState });
      },

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },

      addJob: (job) => {
        set(state => ({
          jobs: [...state.jobs, job],
          currentJobId: job.id,
        }));
      },

      updateJob: (jobId, updates) => {
        set(state => ({
          jobs: state.jobs.map(j => j.id === jobId ? { ...j, ...updates } : j),
        }));
      },

      setCurrentJob: (jobId) => set({ currentJobId: jobId }),

      addResume: (resume) => {
        set(state => ({
          parsedResumes: [...state.parsedResumes, resume],
          pendingResume: null,
        }));
      },

      assignResumeToJob: (resumeId, jobId) => {
        set(state => {
          const updatedResumes = state.parsedResumes.map(r =>
            r.id === resumeId ? { ...r, jobId } : r
          );
          const jobResumes = updatedResumes.filter(r => r.jobId === jobId);
          return {
            parsedResumes: updatedResumes,
            jobs: state.jobs.map(j =>
              j.id === jobId ? { ...j, resumeCount: jobResumes.length } : j
            ),
          };
        });
      },

      setPendingResume: (resume) => set({ pendingResume: resume }),

      setScreeningResult: (result) => set({ screeningResult: result }),

      setQuickActions: (actions) => set({ quickActions: actions }),

      setShowFilePicker: (show) => set({ showFilePicker: show }),

      toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),

      triggerSceneAction: (text) => set({ sceneAction: text }),

      clearSceneAction: () => set({ sceneAction: null }),

      reset: () => {
        set({
          ...initialState,
          conversationId: 'conv_' + Date.now(),
          theme: get().theme,
        });
      },

      getContext: () => {
        const state = get();
        return {
          currentJobId: state.currentJobId,
          jobs: state.jobs,
          parsedResumes: state.parsedResumes,
          pendingResume: state.pendingResume || undefined,
        };
      },
    }),
    {
      name: 'recruitment-agent-storage',
      partialize: (state) => ({
        messages: state.messages.slice(-200), // 只持久化最近200条消息
        state: state.state,
        jobs: state.jobs,
        currentJobId: state.currentJobId,
        parsedResumes: state.parsedResumes,
        screeningResult: state.screeningResult,
        theme: state.theme,
        conversationId: state.conversationId,
      }),
    }
  )
);

// 应用主题
function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', isDark);
}

// 初始化主题
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('recruitment-agent-storage');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.state?.theme) {
        applyTheme(parsed.state.theme);
      }
    } catch { /* ignore */ }
  }
}
