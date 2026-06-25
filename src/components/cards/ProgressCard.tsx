/* ============================================================
   ProgressCard — 招聘进度卡片（PRD US-4）
   ============================================================ */

interface ProgressCardProps {
  data: {
    jobTitle: string;
    state: string;
    jdGenerated: boolean;
    jdConfirmed: boolean;
    resumeCount: number;
    parsedCount: number;
    scoredCount: number;
    recommendedCount: number;
    lastOperation: string;
    lastOperator: string;
    lastOperatedAt: number;
    nextAction?: string;
  };
}

export function ProgressCard({ data }: ProgressCardProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-5 py-3 bg-gradient-to-b from-slate-50 dark:from-slate-800 to-transparent border-b border-slate-100 dark:border-slate-700">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <span className="text-lg">📊</span>
          招聘进度
        </h3>
      </div>

      <div className="p-5">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
            <TableRow label="岗位" value={data.jobTitle} />
            <TableRow label="状态" value={data.state} isStatus />
            <TableRow
              label="JD"
              value={data.jdConfirmed ? '✅ 已生成并确认' : data.jdGenerated ? '📋 已生成，待确认' : '❌ 未生成'}
            />
            <TableRow label="简历收集" value={`${data.resumeCount} 份`} />
            <TableRow label="已解析" value={`${data.parsedCount} 份`} />
            <TableRow label="已评分" value={`${data.scoredCount} 份`} />
            <TableRow label="推荐面试" value={data.scoredCount > 0 ? `${data.recommendedCount} 份` : '—'} />
            <TableRow label="最近操作" value={data.lastOperation} subtext={data.lastOperator} />
          </tbody>
        </table>

        {data.nextAction && (
          <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/20 rounded-lg text-xs text-emerald-700 dark:text-emerald-300">
            💡 {data.nextAction}
          </div>
        )}
      </div>
    </div>
  );
}

function TableRow({ label, value, subtext, isStatus }: {
  label: string; value: string; subtext?: string; isStatus?: boolean;
}) {
  return (
    <tr>
      <td className="py-2 pr-4 text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap">{label}</td>
      <td className="py-2 text-slate-800 dark:text-slate-200">
        {isStatus ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{value}</span> : value}
        {subtext && <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{subtext}</span>}
      </td>
    </tr>
  );
}
