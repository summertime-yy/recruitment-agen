/* ============================================================
   ChatArea - 聊天消息区域
   ============================================================ */

import { useEffect, useRef } from 'react';
import { useRecruitmentStore } from '../../store/recruitmentStore';
import { ChatMessageBubble } from './ChatMessage';
import { TypingIndicator } from './TypingIndicator';

export function ChatArea() {
  const messages = useRecruitmentStore(s => s.messages);
  const isTyping = useRecruitmentStore(s => s.isTyping);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30">
            <span className="text-3xl">💎</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
            智能招聘助手
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            在下方输入招聘需求，例如：<br />
            <code className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded text-xs">
              @招聘助手 帮我招一个嵌入式软件工程师，需要熟悉UVM和SystemVerilog
            </code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin">
      {messages.map((msg) => (
        <ChatMessageBubble key={msg.id} message={msg} />
      ))}
      {isTyping && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
