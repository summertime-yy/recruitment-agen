/* ============================================================
   工具函数
   ============================================================ */

import type { ThemeMode } from '../types';

/** 生成唯一 ID */
export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 格式化时间 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  if (isToday) return `${hh}:${mm}`;
  const MM = (d.getMonth() + 1).toString().padStart(2, '0');
  const DD = d.getDate().toString().padStart(2, '0');
  return `${MM}-${DD} ${hh}:${mm}`;
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

/** 截断文本 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

/** 获取主题实际模式 */
export function getEffectiveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

/** 延迟 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 状态标识颜色映射 */
export const stateColorMap: Record<string, string> = {
  IDLE: '#999',
  JD_GENERATING: '#f59e0b',
  JD_CONFIRMING: '#3b82f6',
  COLLECTING: '#07C160',
  SCREENING: '#f59e0b',
  SCREENING_RESULT: '#07C160',
};

/** 状态名称映射 */
export const stateNameMap: Record<string, string> = {
  IDLE: '待启动',
  JD_GENERATING: 'JD生成中',
  JD_CONFIRMING: '待确认JD',
  COLLECTING: '简历收集中',
  SCREENING: '筛选中',
  SCREENING_RESULT: '筛选完成',
};
