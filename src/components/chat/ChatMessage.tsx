/* ============================================================
   ChatMessage - 消息气泡组件
   支持：文本消息、文件消息、系统消息、Bot卡片消息
   ============================================================ */

import type { ChatMessage } from '../../types';
import { formatTime } from '../../lib/utils';
import { renderMarkdownSafe } from '../../lib/markdown';
import { JDCard } from '../cards/JDCard';
import { ResumeParseCard } from '../cards/ResumeParseCard';
import { ScreeningCard } from '../cards/ScreeningCard';
import { ProgressCard } from '../cards/ProgressCard';
import { DetailCard } from '../cards/DetailCard';

interface ChatMessageProps {
  message: ChatMessage;
}

export function ChatMessageBubble({ message }: ChatMessageProps) {
  switch (message.type) {
    case 'system':
      return <SystemMessage text={message.content} />;
    case 'user':
      return <UserMessage message={message} />;
    case 'user_file':
      return <UserFileMessage message={message} />;
    case 'bot_text':
      return <BotTextMessage message={message} />;
    case 'bot_card':
      return <BotCardMessage message={message} />;
    default:
      return null;
  }
}

function SystemMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-center py-2">
      <span className="text-xs text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
        {text}
      </span>
    </div>
  );
}

function UserMessage({ message }: ChatMessageProps) {
  return (
    <div className="flex justify-end gap-2 animate-fadeInUp">
      <div className="max-w-[75%]">
        <div className="flex items-center justify-end gap-1 mb-0.5">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            杨经理 (HR)
          </span>
          <span className="text-[10px] text-slate-300 dark:text-slate-600">
            {formatTime(message.timestamp)}
          </span>
        </div>
        <div className="bg-[#95ec69] dark:bg-emerald-700 text-slate-900 dark:text-slate-100 px-3.5 py-2.5 rounded-lg rounded-tr-sm text-sm leading-relaxed shadow-sm">
          {message.content}
        </div>
      </div>
      <div className="w-8 h-8 rounded-md bg-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-4">
        HR
      </div>
    </div>
  );
}

function UserFileMessage({ message }: ChatMessageProps) {
  const file = message.file;
  if (!file) return null;
  const iconMap = { pdf: '📕', word: '📘', image: '🖼️', text: '📄' };
  const bgMap = { pdf: 'bg-red-50 dark:bg-red-900/20', word: 'bg-blue-50 dark:bg-blue-900/20', image: 'bg-orange-50 dark:bg-orange-900/20', text: 'bg-slate-50 dark:bg-slate-800' };
  return (
    <div className="flex justify-end gap-2 animate-fadeInUp">
      <div className="max-w-[75%]">
        <div className="flex items-center justify-end gap-1 mb-0.5">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">杨经理 (HR)</span>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 flex items-center gap-3 shadow-sm">
          <div className={`w-9 h-9 rounded-md flex items-center justify-center text-lg ${bgMap[file.type]}`}>
            {iconMap[file.type]}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{file.name}</div>
            <div className="text-xs text-slate-400 dark:text-slate-500">{file.size}</div>
          </div>
        </div>
      </div>
      <div className="w-8 h-8 rounded-md bg-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-4">HR</div>
    </div>
  );
}

function BotTextMessage({ message }: ChatMessageProps) {
  return (
    <div className="flex justify-start gap-2 animate-fadeInUp">
      <div className="w-8 h-8 rounded-md bg-emerald-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-1">招</div>
      <div className="max-w-[75%]">
        <div className="flex items-center gap-1 mb-0.5">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">招聘助手</span>
          <span className="text-[10px] text-slate-300 dark:text-slate-600">{formatTime(message.timestamp)}</span>
        </div>
        <div className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3.5 py-2.5 rounded-lg rounded-tl-sm text-sm leading-relaxed shadow-sm">
          <RemarkContent content={message.content} />
        </div>
      </div>
    </div>
  );
}

function BotCardMessage({ message }: ChatMessageProps) {
  return (
    <div className="flex justify-start gap-2 animate-fadeInUp">
      <div className="w-8 h-8 rounded-md bg-emerald-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-1">招</div>
      <div className="max-w-[82%]">
        <div className="flex items-center gap-1 mb-0.5">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">招聘助手</span>
          <span className="text-[10px] text-slate-300 dark:text-slate-600">{formatTime(message.timestamp)}</span>
        </div>
        {renderCard(message)}
      </div>
    </div>
  );
}

function renderCard(message: ChatMessage) {
  switch (message.cardType) {
    case 'jd':
      return <JDCard data={message.cardData as any} />;
    case 'resume_parse':
      return <ResumeParseCard data={message.cardData as any} />;
    case 'screening_report':
      return <ScreeningCard data={message.cardData as any} />;
    case 'progress':
      return <ProgressCard data={message.cardData as any} />;
    case 'detail':
      return <DetailCard data={message.cardData as any} />;
    default:
      return (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <RemarkContent content={message.content} />
        </div>
      );
  }
}

/** 安全 Markdown 渲染 — 使用 DOMPurify 风格清洗防止 XSS */
function RemarkContent({ content }: { content: string }) {
  const safeHtml = renderMarkdownSafe(content);
  return <div dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
