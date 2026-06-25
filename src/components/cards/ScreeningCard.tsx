/* ============================================================
   ScreeningCard — AI筛选评分报告卡片（PRD 4.2.3 筛选报告模板）
   ============================================================ */

import type { CandidateScore } from '../../types';

interface ScreeningCardProps {
  data: {
    jobTitle: string;
    totalResumes: number;
    scoredResumes: number;
    recommendedCount: number;
    topCandidates: CandidateScore[];
    averageScore?: number;
  };
}

export function ScreeningCard({ data }: ScreeningCardProps) {
  const rankColors = ['bg-[#ff6b35]', 'bg-[#4a90d9]', 'bg-emerald-500'];

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 bg-gradient-to-b from-emerald-50/50 dark:from-emerald-900/10 to-transparent border-b border-slate-100 dark:border-slate-700">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <span className="text-lg">🌟</span>
          筛选报告
        </h3>
      </div>

      {/* 汇总 */}
      <div className="px-5 pt-4 pb-2">
        <div className="text-sm text-slate-700 dark:text-slate-300 mb-3">
          <strong>岗位：</strong>{data.jobTitle}
        </div>
        <div className="flex items-center gap-4 text-xs">
          <StatBadge label="简历总数" value={data.totalResumes.toString()} />
          <StatBadge label="已完成评分" value={data.scoredResumes.toString()} />
          <StatBadge
            label="推荐面试"
            value={data.recommendedCount.toString()}
            highlight
          />
          {data.averageScore != null && (
            <StatBadge label="平均分" value={data.averageScore.toString()} />
          )}
        </div>
      </div>

      {/* Top 候选人列表 */}
      <div className="px-5 pb-2">
        <h4 className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3 mt-2">
          Top {Math.min(3, data.topCandidates.length)} 候选人
        </h4>
        <div className="space-y-3">
          {data.topCandidates.map((candidate, idx) => (
            <CandidateRow
              key={candidate.resumeId}
              candidate={candidate}
              rank={candidate.rank || idx + 1}
              rankColor={rankColors[candidate.rank ? candidate.rank - 1 : idx] || rankColors[2]}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700 text-xs text-slate-400 dark:text-slate-500 space-y-1">
        <div>💡 回复 "查看 [姓名] 详情" 看完整评分明细</div>
        <div>💡 回复 "导出报告" 生成筛选报告文件</div>
      </div>
    </div>
  );
}

function StatBadge({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${highlight ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/30' : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}>
      <span className={`font-semibold ${highlight ? 'text-emerald-600 dark:text-emerald-400 text-sm' : 'text-slate-700 dark:text-slate-300'}`}>{value}</span>
      <span className="text-[10px] text-slate-400 dark:text-slate-500">{label}</span>
    </div>
  );
}

function CandidateRow({ candidate, rank, rankColor }: { candidate: CandidateScore; rank: number; rankColor: string }) {
  return (
    <div className="p-3 rounded-lg border border-slate-100 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-6 h-6 rounded-full ${rankColor} text-white text-xs font-bold flex items-center justify-center`}>
          {rank}
        </span>
        <strong className="text-sm text-slate-800 dark:text-slate-200">{candidate.candidateName}</strong>
        <span className="ml-auto text-lg font-bold text-emerald-600 dark:text-emerald-400">{candidate.totalScore}<span className="text-xs font-normal text-slate-400">分</span></span>
      </div>

      {/* 维度得分 */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {candidate.dimensions.map((dim, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-slate-400 dark:text-slate-500 w-16 truncate">{dim.name}</span>
            <ScoreBar score={dim.score} maxScore={dim.maxScore} />
            <span className="text-slate-700 dark:text-slate-300 font-medium w-8 text-right">{dim.score}</span>
          </div>
        ))}
      </div>

      {/* 亮点 */}
      <div className="mt-2 pt-2 border-t border-slate-50 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
        💬 {candidate.highlight}
      </div>
    </div>
  );
}

function ScoreBar({ score, maxScore }: { score: number; maxScore: number }) {
  const pct = (score / maxScore) * 100;
  return (
    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
