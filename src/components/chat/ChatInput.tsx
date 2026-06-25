/* ============================================================
   ChatInput - 聊天输入区
   支持：文本发送 + 简历文件上传（COLLECTING 状态）
   文档解析：TXT 直接读 | DOCX mammoth.js | PDF pdf.js | 扫描 PDF LLM Vision
   ============================================================ */

import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent } from 'react';
import { useRecruitmentStore } from '../../store/recruitmentStore';
import { getAgentEngine } from '../../lib/agent-engine';
import { getResumeParserAgent, type ResumeParserAgent } from '../../lib/resume-parser-agent';
import { delay, formatFileSize } from '../../lib/utils';
import { extractDocumentText } from '../../lib/document-parser';
import { getLLMClient } from '../../lib/llm-client';

/** 允许上传的简历文件类型 */
const ALLOWED_RESUME_TYPES = '.pdf,.doc,.docx,.txt';

export function ChatInput() {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 并发保护：防止在 LLM 调用期间发送第二条消息 */
  const isProcessing = useRef(false);

  const { addMessage, setTyping, setState, addJob, updateJob, addResume, assignResumeToJob,
    setQuickActions, setPendingResume, setScreeningResult, state, jobs,
    parsedResumes, pendingResume, getContext, sceneAction, clearSceneAction } = useRecruitmentStore();

  const engine = getAgentEngine();

  // === 监听 Sidebar 快捷操作触发 ===
  useEffect(() => {
    if (sceneAction && !isProcessing.current) {
      const actionText = sceneAction;
      clearSceneAction(); // 立即清除，防止重复触发
      // 延迟执行确保 React 状态更新完成
      setTimeout(() => handleSend(actionText), 50);
    }
  }, [sceneAction]);

  // ============================================================
  // 文本发送
  // ============================================================
  const handleSend = async (content?: string) => {
    const trimmed = (content ?? text).trim();
    if (!trimmed) return;

    // 并发保护：防止在 LLM 超时期间重复发送
    if (isProcessing.current) {
      console.warn('[ChatInput] 正在处理中，忽略重复发送');
      return;
    }
    isProcessing.current = true;

    // 添加用户消息
    addMessage({ type: 'user', content: trimmed });
    setText('');
    setQuickActions([]);
    setTyping(true);

    // 更新引擎上下文 — P1 修复 (B-6): 使用 getState() 替代闭包 state 避免过期
    const freshState = useRecruitmentStore.getState().state;
    engine.setContext(getContext(), freshState);

    try {
      await delay(800 + Math.random() * 1200);

      const response = await engine.processMessage(trimmed);

      if (response.newState) {
        setState(response.newState);
      }

      if (response.jobUpdate) {
        const update = response.jobUpdate;
        if (update.id && jobs.find(j => j.id === update.id)) {
          updateJob(update.id, update);
        } else if (update.id) {
          addJob(update as Parameters<typeof addJob>[0]);
        }
      }

      if (response.resumeUpdate) {
        setPendingResume(response.resumeUpdate as any);
      }

      addMessage({
        type: response.type,
        content: response.content,
        sender: '招聘助手',
        cardType: response.cardType,
        cardData: response.cardData as any,
        quickActions: response.quickActions,
      });

      if (response.quickActions) {
        setQuickActions(response.quickActions);
      }

      if (response.cardType === 'screening_report' && response.cardData) {
        setScreeningResult(response.cardData as any);
      }
    } catch {
      // P1 修复 (B-7): 出错后同步引擎与 Store 状态，防止不一致
      const storeState = useRecruitmentStore.getState().state;
      engine.setContext(useRecruitmentStore.getState().getContext(), storeState);

      addMessage({
        type: 'bot_text',
        content: '⚠️ 处理出错了，请稍后再试。',
        sender: '招聘助手',
      });
    } finally {
      setTyping(false);
      isProcessing.current = false;
      inputRef.current?.focus();
    }
  };

  // ============================================================
  // 文件上传（使用 DocumentParser 混合方案）
  // ============================================================
  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 并发保护：防止处理期间重复上传
    if (isProcessing.current) {
      console.warn('[ChatInput] 正在处理中，忽略重复文件上传');
      addMessage({
        type: 'system',
        content: '⏳ 正在处理上一个请求，请稍候...',
      });
      return;
    }
    isProcessing.current = true;

    // === P1 修复 (D4-F5): 文件扩展名校验 ===
    if (!file.name.match(/\.(pdf|doc|docx|txt)$/i)) {
      addMessage({
        type: 'system',
        content: '⚠️ 仅支持 PDF、Word 或 TXT 格式的简历文件，请重新选择。',
      });
      isProcessing.current = false; // 修复: 错误返回时重置并发保护
      return;
    }

    // === P1 修复 (D4-F5): 文件大小限制 10MB（原 20MB）===
    if (file.size > 10 * 1024 * 1024) {
      addMessage({
        type: 'system',
        content: '⚠️ 文件大小不能超过 10MB，请压缩后重试。',
      });
      isProcessing.current = false; // 修复: 错误返回时重置并发保护
      return;
    }

    // === P1 修复 (D4-F5): 魔数校验 — 检查文件头字节防止扩展名伪造 ===
    const MAGIC_BYTES: Record<string, number[]> = {
      pdf: [0x25, 0x50, 0x44, 0x46],          // %PDF
      docx: [0x50, 0x4B, 0x03, 0x04],         // PK.. (ZIP, also .docx)
      doc:  [0xD0, 0xCF, 0x11, 0xE0],         // OLE2 (旧 .doc)
      zip:  [0x50, 0x4B, 0x03, 0x04],         // PK.. (ZIP)
    };

    try {
      const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const expectedMagic = ext === 'docx' ? MAGIC_BYTES.docx : ext === 'pdf' ? MAGIC_BYTES.pdf : ext === 'doc' ? MAGIC_BYTES.doc : null;

      if (expectedMagic) {
        const matches = expectedMagic.every((byte, i) => header[i] === byte);
        if (!matches) {
          // .doc 可能也是 ZIP 格式（新版 Word），所以放宽一点：检查 OLE2 或 ZIP
          const isOle2 = MAGIC_BYTES.doc.every((byte, i) => header[i] === byte);
          const isZip = MAGIC_BYTES.zip.every((byte, i) => header[i] === byte);
          if (!isOle2 && !isZip) {
            addMessage({
              type: 'system',
              content: `⚠️ 文件头魔数校验失败：文件扩展名为「${ext}」，但内容不是有效的 ${ext.toUpperCase()} 格式。请确认文件未被重命名或损坏。`,
            });
            isProcessing.current = false;
            return;
          }
        }
      }
    } catch {
      addMessage({
        type: 'system',
        content: '⚠️ 读取文件失败，请检查文件是否完整。',
      });
      isProcessing.current = false;
      return;
    }

    // 先添加文件消息
    addMessage({
      type: 'user_file',
      content: `📎 ${file.name}（${formatFileSize(file.size)}）`,
      metadata: { fileName: file.name, fileSize: file.size },
    });

    setQuickActions([]);
    setTyping(true);
    engine.setContext(getContext(), state);

    try {
      // === Step 1: 用 DocumentParser 解析文档 ===
      addMessage({
        type: 'system',
        content: `🔍 正在解析「${file.name}」……`,
      });

      const doc = await extractDocumentText(file);

      // ===== 诊断日志 =====
      console.log('[ChatInput.handleFileSelect] === 文档解析完成 ===');
      console.log('[ChatInput.handleFileSelect] 文件:', file.name, '大小:', file.size);
      console.log('[ChatInput.handleFileSelect] 解析来源:', doc.source, '| 扫描版:', doc.isScanned, '| 页数:', doc.pageCount);
      console.log('[ChatInput.handleFileSelect] 提取文本长度:', doc.text.length);
      console.log('[ChatInput.handleFileSelect] 前300字符预览:', doc.text.slice(0, 300));

      if (doc.isScanned && doc.pageImages && doc.pageImages.length > 0) {
        // === Step 2a: 扫描版 PDF → LLM Vision ===
        addMessage({
          type: 'system',
          content: `📸 检测到扫描版 PDF（${doc.pageCount}页），正在用 AI 视觉识读……`,
        });

        const llm = getLLMClient();
        if (!llm.getConfig().enabled || !llm.supportsVision()) {
          const model = llm.getConfig().model;
          addMessage({
            type: 'system',
            content: `⚠️ 当前模型「${model}」不支持视觉识读。\n\n建议：\n- 粘贴简历文本到输入框\n- 或在 LLM 设置中切换到支持 Vision 的模型（如 gpt-4o、gemini-2.5-flash、claude-sonnet-4）`,
          });
          setTyping(false);
          isProcessing.current = false;
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        // 限制页数以控制 API 成本（最多 3 页）
        const maxPages = Math.min(doc.pageImages.length, 3);
        const imagesToProcess = doc.pageImages.slice(0, maxPages);
        if (doc.pageImages.length > 3) {
          addMessage({
            type: 'system',
            content: `⚠️ PDF 共 ${doc.pageCount} 页，仅识读前 3 页（控制成本）。`,
          });
        }

        const visionText = await llm.parseResumeWithVision(imagesToProcess, file.name);

        // === Step 3: 通过 ResumeParserAgent 解析 Vision 结果 ===
        await delay(300);
        const agent = getResumeParserAgent();
        const agentResult = await agent.run({
          text: visionText,
          documentMeta: {
            source: 'pdf_scanned',
            fileName: file.name,
            textLength: visionText.length,
            pageCount: doc.pageCount,
            isScanned: true,
          },
        }, {
          state, currentJobId: getContext().currentJobId, jobs,
        });

        const response = agentResult.response;
        if (response.newState) setState(response.newState);
        if (response.resumeUpdate) setPendingResume(response.resumeUpdate as any);

        addMessage({
          type: response.type,
          content: response.content,
          sender: '招聘助手',
          cardType: response.cardType,
          cardData: response.cardData as any,
          quickActions: response.quickActions,
        });

        if (response.quickActions) setQuickActions(response.quickActions);

      } else {
        // === Step 2b: 文本型文档 → 通过 ResumeParserAgent + Tool 管道解析 ===
        const sourceLabel = doc.source === 'docx' ? 'Word' : doc.source === 'pdf_text' ? 'PDF' : 'TXT';
        addMessage({
          type: 'system',
          content: `✅ ${sourceLabel}文档解析完成（${doc.text.length} 字符），正在提取简历信息……`,
        });

        await delay(400);

        // === 通过 ResumeParserAgent + Tool 管道解析 ===
        // 传递完整元数据：source/fileName/textLength/pageCount/isScanned
        // Agent 根据 source 类型自动调整文本预处理和 LLM 提示策略
        const agent = getResumeParserAgent();
        const agentResult = await agent.run({
          text: doc.text,
          documentMeta: {
            source: doc.source,
            fileName: doc.fileName,
            textLength: doc.text.length,
            pageCount: doc.pageCount,
            isScanned: doc.isScanned,
          },
        }, {
          state, currentJobId: getContext().currentJobId, jobs,
        });

        const response = agentResult.response;
        console.log('[ChatInput] Agent 解析完成，Tool 调用链:', JSON.stringify(agentResult.toolTraces));

        if (response.newState) setState(response.newState);
        if (response.resumeUpdate) setPendingResume(response.resumeUpdate as any);

        if (response.jobUpdate) {
          const update = response.jobUpdate;
          if (update.id && jobs.find(j => j.id === update.id)) {
            updateJob(update.id, update);
          } else if (update.id) {
            addJob(update as Parameters<typeof addJob>[0]);
          }
        }

        addMessage({
          type: response.type,
          content: response.content,
          sender: '招聘助手',
          cardType: response.cardType,
          cardData: response.cardData as any,
          quickActions: response.quickActions,
        });

        if (response.quickActions) setQuickActions(response.quickActions);
      }
    } catch (err) {
      console.error('文件解析失败:', err);
      const errorMsg = err instanceof Error ? err.message : String(err);

      // 诊断具体错误类型，给出有针对性的建议
      let userMessage = `❌ 简历解析失败：${errorMsg}`;
      let suggestion = '';

      if (errorMsg.includes('LLM') || errorMsg.includes('API') || errorMsg.includes('fetch')) {
        suggestion = '\n\n💡 LLM API 调用失败。请检查 Dashboard → LLM 设置中的 API 配置是否正确。如果未配置，系统会使用本地规则引擎作为后备。';
      } else if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
        suggestion = '\n\n💡 请求超时。请检查网络连接或增加超时时间（LLM 设置 → 超时）。';
      } else if (errorMsg.includes('401') || errorMsg.includes('403')) {
        suggestion = '\n\n💡 API 认证失败。请检查 API Key 是否正确。';
      } else if (errorMsg.includes('parse') || errorMsg.includes('JSON')) {
        suggestion = '\n\n💡 LLM 返回了非标准格式。请尝试粘贴简历文本到输入框。';
      } else {
        suggestion = '\n\n💡 请尝试：\n- 粘贴简历文本到输入框\n- 检查浏览器控制台 (F12) 查看详细错误\n- 在 Dashboard 中查看追踪记录确认失败原因';
      }

      addMessage({
        type: 'system',
        content: userMessage + suggestion,
      });
    } finally {
      setTyping(false);
      isProcessing.current = false;
      // 重置 file input 以允许重复上传同名文件
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ============================================================
  // 快捷操作
  // ============================================================
  const handleQuickAction = (action: string) => {
    if (action === 'UPLOAD_RESUME') {
      // 触发文件选择器
      fileInputRef.current?.click();
      return;
    }
    if (action === 'SCREEN_RESUMES') {
      addMessage({ type: 'user', content: '@招聘助手 开始筛选' });
      setText('');
      setQuickActions([]);
      // 延迟触发 send
      setTimeout(() => handleSend('@招聘助手 开始筛选'), 100);
      return;
    }
    if (action.startsWith('CONFIRM_JD')) {
      addMessage({ type: 'user', content: '确认' });
      setQuickActions([]);
      setTimeout(() => handleSend('确认'), 100);
      return;
    }
    if (action.startsWith('MODIFY_JD')) {
      setText('@招聘助手 修改：');
      inputRef.current?.focus();
      return;
    }
    if (action.startsWith('ASSIGN_RESUME:')) {
      const [, resumeId, jobId] = action.split(':');
      const pResume = pendingResume || parsedResumes.find(r => r.id === resumeId);
      if (pResume) {
        assignResumeToJob(pResume.id, jobId);
        addResume({ ...pResume, jobId });
        const job = jobs.find(j => j.id === jobId);
        addMessage({ type: 'user', content: `关联到【${job?.title || '当前岗位'}】` });
      }
      return;
    }
    if (action.startsWith('VIEW_DETAIL:')) {
      const resumeId = action.split(':')[1];
      const resume = parsedResumes.find(r => r.id === resumeId);
      if (resume) {
        addMessage({ type: 'user', content: `查看 ${resume.name} 的详细评分` });
        // 触发引擎处理 VIEW_DETAIL 意图
        setTimeout(() => handleSend(`@招聘助手 查看 ${resume.name} 详情`), 100);
      }
      return;
    }
    if (action.startsWith('JD_GENERATE:')) {
      const jobTitle = action.split(':')[1];
      setText(`@招聘助手 帮我招一个${jobTitle}，负责相关开发工作`);
    }
  };

  const adjustHeight = () => {
    const el = inputRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  };

  const quickActions = useRecruitmentStore(s => s.quickActions);
  const isCollecting = state === 'COLLECTING';

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      {/* 快捷操作 */}
      {quickActions.length > 0 && (
        <div className="flex gap-1.5 mb-2.5 flex-wrap">
          {quickActions.map((qa, i) => (
            <button
              key={i}
              onClick={() => handleQuickAction(qa.action)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                qa.primary
                  ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm shadow-emerald-200 dark:shadow-emerald-900/30'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 dark:hover:text-emerald-400 border border-slate-200 dark:border-slate-700'
              }`}
            >
              {qa.label}
            </button>
          ))}
        </div>
      )}

      {/* 输入区 */}
      <div className="flex gap-2 items-end">
        {/* 左侧按钮组 */}
        <div className="flex gap-1 items-center mb-1">
          {/* @提及按钮 */}
          <button
            onClick={() => setText('@招聘助手 ' + text)}
            className="p-1.5 rounded-md text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
            title="@提及"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>
            </svg>
          </button>

          {/* 📎 上传简历按钮 — 仅在 COLLECTING 状态显示 */}
          {isCollecting && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-md text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
              title="上传简历文件（PDF / Word / TXT）"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
          )}
        </div>

        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => { setText(e.target.value); adjustHeight(); }}
          onKeyDown={handleKeyDown}
          onInput={adjustHeight}
          placeholder={
            isCollecting
              ? '粘贴简历文本，或点击 📎 上传文件，Enter 发送...'
              : '@招聘助手 输入招聘需求，Enter 发送，Shift+Enter 换行...'
          }
          rows={1}
          className="flex-1 resize-none border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-emerald-400 dark:focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400/30 transition-all min-h-[38px] max-h-[120px]"
        />

        <button
          onClick={() => handleSend()}
          disabled={!text.trim() || isProcessing.current}
          className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 text-white text-sm font-medium transition-all duration-200 shadow-sm shadow-emerald-200 dark:shadow-emerald-900/30 hover:shadow-md active:scale-[0.97] disabled:shadow-none disabled:cursor-not-allowed"
        >
          发送
        </button>
      </div>

      {/* 隐藏的文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_RESUME_TYPES}
        onChange={handleFileSelect}
        className="hidden"
        aria-label="上传简历文件"
      />

      {/* 底部提示 */}
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
        <span>Enter 发送</span>
        <span>Shift+Enter 换行</span>
        {isCollecting
          ? <span className="text-emerald-500 dark:text-emerald-400">📎 支持 PDF / Word / TXT</span>
          : <span>@招聘助手 触发智能助手</span>
        }
      </div>
    </div>
  );
}
