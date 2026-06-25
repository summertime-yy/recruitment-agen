/* ============================================================
   JDCard — 岗位JD 卡片（PRD 4.2.3 JD卡片模板）
   ============================================================ */

import type { JobPosition } from '../../types';

interface JDCardProps {
  data: JobPosition & { modificationSummary?: string[] };
}

export function JDCard({ data }: JDCardProps) {
  const isModified = !!data.modificationSummary;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 bg-gradient-to-b from-emerald-50/50 dark:from-emerald-900/10 to-transparent border-b border-slate-100 dark:border-slate-700">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <span className="text-lg">📋</span>
          岗位JD
          <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">
            {isModified ? '已更新' : 'AI生成'}
          </span>
        </h3>
      </div>

      {/* 修改摘要 */}
      {isModified && data.modificationSummary && (
        <div className="mx-5 mt-3 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-lg text-xs">
          <div className="font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
            🧠 已理解您的修改意见
          </div>
          {data.modificationSummary.map((change, i) => (
            <div key={i} className="text-amber-600 dark:text-amber-500 ml-3 before:content-['•'] before:mr-1.5">
              {change}
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="p-5 space-y-4">
        {/* 基本信息 */}
        <div>
          <h4 className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
            基本信息
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-slate-500 dark:text-slate-400">岗位名称：</span>
              <span className="text-slate-800 dark:text-slate-200 font-medium">{data.title}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">工作地点：</span>
              <span className="text-slate-800 dark:text-slate-200">{data.location}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">所属部门：</span>
              <span className="text-slate-800 dark:text-slate-200">{data.department}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">招聘人数：</span>
              <span className="text-slate-800 dark:text-slate-200">{data.headcount}人</span>
            </div>
          </div>
        </div>

        {/* 岗位职责 */}
        <div>
          <h4 className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
            岗位职责
          </h4>
          <ul className="text-sm text-slate-700 dark:text-slate-300 space-y-1.5 list-disc pl-5">
            {data.responsibilities.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>

        {/* 硬性条件 */}
        <div>
          <h4 className="text-[11px] font-semibold text-red-400 dark:text-red-400 uppercase tracking-wider mb-2">
            硬性条件
          </h4>
          <ul className="text-sm text-slate-700 dark:text-slate-300 space-y-1.5 list-disc pl-5">
            {data.hardRequirements.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>

        {/* 加分项 */}
        {data.bonusRequirements.length > 0 && (
          <div>
            <h4 className="text-[11px] font-semibold text-emerald-500 dark:text-emerald-400 uppercase tracking-wider mb-2">
              加分项
            </h4>
            <ul className="text-sm text-slate-700 dark:text-slate-300 space-y-1.5 list-disc pl-5">
              {data.bonusRequirements.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer with hints */}
      <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700 text-xs text-slate-400 dark:text-slate-500 space-y-1">
        <div>💡 用自然语言告诉我修改意见，比如："工作地点改成深圳" 或 "加上FPGA验证经验要求"</div>
        <div>💡 回复 "确认" 保存JD并开始收集简历</div>
      </div>
    </div>
  );
}
