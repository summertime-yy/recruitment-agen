/* ============================================================
   意图识别规则引擎 — 独立于 AgentEngine 的可测试模块
   v1.1: 修复 5 个规则匹配缺陷
   ============================================================ */

import type { ConversationState, IntentType } from '../types';

/**
 * 基于规则匹配意图（不依赖 LLM）
 *
 * @param content - 用户消息（已去除 @提及）
 * @param currentState - 当前会话状态
 * @returns 识别到的意图，或 null（需降级到 LLM 或 FALLBACK）
 */
export function matchIntent(content: string, currentState: ConversationState): IntentType | null {
  // ──────── 简历修改检测（优先级最高，防止被 MODIFY_JD 误吞） ────────
  const resumeFieldPattern = /(?:姓名|年龄|学历|学校|院校|专业|工作年限|城市|所在地|技能|经历|简历|解析|手机号|邮箱)/;
  const modifyPattern = /修改|改成|改为|更正|纠正|调整|更新|加上|去掉|增加|减少|删除|添加|update|change|set|modify/i;
  if (resumeFieldPattern.test(content) && modifyPattern.test(content)) {
    return 'MODIFY_RESUME';
  }

  // ──────── JD 确认状态下 ────────
  if (currentState === 'JD_CONFIRMING') {
    // 短确认词 → 确认JD
    if (/^(确认|ok|就这样|没问题|可以|好的|行|好|是的|对|嗯|OK|Yes|Y)$/i.test(content.trim()) && content.length < 5) {
      return 'CONFIRM_JD';
    }
    // 包含修改意图 → 修改JD
    // 注意: 如果含简历字段，已被上面的 MODIFY_RESUME 拦截
    if (modifyPattern.test(content)) return 'MODIFY_JD';
  }

  // ──────── 筛选结果状态下 ────────
  if (currentState === 'SCREENING_RESULT') {
    const nameMatch = content.match(/查看\s*(.+?)\s*(的)?(详情|评分)/);
    if (nameMatch) return 'VIEW_DETAIL';
  }

  // ──────── 全局规则（优先级从高到低） ────────

  // 1. 查看详情/评分（先于筛选，因为 "查看评分" 含 "评分"）
  //    同时处理 "查看招聘进度" → 进度查询（含"招"但要优先匹配"进度"）
  if (/查看.*(详情|评分)/i.test(content)) {
    return 'VIEW_DETAIL';
  }

  // 1b. "看看这批" → 筛选（先于进度，因为 "看看这批怎么样" 含 "怎么样"）
  if (/看看这批/i.test(content)) {
    return 'SCREEN_RESUMES';
  }

  // 2. 进度查询（先于 JD 生成，因为 "招聘进度" 含 "招"）
  if (/进度|情况|怎么样|多少份|报告/i.test(content) && !/招|jd|岗位/i.test(content)) {
    return 'QUERY_PROGRESS';
  }

  // 2b. "查看.*进度" / "招聘.*进度" / "进度怎么样" → 含"招"但也有"进度"，优先进度
  if (/查看.*进度|招聘.*进度|招.*进度/.test(content)) {
    return 'QUERY_PROGRESS';
  }

  // 3. JD 生成
  if (/招|jd|岗位|招聘|hire/i.test(content) && !/进度|情况|怎么样/i.test(content) && !resumeFieldPattern.test(content)) {
    return 'GENERATE_JD';
  }

  // 4. 筛选评分
  if (/筛选|打分|打分|评分|看看这批/i.test(content) && !/查看/i.test(content)) {
    return 'SCREEN_RESUMES';
  }

  // 5. 长文本/文件引用 → 简历提交
  if (content.length > 200 || /\.(pdf|doc|docx)/i.test(content)) return 'SUBMIT_RESUME';

  // 6. JD 确认（仅 JD_CONFIRMING 状态 — 全局兜底）
  if (currentState === 'JD_CONFIRMING' &&
      /^(确认|ok|就这样|没问题|好的|行|好|是的|对|嗯)\s*$/i.test(content.trim()) && content.length < 10) {
    return 'CONFIRM_JD';
  }

  return null;
}
