# v1.5.1 — 本地规则提取精准度修复

## 背景
截图显示：文档提取了 2137 字符，但本地规则解析器只提取到 `学历=硕士`，`名字/学校/专业` 全部为空，`workYears=5` 被误识别。

## 控台日志关键信息
- 文件名: `[AI产品经理 北京 28-30岁] 周宇瑞 26年应届生.pdf`
- 提取文本含: `学历：硕士|专业：控制科学与工程|院校：北京航空航天大学`
- `[ResumeParserAgent] 本地规则解析器 (pure-local) 来源: text`
- `validateFieldConsistency error: workYears=5 与 experiences 累计 0 年偏差过大，自动纠正为 0`
- `✓ 解析完成: 名字=「」学历=「硕士」学校=「」专业=「」`

## 根因

### 1. 学校提取失败 — "学校：硕士" 优先于 "院校：北京航空航天大学"
`extractSchoolRobust` 第一个正则匹配 pattern 是 `/(?:毕业院校|学校|院校|教育背景)/`，在文本 `学校：硕士|院校：北京航空航天大学` 中先匹配到 `学校：硕士`，提取 "硕士"（长度=2 通过检查）返回。
**修复**: 增加预处理合并逻辑（同一字段标签出现"学校：硕士|院校：XX大学"时保留院校值）；增加 `DEGREE_LABELS` 过滤（匹配到学历名则跳过继续匹配）。

### 2. 姓名提取失败 — 文本无 "姓名：" 标签
原始文本中没有 `姓名：周宇瑞` 标签，`extractNameRobust` 无法匹配。
**修复**: `extractNameRobust` 增加 `fileName` 参数，回退到文件名模式匹配（如 `[tag] 周宇瑞 ...pdf`）。

### 3. workYears=5 误识别 — "26年" 在 "26年应届生" 中被当作经验年数
`extractWorkYearsRobust` 第一个模式 `/(\d+)\s*(?:年|年经验)/i` 匹配到文本中的 "26年"。
**修复**: 收紧正则 — 只匹配"年经验/年工作经验"；宽松匹配增加上下文排除（"应届/毕业/在读" 附近不出匹配）。

## 修改文件
- `src/lib/agent-tools.ts`
  - 新增 `DEGREE_LABELS` 常量
  - `extractSchoolRobust`: 增加预处理合并 + 学历名过滤
  - `extractNameRobust(text, fileName?)`: 新增文件名回退匹配
  - `extractWorkYearsRobust`: 收紧正则，排除应届/毕业上下文
  - `LocalRuleParserParams`: 新增 `fileName` 字段
- `src/lib/resume-parser-agent.ts`
  - 调用 localTool 时传入 `fileName`

## 验证
- tsc --noEmit → 0 errors
- vite build → 394ms, 336 modules, 0 errors
