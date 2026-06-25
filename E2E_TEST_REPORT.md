# E2E 测试工程报告 — 智能招聘 Agent v1.6

## 📊 测试概览

| 项目 | 数据 |
|------|------|
| **测试框架** | Vitest 4.x + jsdom |
| **测试文件** | 3 个 |
| **测试用例** | **154 个** |
| **通过率** | **154/154 (100%)** |
| **运行时间** | ~2.1s |
| **构建验证** | vite build 399ms, 337 modules ✅ |

---

## 📁 测试套件

### 1. state-machine.test.ts — 29 用例 ✅

覆盖会话状态机的**所有**合法/非法转换 + 边界条件。

| 分类 | 用例数 | 说明 |
|------|--------|------|
| 合法转换 | 10 | IDLE→JD_GENERATING, JD_CONFIRMING→COLLECTING 等 |
| 非法转换 | 5 | IDLE→SCREENING, SCREENING→JD_CONFIRMING 拒绝并返回 reason |
| 同状态幂等 | 6 | 所有 6 状态自我转换允许 |
| 完整性检查 | 7 | 每个状态 >=1 个目标，所有状态在矩阵中定义 |
| 可读描述 | 1 | describeTransitions() 输出可读 |

### 2. intent-routing.test.ts — 96 用例 ✅

**核心修复**：提取 `matchIntent()` 为独立函数（`src/lib/intent-rules.ts`），支持全状态 × 全意图组合测试。

| 分类 | 用例数 | 关键覆盖 |
|------|--------|---------|
| MODIFY_RESUME | 79 | 所有 6 状态 × 9 种简历修改输入 + 边界（不含字段不匹配） |
| MODIFY_JD | 4 | JD_CONFIRMING 下正确路由，非 JD_CONFIRMING 下不误杀 |
| CONFIRM_JD | 9 | JD_CONFIRMING 下所有短确认词，非 JD_CONFIRMING 下不误确认 |
| GENERATE_JD | 6 | 中/英/混合 JD 生成 + 含"招"和"进度"的优先进度匹配 |
| SCREEN_RESUMES | 3 | 筛选/评分/看看这批 |
| QUERY_PROGRESS | 3 | 查看进度/多少份/情况怎么样 |
| VIEW_DETAIL | 2 | 查看某人详情 + 查看评分 |
| SUBMIT_RESUME | 2 | 长文本 + 短文本 |
| 边界异常 | 5 | 空串/纯标点/纯数字/超长/换行 |
| 中英混合 | 3 | update 姓名/英文JD/混合招聘 |
| 已知问题回归 | 3 | 简历修改不误路由到JD修改 |

### 3. resume-parser.test.ts — 29 用例 ✅

覆盖 `LocalRuleParserTool` 的字段提取精度。

| 分类 | 用例数 | 覆盖字段 |
|------|--------|---------|
| 姓名 | 5 | 标签匹配/PDF噪声/英文名/文件名回退/无姓名 |
| 学历 | 7 | 学历：硕士/硕士研究生/独立硕士/学士/Bachelor/博士/无学历 |
| 学校 | 5 | 院校标签/标签合并/毕业院校/英文学校/无学校 |
| 工作年限 | 5 | 3年经验/5年工作经验/应届生排除/时间段累加/无经验 |
| 综合 | 3 | 完整简历/部分字段/confidence |
| PDF噪声 | 2 | 空格分割/页码噪声 |
| 边界 | 2 | 空串/非简历文本 |

---

## 🔧 发现并修复的问题

### 问题 1: 意图识别规则冲突（P0）
- **根因**：`matchIntent` 中规则排序不当，导致 `"看看这批怎么样"` 先匹配 `QUERY_PROGRESS`（因为含"怎么样"）而非 `SCREEN_RESUMES`
- **修复**：将 `"看看这批"` 规则提到 `QUERY_PROGRESS` 规则之前

### 问题 2: 修改意图关键词缺失
- **根因**：原有 `matchIntent` 丢失了"加上"/"去掉"/"update"/"change" 等修改关键词
- **修复**：扩展 `modifyPattern` 正则，增加 `加上|去掉|增加|减少|删除|添加|update|change|set|modify`

### 问题 3: 全局 CONFIRM_JD 误触发
- **根因**：`matchIntent` 的全局 CONFIRM_JD 兜底规则在 IDLE 状态下也触发了
- **修复**：全局兜底规则加 `currentState === 'JD_CONFIRMING'` 前置条件

### 问题 4: "招聘进度" 路由冲突
- **根因**：`"招聘进度怎么样"` 含"招"先匹配 GENERATE_JD
- **修复**：新增 `招聘.*进度` → QUERY_PROGRESS 优先规则

---

## 🧪 新增/修改文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/intent-rules.ts` | **新增** | 独立意图规则引擎，可测试 |
| `src/lib/agent-engine.ts` | 修改 | 委托到 `matchIntent()` |
| `src/__tests__/state-machine.test.ts` | **新增** | 29 用例 |
| `src/__tests__/intent-routing.test.ts` | **新增** | 96 用例 |
| `src/__tests__/resume-parser.test.ts` | **新增** | 29 用例 |
| `src/test-setup.ts` | **新增** | Vitest 环境配置 |
| `src/vite-env.d.ts` | 修改 | 添加 vitest 类型引用 |
| `vite.config.ts` | 修改 | 添加 test 配置块 |
| `package.json` | 修改 | 新增 vitest 等依赖 |

---

## ⚠️ 已知限制（已标记）

| 限制 | 位置 | 优先级 |
|------|------|--------|
| 姓名正则不支持英文/拼音名 | `extractNameRobust` | P2 |
| 极短简历(如"张三\n硕士")信号不足 | `extractDegreeRobust` | P2 |
| 英文学校名(University of California)匹配有限 | `extractSchoolRobust` | P2 |
| "5年工作经验"正则不够精确 | `extractWorkYearsRobust` | P2 |

---

## 📋 运行命令

```bash
# 运行所有测试
npx vitest run

# 带覆盖率
npx vitest run --coverage

# watch 模式
npx vitest
```
