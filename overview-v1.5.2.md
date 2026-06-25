# v1.5.2 — 修复简历修改意图路由

## 问题现象
用户在聊天框输入 `"修改姓名：周宇瑞；工作年限：0"`，系统却修改了 **JD（岗位描述）** 而非简历。

## 根因分析

问题出在 `agent-engine.ts` 的意图路由链路：

```
用户输入 "修改姓名：周宇瑞；工作年限：0"
  │
  ├─→ ruleBasedIntent():
  │     ├─ 状态非 JD_CONFIRMING → "修改" 关键词规则不算
  │     ├─ 不匹配 GENERATE_JD / SCREEN / QUERY / VIEW
  │     └─ 返回 null
  │
  ├─→ LLM 意图识别:
  │     └─ IntentType 中只有 MODIFY_JD，无 MODIFY_RESUME
  │     └─ LLM 将简历修改判定为 MODIFY_JD ❌
  │
  └─→ handleModifyJD() 拿着简历字段去改 JD ❌
```

**核心缺陷**：`IntentType` 中缺少 `MODIFY_RESUME`，导致无论是规则匹配还是 LLM 意图识别，都没有"简历修改"这个目标。

## 修改内容

### 1. types/index.ts — 新增意图
```typescript
export type IntentType =
  | 'GENERATE_JD'
  | 'MODIFY_JD'
  | 'MODIFY_RESUME'    // ← 新增
  | 'CONFIRM_JD'
  // ...
```

### 2. agent-engine.ts — ruleBasedIntent 优先级拦截
```typescript
// 简历字段检测（优先级最高，在 JD 修改之前）
const resumeFieldPattern = /(?:姓名|年龄|学历|学校|院校|专业|工作年限|城市|所在地|技能|经历|简历|解析|手机号|邮箱)/;
const modifyPattern = /修改|改成|改为|更正|纠正|调整|更新/;
if (resumeFieldPattern.test(content) && modifyPattern.test(content)) {
  return 'MODIFY_RESUME';
}
```

### 3. agent-engine.ts — handleModifyResume 方法
- 从 `context.parsedResumes` 取最近解析的简历
- 正则解析 8 个字段（姓名/年龄/学历/学校/专业/工作年限/城市/技能）的修改指令
- 支持格式：`修改XX：YY`、`XX改成YY`、`修改XX为YY`
- 返回 `cardType: 'resume_parse'` 更新卡片
- 空简历或无有效修改时给出提示

### 4. llm-client.ts — INTENT_SYSTEM_PROMPT 更新
```
- MODIFY_JD: 用户想修改已有的JD
- MODIFY_RESUME: 用户想修改已解析简历的字段（姓名、学历等）
```

## 验证
```
tsc --noEmit → 0 errors
vite build   → 413ms, 336 modules
```
