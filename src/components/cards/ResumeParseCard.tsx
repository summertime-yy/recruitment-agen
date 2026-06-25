/* ============================================================
   ResumeParseCard — 简历解析结果卡片 v1.4
   布局: 上解析结果 + 下原始文件（可折叠对照）
   空值统一显示 "待确认"、不再编造默认值
   ============================================================ */

import { useState } from 'react';
import type { ParsedResume, JobPosition } from '../../types';

interface ResumeParseCardProps {
  data: {
    resume: ParsedResume;
    jobs: JobPosition[];
    requirePositionSelection: boolean;
  };
}

/** 安全显示值：空/0 → "待确认"，有效值 → 原样 */
function safeField(value: string | number | undefined | null, suffix = ''): string {
  if (value === undefined || value === null) return '待确认';
  if (typeof value === 'number' && value === 0) return '待确认';
  if (typeof value === 'string' && value.trim() === '') return '待确认';
  return `${value}${suffix}`;
}

/** 判断字段是否需要高亮标记为"待确认" */
function isMissing(value: string | number | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'number' && value === 0) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

export function ResumeParseCard({ data }: ResumeParseCardProps) {
  const { resume } = data;
  const [showOriginal, setShowOriginal] = useState(false);
  const hasOriginal = !!resume.originalText && resume.originalText.trim().length > 0;

  const confidenceBadge = {
    high: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    low: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  };

  const confidenceLabel = {
    high: '高置信度',
    medium: '中置信度',
    low: '低置信度',
  };

  const confidenceInfo = {
    high: '解析结果较为可靠，建议核对关键字段',
    medium: '部分字段可能不准确，建议对照原文检查',
    low: '多项字段未能确认，建议手动补充',
  };

  const fileIcon = resume.sourceFileType === 'pdf' ? '📕' : resume.sourceFileType === 'word' ? '📘' : '📄';
  const fileTypeLabel = resume.sourceFileType === 'pdf' ? 'PDF' : resume.sourceFileType === 'word' ? 'Word' : '文本';

  // 统计确认/待确认字段数
  const fieldsToCheck = [
    { label: '姓名', value: resume.name },
    { label: '年龄', value: resume.age },
    { label: '学历', value: resume.degree },
    { label: '院校', value: resume.school },
    { label: '专业', value: resume.major },
    { label: '工作年限', value: resume.workYears },
    { label: '现居', value: resume.city },
  ];
  const confirmedCount = fieldsToCheck.filter(f => !isMissing(f.value)).length;
  const totalCount = fieldsToCheck.length;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* ============================================================ */}
      {/* Header: 标题 + 置信度 + 确认进度 */}
      {/* ============================================================ */}
      <div className="px-5 py-3 bg-gradient-to-b from-blue-50/50 dark:from-blue-900/10 to-transparent border-b border-slate-100 dark:border-slate-700">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span className="text-lg">📄</span>
            简历解析完成
          </h3>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${confidenceBadge[resume.confidence]}`}>
            {confidenceLabel[resume.confidence]}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {/* 确认进度条 */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400">
              字段确认 {confirmedCount}/{totalCount}
            </span>
            <div className="w-20 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  confirmedCount === totalCount ? 'bg-emerald-400'
                  : confirmedCount >= totalCount * 0.6 ? 'bg-amber-400'
                  : 'bg-red-400'
                }`}
                style={{ width: `${(confirmedCount / totalCount) * 100}%` }}
              />
            </div>
          </div>
          {/* 置信度说明 */}
          <span className="text-slate-400 dark:text-slate-500">
            {confidenceInfo[resume.confidence]}
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 上半部分：解析后的结构化字段 */}
      {/* ============================================================ */}
      <div className="p-5 space-y-4">
        {/* 基本信息 */}
        <div>
          <h4 className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
            基本信息
          </h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <InfoRow label="姓名" value={safeField(resume.name)} missing={isMissing(resume.name)} />
            <InfoRow label="年龄" value={safeField(resume.age, '岁')} missing={isMissing(resume.age)} />
            <InfoRow label="最高学历" value={safeField(resume.degree)} missing={isMissing(resume.degree)} />
            <InfoRow label="毕业院校" value={safeField(resume.school)} missing={isMissing(resume.school)} />
            <InfoRow label="专业" value={safeField(resume.major)} missing={isMissing(resume.major)} />
            <InfoRow label="工作年限" value={safeField(resume.workYears, '年')} missing={isMissing(resume.workYears)} />
            <InfoRow label="现居" value={safeField(resume.city)} missing={isMissing(resume.city)} />
          </div>
        </div>

        {/* 工作经历 */}
        {resume.experiences.length > 0 && (
          <div>
            <h4 className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
              工作经历
            </h4>
            <ul className="text-sm text-slate-700 dark:text-slate-300 space-y-1.5">
              {resume.experiences.map((exp, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0 mt-1.5" />
                  <span>
                    <strong>{exp.role || '待确认'}</strong>
                    {exp.company && (
                      <><span className="text-slate-400 dark:text-slate-500 mx-1">|</span>{exp.company}</>
                    )}
                    <span className="text-slate-400 dark:text-slate-500 mx-1">|</span>
                    <span className="text-slate-500 dark:text-slate-400">{exp.period || '待确认'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 技能标签 */}
        {resume.skills.length > 0 && (
          <div>
            <h4 className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
              技能标签
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {resume.skills.map((skill, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-full text-xs font-medium border border-emerald-100 dark:border-emerald-900/30"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 缺失字段提醒 */}
        {resume.missingFields && resume.missingFields.length > 0 && (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-lg">
            <span className="text-amber-500 text-sm flex-shrink-0 mt-0.5">⚠️</span>
            <div className="text-xs text-amber-700 dark:text-amber-300">
              <span className="font-medium">以下字段未能识别：</span>
              <span>{resume.missingFields.join('、')}</span>
              <span className="block mt-0.5 text-amber-600 dark:text-amber-400">
                请展开下方原文对照检查，或手动编辑补充。
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* 下半部分：原始文件对照（可折叠） */}
      {/* ============================================================ */}
      {hasOriginal && (
        <div className="border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className="w-full px-5 py-2.5 flex items-center justify-between text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              {fileIcon}
              <span className="font-medium">{resume.fileName}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                {fileTypeLabel}
              </span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                · {resume.originalText!.length.toLocaleString()} 字符
              </span>
            </span>
            <span className={`transform transition-transform duration-200 text-slate-400 ${showOriginal ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </button>

          {showOriginal && (
            <div className="px-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">
                  📋 原始文本 — 对照核查解析结果
                </span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 max-h-[280px] overflow-y-auto">
                <pre className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap font-mono leading-relaxed">
                  {resume.originalText}
                </pre>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">
                以上为从简历文件中提取的原始文本。当上方解析字段显示"待确认"时，请对照此原文手动核查。
              </p>
            </div>
          )}

          {!showOriginal && (
            <div className="px-5 pb-2">
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                点击展开原始文本，对照核查解析准确性
              </p>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 关联岗位提示 */}
      {/* ============================================================ */}
      {data.requirePositionSelection && (
        <div className="px-5 py-3 bg-emerald-50/50 dark:bg-emerald-900/10 border-t border-emerald-100 dark:border-emerald-900/20">
          <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium mb-1">
            🔗 请选择关联岗位
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            在下方快捷操作中选择要关联的岗位
          </p>
        </div>
      )}
    </div>
  );
}

/** 信息行组件 — 空值用橙色样式标记"待确认" */
function InfoRow({ label, value, missing }: { label: string; value: string; missing: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-slate-400 dark:text-slate-500 text-xs whitespace-nowrap">{label}</span>
      {missing ? (
        <span className="text-amber-500 dark:text-amber-400 font-medium text-xs italic">
          {value}
        </span>
      ) : (
        <span className="text-slate-800 dark:text-slate-200 font-medium">{value}</span>
      )}
    </div>
  );
}
