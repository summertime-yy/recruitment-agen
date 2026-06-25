/* ============================================================
   Sidebar — 侧边栏：场景快捷操作 + 状态概览
   ============================================================ */

import { useRecruitmentStore } from '../../store/recruitmentStore';
import { stateNameMap, stateColorMap } from '../../lib/utils';

export function Sidebar() {
  const { state, jobs, parsedResumes, screeningResult, reset, triggerSceneAction } = useRecruitmentStore();
  const currentJob = jobs.find(j => j.id === useRecruitmentStore.getState().currentJobId);
  const sidebarOpen = useRecruitmentStore(s => s.sidebarOpen);

  if (!sidebarOpen) return null;

  return (
    <aside className="w-64 bg-slate-900 dark:bg-slate-950 text-slate-300 flex-shrink-0 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          智能招聘助手
        </h2>
        <p className="text-xs text-slate-500 mt-1">Agent Web · MVP v1.2</p>
      </div>

      {/* 当前状态 */}
      <div className="p-4 border-b border-slate-700/50 space-y-3">
        <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
          会话状态
        </h3>
        <div>
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: stateColorMap[state] || '#999' }}
            />
            <span className="text-xs text-white font-medium">
              {stateNameMap[state] || state}
            </span>
          </div>
        </div>

        {currentJob && (
          <div className="p-3 bg-slate-800 rounded-lg space-y-1.5">
            <div className="text-xs font-medium text-white">{currentJob.title}</div>
            <div className="text-[11px] text-slate-400">
              {currentJob.department} · {currentJob.location}
            </div>
            <div className="flex gap-3 text-[11px]">
              <span className="text-slate-500">
                简历 <span className="text-emerald-400 font-medium">{parsedResumes.filter(r => r.jobId === currentJob.id).length}</span>
              </span>
              {screeningResult && (
                <span className="text-slate-500">
                  推荐 <span className="text-emerald-400 font-medium">{screeningResult.recommendedCount}</span>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 快捷场景 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
          快捷操作
        </h3>

        <SceneButton emoji="📋" label="生成岗位JD" desc="@招聘助手 帮我招一个人" active={state === 'JD_GENERATING' || state === 'JD_CONFIRMING'} onClick={() => triggerSceneAction('@招聘助手 帮我招一个前端工程师，负责Web应用开发')} />
        <SceneButton emoji="📄" label="提交简历解析" desc="发送PDF/Word简历文件" active={state === 'COLLECTING'} onClick={() => triggerSceneAction('@招聘助手 提交简历（拖拽或点击📎上传文件）')} />
        <SceneButton emoji="🌟" label="AI筛选评分" desc="满3份简历后触发筛选" active={state === 'SCREENING' || state === 'SCREENING_RESULT'} onClick={() => triggerSceneAction('@招聘助手 开始筛选')} />
        <SceneButton emoji="📊" label="查看招聘进度" desc="随时了解招聘状态" onClick={() => triggerSceneAction('@招聘助手 查看招聘进度')} />

        <div className="pt-3 mt-3 border-t border-slate-700/50">
          <button
            onClick={reset}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <span>↺</span>
            重置会话
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-slate-700/50">
        <div className="flex gap-1.5">
          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded text-[10px] font-medium">MVP</span>
          <span className="px-2 py-0.5 bg-slate-700 text-slate-400 rounded text-[10px]">桌面端</span>
          <span className="px-2 py-0.5 bg-slate-700 text-slate-400 rounded text-[10px]">v1.2</span>
        </div>
      </div>
    </aside>
  );
}

function SceneButton({ emoji, label, desc, active, onClick }: { emoji: string; label: string; desc: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 ${
        active
          ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
          : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
      }`}
    >
      <span className="text-lg flex-shrink-0">{emoji}</span>
      <div className="min-w-0">
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[10px] text-slate-500 truncate">{desc}</div>
      </div>
    </button>
  );
}
