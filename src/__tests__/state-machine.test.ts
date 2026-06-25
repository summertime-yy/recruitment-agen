/* ============================================================
   测试套件: 会话状态机 (state-machine.ts)
   覆盖: 所有合法/非法转换、边界条件
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { canTransition, getAllowedTargets, describeTransitions, VALID_TRANSITIONS } from '../lib/state-machine';
import type { ConversationState } from '../types';

const ALL_STATES: ConversationState[] = [
  'IDLE', 'JD_GENERATING', 'JD_CONFIRMING',
  'COLLECTING', 'SCREENING', 'SCREENING_RESULT',
];

// ============================================================
// 1. 合法转换测试
// ============================================================
describe('状态机 — 合法转换', () => {
  it('IDLE → JD_GENERATING (生成JD)', () => {
    expect(canTransition('IDLE', 'JD_GENERATING').allowed).toBe(true);
  });

  it('IDLE → COLLECTING (直接提交简历)', () => {
    expect(canTransition('IDLE', 'COLLECTING').allowed).toBe(true);
  });

  it('JD_GENERATING → JD_CONFIRMING (JD生成成功)', () => {
    expect(canTransition('JD_GENERATING', 'JD_CONFIRMING').allowed).toBe(true);
  });

  it('JD_GENERATING → IDLE (异常重置)', () => {
    expect(canTransition('JD_GENERATING', 'IDLE').allowed).toBe(true);
  });

  it('JD_CONFIRMING → JD_GENERATING (修改JD重生成)', () => {
    expect(canTransition('JD_CONFIRMING', 'JD_GENERATING').allowed).toBe(true);
  });

  it('JD_CONFIRMING → COLLECTING (确认JD进入简历)', () => {
    expect(canTransition('JD_CONFIRMING', 'COLLECTING').allowed).toBe(true);
  });

  it('COLLECTING → SCREENING (触发筛选)', () => {
    expect(canTransition('COLLECTING', 'SCREENING').allowed).toBe(true);
  });

  it('SCREENING → SCREENING_RESULT (评分完成)', () => {
    expect(canTransition('SCREENING', 'SCREENING_RESULT').allowed).toBe(true);
  });

  it('SCREENING_RESULT → COLLECTING (继续添加简历)', () => {
    expect(canTransition('SCREENING_RESULT', 'COLLECTING').allowed).toBe(true);
  });

  it('SCREENING_RESULT → JD_GENERATING (新建岗位)', () => {
    expect(canTransition('SCREENING_RESULT', 'JD_GENERATING').allowed).toBe(true);
  });
});

// ============================================================
// 2. 非法转换测试
// ============================================================
describe('状态机 — 非法转换', () => {
  it('IDLE → SCREENING (无JD无简历直接筛选)', () => {
    const result = canTransition('IDLE', 'SCREENING');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('非法状态转换');
  });

  it('JD_GENERATING → SCREENING_RESULT (跳过多步)', () => {
    const result = canTransition('JD_GENERATING', 'SCREENING_RESULT');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('非法状态转换');
  });

  it('SCREENING → JD_CONFIRMING (回退到JD确认)', () => {
    const result = canTransition('SCREENING', 'JD_CONFIRMING');
    expect(result.allowed).toBe(false);
  });

  it('SCREENING_RESULT → JD_CONFIRMING (回退到JD确认)', () => {
    const result = canTransition('SCREENING_RESULT', 'JD_CONFIRMING');
    expect(result.allowed).toBe(false);
  });

  it('SCREENING → COLLECTING (跳过结果直接回去)', () => {
    const result = canTransition('SCREENING', 'COLLECTING');
    expect(result.allowed).toBe(false);
  });
});

// ============================================================
// 3. 同状态转换（幂等）
// ============================================================
describe('状态机 — 同状态转换(幂等)', () => {
  ALL_STATES.forEach(state => {
    it(`${state} → ${state} (同状态，允许)`, () => {
      expect(canTransition(state, state).allowed).toBe(true);
    });
  });
});

// ============================================================
// 4. 所有状态都有合法出站转换
// ============================================================
describe('状态机 — 完整性检查', () => {
  ALL_STATES.forEach(state => {
    it(`${state} 有 >= 1 个合法目标状态`, () => {
      const targets = getAllowedTargets(state);
      expect(targets.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('所有状态都在 VALID_TRANSITIONS 中定义', () => {
    ALL_STATES.forEach(state => {
      expect(VALID_TRANSITIONS[state]).toBeDefined();
    });
  });
});

// ============================================================
// 5. 状态描述可读性
// ============================================================
describe('状态机 — 可读描述', () => {
  it('describeTransitions 返回非空字符串', () => {
    const desc = describeTransitions();
    expect(desc).toBeTruthy();
    expect(desc.length).toBeGreaterThan(50);
    expect(desc).toContain('IDLE');
    expect(desc).toContain('SCREENING_RESULT');
  });
});
