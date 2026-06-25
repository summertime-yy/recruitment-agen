# v1.4 — 简历解析全链路优化：杜绝编造 + 原文对照 + 待确认

## 问题诊断

用户截图显示两个核心问题：
1. **学校字段混入噪声**：`"格式的通过驳回清单。华中师范大学"` — LLM 未从噪声中分离真实字段
2. **姓名为空**：LLM 未从原文中提取到姓名，但也没有编造

## 修改文件（3 + 1）

### 1. `src/lib/llm-client.ts` — Prompt v3 重写

**v2 → v3 关键变化：**

| 维度 | v2 | v3 |
|------|----|----|
| 不编造规则 | 底部一行提示 | 🚨 铁律，顶部✅/❌对比例 |
| Few-Shot 示例 | 3 个（全正面） | 4 个（含噪声/缺失示例） |
| 字段说明 | 仅描述提取规则 | 每个字段附"无法确认时"处理 |
| school 噪声 | 无 | 检测"驳回""清单""格式"等非学校词→分离/留空 |
| skills | 全部提取 | 排除 Office/XMind/PPT 等办公工具 |
| company | 全部提取 | "某""某某"→留空 |

### 2. `src/types/index.ts` — ParsedResume 扩展

```typescript
// 新增字段
originalText?: string;     // 原始简历文本，前端对照核查
sourceFileType?: 'pdf' | 'word' | 'txt';  // 文件类型
```

### 3. `src/components/cards/ResumeParseCard.tsx` — 卡片重设计

**布局变更：**
- 上：解析后结构化字段（含确认进度条 X/7）
- 下：原始文本（可折叠，显示文件名/类型/字符数）
- 空值显示"待确认"（橙色斜体）而非"—"
- 缺失字段显示⚠️提醒 + 展开原文建议

### 4. `src/lib/resume-parser-agent.ts` — 传递 originalText

构造 `ParsedResume` 时新增 `originalText` 和 `sourceFileType` 传递。

## 验证

- `tsc --noEmit`: 0 errors
- `vite build`: 360ms, 336 modules, 0 errors
