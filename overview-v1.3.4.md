# v1.3.4 — 修复 missingFields TDZ 崩溃 + isProcessing 泄漏

## 问题描述

用户反馈两个问题：
1. 简历解析每次都失败，控制台报 `Cannot access 'missingFields' before initialization`
2. 解析流程会连续调用 2 次，一次失败一次成功但卡片显示失败

## 根因分析

### Bug 1: missingFields TDZ (Temporal Dead Zone)

**位置**: `src/lib/resume-parser-agent.ts` 第 320-341 行

```typescript
// ❌ 错误：missingFields 在 const 声明前被使用
const parsedResume: ParsedResume = {
  ...
  missingFields,   // 第 337 行：引用未声明的变量
};

const missingFields = computeMissingFields(parsedResume);  // 第 341 行：声明
```

JS/TS 中 `const` 声明的变量存在 TDZ（Temporal Dead Zone）—— 从块作用域开始到声明行之前，变量不可访问。访问即抛出 `ReferenceError`。

**影响**：每次成功解析必然崩溃，catch 返回错误提示，用户看到的永远是「失败」卡片。

### Bug 2: isProcessing 泄漏

**位置**: `src/components/chat/ChatInput.tsx` 第 238-241 行

```typescript
if (!llm.getConfig().enabled || !llm.supportsVision()) {
  // ... message
  setTyping(false);
  if (fileInputRef.current) fileInputRef.current.value = '';
  return;  // ❌ isProcessing.current 仍为 true，永久卡死后续操作！
}
```

**影响**：触发此分支后，后续所有 `handleSend` 和 `handleFileSelect` 都被并发保护拦截，用户无法再发送任何消息，只能刷新页面。

## 修复内容

| 文件 | 改动 | 行数 |
|------|------|------|
| `src/lib/resume-parser-agent.ts` | `computeMissingFields` 移到 `parsedResume` 构造之前，从 `parsedFields` 直接计算 | ~15 |
| `src/components/chat/ChatInput.tsx` | Vision 不支持分支增加 `isProcessing.current = false` | +1 |

## 验证

- `tsc --noEmit`: 0 errors
- `vite build`: 378ms, 336 modules, 0 errors
