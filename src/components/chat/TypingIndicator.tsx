/* ============================================================
   TypingIndicator - AI 回复中动画
   ============================================================ */

export function TypingIndicator() {
  return (
    <div className="flex justify-start gap-2 animate-fadeInUp">
      <div className="w-8 h-8 rounded-md bg-emerald-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-1">招</div>
      <div>
        <div className="flex items-center gap-1 mb-0.5">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">招聘助手</span>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg rounded-tl-sm px-4 py-3 shadow-sm">
          <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 animate-typing-bounce" />
            <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 animate-typing-bounce" style={{ animationDelay: '0.2s' }} />
            <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 animate-typing-bounce" style={{ animationDelay: '0.4s' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
