/* ============================================================
   DetailCard — 候选人评分明细卡片（PRD US-3 Scenario 4）
   ============================================================ */

import type { ScoreDimension } from '../../types';

interface DetailCardProps {
  data: {
    candidateName: string;
    totalScore: number;
    dimensions: ScoreDimension[];
    matchedKeywords: string;
    gaps: string;
    summary: string;
  };
}

export function DetailCard({ data }: DetailCardProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-5 py-3 bg-gradient-to-b from-amber-50/50 dark:from-amber-900/10 to-transparent border-b border-slate-100 dark:border-slate-700">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <span className="text-lg">🔍</span>
          {data.candidateName} — 评分明细
        </h3>
      </div>

      <div className="p-5 space-y-4">
        {/* 各维度得分 */}
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                <th className="text-left pb-2">维度</th>
                <th className="text-right pb-2 w-12">得分</th>
                <th className="text-right pb-2 w-12">满分</th>
                <th className="text-left pb-2 pl-2">评价</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {data.dimensions.map((dim, i) => (
                <tr key={i} className="group">
                  <td className="py-2 text-slate-700 dark:text-slate-300">{dim.name}</td>
                  <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-200">{dim.score}</td>
                  <td className="py-2 text-right text-slate-400 dark:text-slate-500">{dim.maxScore}</td>
                  <td className="py-2 pl-2">
                    <div className="w-full max-w-[120px] h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
                        style={{ width: `${(dim.score / dim.maxScore) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                <td className="py-3 font-bold text-slate-800 dark:text-slate-200">总分</td>
                <td className="py-3 text-right" colSpan={3}>
                  <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{data.totalScore}</span>
                  <span className="text-sm text-slate-400 ml-1">/ 100</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 各维度理由 */}
        <div className="space-y-2">
          {data.dimensions.map((dim, i) => (
            <div key={i} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-xs">
              <div className="font-medium text-slate-700 dark:text-slate-300 mb-1">{dim.name}</div>
              <div className="text-slate-500 dark:text-slate-400">{dim.reason}</div>
              {dim.matchedKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {dim.matchedKeywords.map((kw, j) => (
                    <span key={j} className="px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded text-[10px]">
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* AI建议 */}
        <div className="p-4 bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/20 rounded-lg">
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-1">
            💡 AI建议
          </div>
          <div className="text-sm text-slate-700 dark:text-slate-300">
            {data.summary}
          </div>
        </div>
      </div>
    </div>
  );
}
