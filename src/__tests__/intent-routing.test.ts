/* ============================================================
   测试套件: 意图识别规则引擎 (intent-rules.ts)
   覆盖: 所有状态×意图组合、中英文混合、边界输入
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { matchIntent } from '../lib/intent-rules';
import type { ConversationState } from '../types';

// ============================================================
// 1. 简历修改意图 = 最高优先级
// ============================================================
describe('意图识别 — MODIFY_RESUME (最高优先级)', () => {
  const states: ConversationState[] = ['IDLE', 'JD_GENERATING', 'JD_CONFIRMING', 'COLLECTING', 'SCREENING', 'SCREENING_RESULT'];

  const modifyResumeInputs = [
    '修改姓名：周宇瑞；工作年限：0',
    '更正学历为硕士，姓名改为李四',
    '调整工作年限为5年',
    '更新学校信息为清华大学',
    '修改专业：计算机科学',
    '修改技能：增加 Python 和 Java',
    '纠正城市信息，应该是深圳',
    '修改简历中的经历',
    '调整年龄为28岁',
  ];

  states.forEach(state => {
    modifyResumeInputs.forEach(input => {
      it(`[${state}] "${input.slice(0, 30)}..." → MODIFY_RESUME`, () => {
        expect(matchIntent(input, state)).toBe('MODIFY_RESUME');
      });
    });
  });

  it('仅有修改词但不含简历字段 → 不应匹配 MODIFY_RESUME', () => {
    expect(matchIntent('修改一下JD，地点改成深圳', 'JD_CONFIRMING')).not.toBe('MODIFY_RESUME');
  });

  it('仅有简历字段但无修改词 → 不应匹配 MODIFY_RESUME', () => {
    expect(matchIntent('姓名：张三，学历硕士', 'IDLE')).toBeNull();
  });
});

// ============================================================
// 2. JD 确认 → 修改JD（仅 JD_CONFIRMING 状态）
// ============================================================
describe('意图识别 — MODIFY_JD (JD_CONFIRMING状态)', () => {
  it('修改地点 → MODIFY_JD', () => {
    expect(matchIntent('把JD地点改成深圳', 'JD_CONFIRMING')).toBe('MODIFY_JD');
  });

  it('加上技能要求 → MODIFY_JD', () => {
    expect(matchIntent('加上Python要求', 'JD_CONFIRMING')).toBe('MODIFY_JD');
  });

  it('调整人数 → MODIFY_JD', () => {
    expect(matchIntent('调整人数为3人', 'JD_CONFIRMING')).toBe('MODIFY_JD');
  });

  it('非 JD_CONFIRMING 状态下的修改词 → 不返回 MODIFY_JD', () => {
    expect(matchIntent('加上Python要求', 'IDLE')).toBeNull();
  });
});

// ============================================================
// 3. JD 确认（短确认词）
// ============================================================
describe('意图识别 — CONFIRM_JD', () => {
  const confirmInputs = ['确认', '好的', '行', 'OK', '没问题', '可以', 'Yes'];

  confirmInputs.forEach(input => {
    it(`[JD_CONFIRMING] "${input}" → CONFIRM_JD`, () => {
      expect(matchIntent(input, 'JD_CONFIRMING')).toBe('CONFIRM_JD');
    });
  });

  it('确认词长度 >= 10 → 不返回 CONFIRM_JD', () => {
    expect(matchIntent('确认没问题就这样吧我觉得可以了', 'JD_CONFIRMING')).toBeNull();
  });

  it('非 JD_CONFIRMING 状态下的确认 → 应返回 null（让LLM处理）', () => {
    expect(matchIntent('确认', 'IDLE')).toBeNull();
  });
});

// ============================================================
// 4. JD 生成
// ============================================================
describe('意图识别 — GENERATE_JD', () => {
  const jdInputs = [
    '帮我招一个前端开发',
    '招聘一名芯片验证工程师',
    '生成JD：AI产品经理',
    'hire a software engineer',
    '新岗位：数据分析师',
  ];

  jdInputs.forEach(input => {
    it(`"${input}" → GENERATE_JD`, () => {
      expect(matchIntent(input, 'IDLE')).toBe('GENERATE_JD');
    });
  });

  it('含"招"和"进度" → 应返回 QUERY_PROGRESS（优先进度）', () => {
    expect(matchIntent('招聘进度怎么样', 'IDLE')).toBe('QUERY_PROGRESS');
  });
});

// ============================================================
// 5. 筛选评分
// ============================================================
describe('意图识别 — SCREEN_RESUMES', () => {
  it('筛选 → SCREEN_RESUMES', () => {
    expect(matchIntent('开始筛选', 'COLLECTING')).toBe('SCREEN_RESUMES');
  });

  it('评分 → SCREEN_RESUMES', () => {
    expect(matchIntent('给这些简历打分', 'COLLECTING')).toBe('SCREEN_RESUMES');
  });

  it('看看这批 → SCREEN_RESUMES', () => {
    expect(matchIntent('看看这批怎么样', 'COLLECTING')).toBe('SCREEN_RESUMES');
  });
});

// ============================================================
// 6. 进度查询
// ============================================================
describe('意图识别 — QUERY_PROGRESS', () => {
  it('查看进度 → QUERY_PROGRESS', () => {
    expect(matchIntent('查看招聘进度', 'COLLECTING')).toBe('QUERY_PROGRESS');
  });

  it('多少份 → QUERY_PROGRESS', () => {
    expect(matchIntent('现在收到多少份简历了', 'COLLECTING')).toBe('QUERY_PROGRESS');
  });

  it('情况怎么样 → QUERY_PROGRESS', () => {
    expect(matchIntent('情况怎么样', 'SCREENING_RESULT')).toBe('QUERY_PROGRESS');
  });
});

// ============================================================
// 7. 查看详情
// ============================================================
describe('意图识别 — VIEW_DETAIL', () => {
  it('[SCREENING_RESULT] 查看某人详情 → VIEW_DETAIL', () => {
    expect(matchIntent('查看张三的详情', 'SCREENING_RESULT')).toBe('VIEW_DETAIL');
  });

  it('查看评分 → VIEW_DETAIL', () => {
    expect(matchIntent('查看评分', 'IDLE')).toBe('VIEW_DETAIL');
  });
});

// ============================================================
// 8. 提交简历
// ============================================================
describe('意图识别 — SUBMIT_RESUME', () => {
  it('长文本(>200字符) → SUBMIT_RESUME', () => {
    const longText = 'A'.repeat(201);
    expect(matchIntent(longText, 'IDLE')).toBe('SUBMIT_RESUME');
  });

  it('短文本(<200字符) → 不返回SUBMIT_RESUME', () => {
    expect(matchIntent('这是一个短消息', 'IDLE')).toBeNull();
  });
});

// ============================================================
// 9. 边界/异常输入
// ============================================================
describe('意图识别 — 边界与异常输入', () => {
  it('空字符串 → null', () => {
    expect(matchIntent('', 'IDLE')).toBeNull();
  });

  it('纯标点 → null', () => {
    expect(matchIntent('...', 'IDLE')).toBeNull();
  });

  it('纯数字 → null', () => {
    expect(matchIntent('12345', 'IDLE')).toBeNull();
  });

  it('超长输入但不匹配任何规则 → null', () => {
    const veryLong = 'X'.repeat(10000);
    expect(matchIntent(veryLong, 'IDLE')).toBe('SUBMIT_RESUME');
  });

  it('含换行符和特殊字符的输入', () => {
    const messyInput = '招\r\n前端\n工程师\t高级';
    expect(matchIntent(messyInput, 'IDLE')).toBe('GENERATE_JD');
  });
});

// ============================================================
// 10. 中英文混合
// ============================================================
describe('意图识别 — 中英混合', () => {
  it('中英混合修改简历', () => {
    expect(matchIntent('update 姓名为 Zhang San', 'IDLE')).toBe('MODIFY_RESUME');
  });

  it('英文JD生成 → GENERATE_JD', () => {
    expect(matchIntent('I want to hire a senior frontend developer', 'IDLE')).toBe('GENERATE_JD');
  });

  it('中英混合招聘意图', () => {
    expect(matchIntent('招聘一名 Senior Golang 后端开发', 'IDLE')).toBe('GENERATE_JD');
  });
});

// ============================================================
// 11. 已知问题回归测试
// ============================================================
describe('意图识别 — 已知问题回归', () => {
  it('修复#1: "修改姓名周宇瑞" 不应路由到 MODIFY_JD', () => {
    expect(matchIntent('修改姓名：周宇瑞；工作年限：0', 'IDLE')).toBe('MODIFY_RESUME');
    expect(matchIntent('修改姓名：周宇瑞；工作年限：0', 'JD_CONFIRMING')).toBe('MODIFY_RESUME');
  });

  it('修复#2: JD_CONFIRMING下的纯简历修改不应被MODIFY_JD拦截', () => {
    expect(matchIntent('修改学历为硕士', 'JD_CONFIRMING')).toBe('MODIFY_RESUME');
  });

  it('修复#3: 短确认词在JD_CONFIRMING状态正确识别', () => {
    expect(matchIntent('OK', 'JD_CONFIRMING')).toBe('CONFIRM_JD');
  });
});
