/* ============================================================
   状态机模块 — 会话状态转换规则 (P1 修复 B-4)

   核心职责:
     1. 定义合法状态转换矩阵 (VALID_TRANSITIONS)
     2. 提供 canTransition() 校验函数
     3. 在非法转换时给出诊断信息

   使用方式:
     - recruitmentStore.ts 的 setState 调用 canTransition 做前置校验
     - 防止状态卡死和无效转换
   ============================================================ */

import type { ConversationState } from '../types';

// ============================================================
// 状态转换矩阵
// ============================================================

/** 每个状态允许转换到的目标状态集合 */
export const VALID_TRANSITIONS: Record<ConversationState, ReadonlySet<ConversationState>> = {
  IDLE: new Set<ConversationState>([
    'JD_GENERATING',  // 用户开始生成JD
    'COLLECTING',      // 用户直接提交简历（跳过JD）
  ]),

  JD_GENERATING: new Set<ConversationState>([
    'JD_CONFIRMING',   // JD生成成功，等待确认
    'IDLE',            // 异常/重置
  ]),

  JD_CONFIRMING: new Set<ConversationState>([
    'JD_GENERATING',   // 用户修改JD → 重新生成
    'COLLECTING',      // 用户确认JD → 进入简历收集
    'IDLE',            // 异常/重置
  ]),

  COLLECTING: new Set<ConversationState>([
    'SCREENING',       // 触发筛选评分
    'JD_GENERATING',   // 重新生成JD
    'SCREENING_RESULT', // 已有筛选结果可查
    'IDLE',            // 异常/重置
  ]),

  SCREENING: new Set<ConversationState>([
    'SCREENING_RESULT', // 评分完成
    'IDLE',             // 异常/重置
  ]),

  SCREENING_RESULT: new Set<ConversationState>([
    'COLLECTING',      // 继续添加简历
    'SCREENING',       // 重新筛选
    'JD_GENERATING',   // 新建岗位
    'IDLE',            // 异常/重置
  ]),
};

// ============================================================
// 状态转换校验
// ============================================================

export interface TransitionResult {
  allowed: boolean;
  /** 非法转换时的诊断消息 */
  reason?: string;
}

/**
 * 校验状态转换是否合法
 *
 * @param from - 当前状态
 * @param to - 目标状态
 * @returns 校验结果（允许/拒绝 + 原因）
 */
export function canTransition(from: ConversationState, to: ConversationState): TransitionResult {
  // 同一状态 → 无害，允许（避免重复 setState 触发报警）
  if (from === to) {
    return { allowed: true };
  }

  const allowedTargets = VALID_TRANSITIONS[from];

  if (!allowedTargets) {
    return {
      allowed: false,
      reason: `未知当前状态 '${from}'`,
    };
  }

  if (allowedTargets.has(to)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `非法状态转换: ${from} → ${to}。允许的目标状态: ${[...allowedTargets].join(', ')}`,
  };
}

/**
 * 获取某状态的所有合法目标状态（用于 UI 和调试）
 */
export function getAllowedTargets(from: ConversationState): ConversationState[] {
  const targets = VALID_TRANSITIONS[from];
  return targets ? [...targets] : [];
}

/**
 * 生成状态转换矩阵的人类可读描述（用于文档）
 */
export function describeTransitions(): string {
  return Object.entries(VALID_TRANSITIONS)
    .map(([from, targets]) => `${from} → ${[...targets].join(' | ')}`)
    .join('\n');
}
