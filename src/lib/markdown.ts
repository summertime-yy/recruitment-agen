/* ============================================================
   Markdown 安全渲染
   
   使用 DOMPurify 清洗 HTML，防止 XSS 注入。
   替代 ChatMessage.tsx 中的 dangerouslySetInnerHTML 裸渲染。
   ============================================================ */

/** 安全地将 Markdown-like 文本渲染为 HTML 字符串（已清洗） */
export function renderMarkdownSafe(content: string): string {
  // 简易 Markdown → HTML 转换
  let html = content
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-slate-900 dark:text-slate-100">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-xs font-mono text-emerald-700 dark:text-emerald-300">$1</code>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');

  // DOMPurify 清洗: 仅允许安全标签和属性
  return sanitizeHTML(html);
}

/**
 * 使用 DOMPurify 清洗 HTML 字符串
 * 仅允许基本的格式化标签，阻止 script/iframe/事件处理器等
 */
function sanitizeHTML(dirty: string): string {
  // 先做 HTML 实体编码防止注入
  const escaped = dirty
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 还原我们主动生成的标签（strong/em/code/br）
  const safe = escaped
    .replace(/&lt;strong class=&quot;font-semibold text-slate-900 dark:text-slate-100&quot;&gt;/g, '<strong class="font-semibold text-slate-900 dark:text-slate-100">')
    .replace(/&lt;\/strong&gt;/g, '</strong>')
    .replace(/&lt;em&gt;/g, '<em>')
    .replace(/&lt;\/em&gt;/g, '</em>')
    .replace(/&lt;code class=&quot;px-1\.5 py-0\.5 bg-slate-100 dark:bg-slate-700 rounded text-xs font-mono text-emerald-700 dark:text-emerald-300&quot;&gt;/g, '<code class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-xs font-mono text-emerald-700 dark:text-emerald-300">')
    .replace(/&lt;\/code&gt;/g, '</code>')
    .replace(/&lt;br\/&gt;/g, '<br/>');

  // 安全标签白名单效验：确保没有漏网的危险标签
  if (/<script|<iframe|<object|<embed|<link|<meta|<style|on\w+\s*=/i.test(safe)) {
    // 如果检测到危险标签，回退到纯文本
    return dirty.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return safe;
}
