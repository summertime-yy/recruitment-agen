/* ============================================================
   IntentRouterStep — 意图识别 Step (P1 修复 C-3)

   职责:
     1. 解析用户消息，识别意图 (GENERATE_JD / SUBMIT_RESUME 等)
     2. 将识别的意图写入 ctx.intent
     3. 规则优先 + LLM 兜底

   迁移来源: agent-engine.ts → recognizeIntent() + ruleBasedIntent()
   ============================================================ */

import { BaseStep } from './base';
import type { PipelineContext, StepResult } from '../types';
import type { IntentType, ConversationState } from '../../types';
import { logger } from '../../lib/logger';

export class IntentRouterStep extends BaseStep {
  constructor() {
    super({
      name: 'intent-router',
      description: '解析用户消息，识别意图类型',
      dependencies: [],
      onError: 'skip', // 意图识别失败不应阻塞流程，降级到 FALLBACK
    });
  }

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const cleanMessage = ctx.userMessage.replace(/@招聘助手|@招聘机器人|@recruit/gi, '').trim();

    // 优先级1: 基于规则的快速匹配
    const ruleIntent = this.ruleBasedIntent(cleanMessage, ctx.state);
    if (ruleIntent) {
      ctx.intent = ruleIntent;
      logger.debug('intent-router', `rule match: ${ruleIntent}`);
      return this.ok({ method: 'rule', intent: ruleIntent });
    }

    // 优先级2: LLM 增强识别（TODO: 接入 LLM 客户端）
    // 当前阶段: 规则未命中 → FALLBACK
    ctx.intent = 'FALLBACK';
    logger.debug('intent-router', 'no rule match, fallback');
    ctx.logs.push({ step: this.name, level: 'debug', message: 'No rule match → FALLBACK' });
    return this.ok({ method: 'fallback', intent: 'FALLBACK' });
  }

  /** 规则匹配：保持与 agent-engine.ts 一致的逻辑 */
  private ruleBasedIntent(content: string, state: ConversationState): IntentType | null {
    if (state === 'JD_CONFIRMING') {
      if (/确认|ok|就这样|没问题|可以/.test(content) && content.length < 5) return 'CONFIRM_JD';
      if (/修改|改成|加上|去掉|调整/.test(content)) return 'MODIFY_JD';
    }
    if (state === 'SCREENING_RESULT') {
      const nameMatch = content.match(/查看\s*(.+?)\s*(的)?(详情|评分)/);
      if (nameMatch) return 'VIEW_DETAIL';
    }
    if (/招|jd|岗位|招聘|hire/i.test(content) && !/进度|情况|怎么样/i.test(content)) return 'GENERATE_JD';
    if (/筛选|打分|评分|看看这批/i.test(content)) return 'SCREEN_RESUMES';
    if (/进度|情况|怎么样|多少份|报告/i.test(content) && !/招|jd|岗位/i.test(content)) return 'QUERY_PROGRESS';
    if (/查看.*(详情|评分)/i.test(content)) return 'VIEW_DETAIL';
    if (content.length > 200 || /\.(pdf|doc|docx)/i.test(content)) return 'SUBMIT_RESUME';
    if (/确认|ok|就这样|没问题/.test(content) && content.length < 10) return 'CONFIRM_JD';
    return null;
  }
}
