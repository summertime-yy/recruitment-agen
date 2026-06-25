/* ============================================================
   AgentGraph — Agent 拓扑关系图
   使用 SVG 展示5个 Agent 节点和调用边，实时状态动画
   ============================================================ */

import { useEffect, useState, useRef, useCallback } from 'react';
import type { AgentTrace, AgentName, TraceStatus } from '../../lib/agent-tracer';
import { getAgentTracer } from '../../lib/agent-tracer';

// === 节点布局定义 ===
interface GraphNode {
  id: AgentName;
  label: string;
  icon: string;
  x: number;
  y: number;
  description: string;
}

const NODES: GraphNode[] = [
  { id: 'intent-router', label: '意图路由', icon: '🧭', x: 50, y: 120, description: '分析用户意图，路由到对应Agent' },
  { id: 'jd-generator', label: 'JD生成器', icon: '📋', x: 240, y: 40, description: '生成/修改岗位JD' },
  { id: 'resume-parser', label: '简历解析', icon: '📄', x: 240, y: 200, description: '解析简历文本，提取结构化信息' },
  { id: 'screening-scorer', label: '筛选评分', icon: '🌟', x: 430, y: 120, description: '5维度评分，排序推荐' },
  { id: 'progress-tracker', label: '进度追踪', icon: '📊', x: 620, y: 120, description: '招聘进度查询与报告' },
];

// === 边定义 ===
interface GraphEdge {
  from: AgentName;
  to: AgentName;
  label: string;
  path: string; // SVG path d
}

const EDGES: GraphEdge[] = [
  { from: 'intent-router', to: 'jd-generator', label: 'JD生成意图', path: 'M110,130 C170,80 180,60 235,55' },
  { from: 'intent-router', to: 'resume-parser', label: '简历/筛选意图', path: 'M110,140 C170,190 180,210 235,210' },
  { from: 'jd-generator', to: 'screening-scorer', label: '岗位信息', path: 'M300,55 C360,90 370,120 425,120' },
  { from: 'resume-parser', to: 'screening-scorer', label: '简历数据', path: 'M300,210 C360,170 370,140 425,130' },
  { from: 'screening-scorer', to: 'progress-tracker', label: '评分结果', path: 'M490,130 C550,130 560,130 615,130' },
];

// === 状态颜色映射 ===
const STATUS_COLORS: Record<TraceStatus, { dot: string; glow: string; border: string }> = {
  pending: { dot: '#94a3b8', glow: '#94a3b820', border: '#94a3b8' },
  running: { dot: '#22c55e', glow: '#22c55e40', border: '#22c55e' },
  success: { dot: '#3b82f6', glow: '#3b82f620', border: '#3b82f6' },
  error: { dot: '#ef4444', glow: '#ef444440', border: '#ef4444' },
  timeout: { dot: '#f59e0b', glow: '#f59e0b40', border: '#f59e0b' },
};

const AGENT_LABELS: Record<AgentName, string> = {
  'intent-router': '意图路由',
  'jd-generator': 'JD生成器',
  'resume-parser': '简历解析',
  'screening-scorer': '筛选评分',
  'progress-tracker': '进度追踪',
};

export interface AgentGraphProps {
  onSelectAgent?: (agent: AgentName) => void;
  selectedAgent?: AgentName | null;
}

export function AgentGraph({ onSelectAgent, selectedAgent }: AgentGraphProps) {
  const [agentStates, setAgentStates] = useState<Record<AgentName, {
    status: TraceStatus;
    lastCallTime?: number;
    callCount: number;
    errorCount: number;
    avgDuration: number;
  }>>(() => {
    const initial: Record<string, { status: TraceStatus; callCount: number; errorCount: number; avgDuration: number }> = {};
    for (const n of NODES) {
      initial[n.id] = { status: 'pending', callCount: 0, errorCount: 0, avgDuration: 0 };
    }
    return initial as Record<AgentName, { status: TraceStatus; lastCallTime?: number; callCount: number; errorCount: number; avgDuration: number }>;
  });

  const [activeEdges, setActiveEdges] = useState<Set<string>>(new Set());
  const [pulseNodes, setPulseNodes] = useState<Set<string>>(new Set());

  // 订阅 tracer 事件
  useEffect(() => {
    const tracer = getAgentTracer();

    const unsub = tracer.subscribe((event) => {
      if (event.type === 'trace-start' && event.trace) {
        const agent = event.trace.agentName;
        setAgentStates(prev => ({
          ...prev,
          [agent]: {
            ...prev[agent],
            status: 'running' as TraceStatus,
            lastCallTime: event.timestamp,
            callCount: prev[agent].callCount + 1,
          },
        }));
        setPulseNodes(prev => new Set(prev).add(agent));

        // 高亮相关的边
        const relatedEdges = EDGES.filter(e => e.from === agent || e.to === agent);
        setActiveEdges(prev => {
          const next = new Set(prev);
          relatedEdges.forEach(e => next.add(`${e.from}-${e.to}`));
          return next;
        });

        // 1.5秒后取消脉冲
        setTimeout(() => {
          setPulseNodes(prev => {
            const next = new Set(prev);
            next.delete(agent);
            return next;
          });
          setActiveEdges(prev => {
            const next = new Set(prev);
            relatedEdges.forEach(e => next.delete(`${e.from}-${e.to}`));
            return next;
          });
        }, 1500);
      }

      if ((event.type === 'trace-complete' || event.type === 'trace-error') && event.trace) {
        const agent = event.trace.agentName;
        const isError = event.type === 'trace-error';
        setAgentStates(prev => ({
          ...prev,
          [agent]: {
            ...prev[agent],
            status: isError ? 'error' : 'success',
            errorCount: isError ? prev[agent].errorCount + 1 : prev[agent].errorCount,
            avgDuration: event.trace?.duration
              ? Math.round((prev[agent].avgDuration * (prev[agent].callCount - 1) + event.trace.duration) / prev[agent].callCount)
              : prev[agent].avgDuration,
          },
        }));
      }
    });

    return unsub;
  }, []);

  const handleNodeClick = useCallback((agent: AgentName) => {
    onSelectAgent?.(agent);
  }, [onSelectAgent]);

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  return (
    <svg viewBox="0 0 760 260" className="w-full h-auto max-w-[760px] mx-auto">
      <defs>
        {/* 箭头标记 */}
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill={isDark ? '#64748b' : '#94a3b8'} />
        </marker>
        <marker id="arrowhead-active" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#22c55e" />
        </marker>

        {/* 发光滤镜 */}
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* 脉冲动画的渐变 */}
        <radialGradient id="pulseGrad" cx="50%" cy="50%" r="50%">
          <animate attributeName="r" values="30%;50%;30%" dur="1s" repeatCount="indefinite" />
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3">
            <animate attributeName="stop-opacity" values="0.3;0.6;0.3" dur="1s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 边 */}
      {EDGES.map((edge) => {
        const edgeKey = `${edge.from}-${edge.to}`;
        const isActive = activeEdges.has(edgeKey);

        return (
          <g key={edgeKey}>
            {/* 光晕效果（活跃时） */}
            {isActive && (
              <path
                d={edge.path}
                fill="none"
                stroke="#22c55e"
                strokeWidth="6"
                strokeOpacity="0.15"
                markerEnd="url(#arrowhead-active)"
              />
            )}
            <path
              d={edge.path}
              fill="none"
              stroke={isActive ? '#22c55e' : isDark ? '#475569' : '#cbd5e1'}
              strokeWidth={isActive ? '2' : '1.5'}
              strokeDasharray={isActive ? '6,3' : '0'}
              markerEnd={isActive ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
              className={isActive ? 'animate-pulse' : ''}
              style={{ transition: 'all 0.3s ease' }}
            />
            {/* 边标签 */}
            <text
              x={edge.path.match(/M(\d+)/)?.[1]
                ? parseInt(edge.path.match(/M(\d+)/![1]) + (edge.from === 'intent-router' ? 70 : 50))
                : 0}
              y={edge.from === 'jd-generator' ? 35 : edge.from === 'resume-parser' ? 230 : edge.from === 'intent-router' ? (edge.to === 'jd-generator' ? 85 : 0) : 40}
              fontSize="10"
              fill={isDark ? '#64748b' : '#94a3b8'}
              textAnchor="middle"
              className="select-none"
            >
              {edge.label}
            </text>
          </g>
        );
      })}

      {/* User Input 节点（虚拟） */}
      <rect x="0" y="112" width="40" height="16" rx="8" fill={isDark ? '#1e293b' : '#f1f5f9'} stroke={isDark ? '#334155' : '#e2e8f0'} strokeWidth="1" />
      <text x="20" y="124" fontSize="9" fill={isDark ? '#64748b' : '#94a3b8'} textAnchor="middle" className="select-none">用户</text>
      <line x1="40" y1="120" x2="55" y2="128" stroke={isDark ? '#475569' : '#cbd5e1'} strokeWidth="1" markerEnd="url(#arrowhead)" />

      {/* Output 指示（虚拟） */}
      <text x="720" y="125" fontSize="10" fill={isDark ? '#475569' : '#94a3b8'} textAnchor="middle" className="select-none">→ 响应</text>

      {/* Agent 节点 */}
      {NODES.map((node) => {
        const state = agentStates[node.id];
        const colors = STATUS_COLORS[state.status];
        const isActive = state.status === 'running';
        const isSelected = selectedAgent === node.id;
        const isPulsing = pulseNodes.has(node.id);

        return (
          <g
            key={node.id}
            transform={`translate(${node.x},${node.y})`}
            onClick={() => handleNodeClick(node.id)}
            className="cursor-pointer"
            style={{ transition: 'transform 0.2s ease' }}
          >
            {/* 脉冲光环（运行中） */}
            {isPulsing && (
              <circle cx="0" cy="0" r="35" fill="url(#pulseGrad)" />
            )}

            {/* 节点背景 */}
            <rect
              x="-50" y="-28"
              width="100" height="56"
              rx="12"
              fill={isDark ? '#1e293b' : '#ffffff'}
              stroke={isSelected ? '#3b82f6' : colors.border}
              strokeWidth={isSelected ? '2.5' : '1.5'}
              filter={isActive ? 'url(#glow)' : undefined}
              style={{ transition: 'all 0.3s ease' }}
            />

            {/* 选中高亮 */}
            {isSelected && (
              <rect
                x="-50" y="-28"
                width="100" height="56"
                rx="12"
                fill="#3b82f610"
                stroke="#3b82f6"
                strokeWidth="2.5"
                style={{ transition: 'all 0.3s ease' }}
              />
            )}

            {/* 状态指示点 */}
            <circle
              cx="-37" cy="-18"
              r="4"
              fill={colors.dot}
              className={isActive ? 'animate-pulse' : ''}
            />

            {/* Agent 图标 */}
            <text x="-35" y="4" fontSize="20" className="select-none">{node.icon}</text>

            {/* Agent 名称 */}
            <text
              x="0" y="-6"
              fontSize="11"
              fontWeight="600"
              fill={isDark ? '#e2e8f0' : '#334155'}
              textAnchor="middle"
              className="select-none"
            >
              {node.label}
            </text>

            {/* 调用统计 */}
            <text
              x="0" y="12"
              fontSize="9"
              fill={isDark ? '#64748b' : '#94a3b8'}
              textAnchor="middle"
              className="select-none"
            >
              {state.callCount > 0
                ? `${state.callCount}次调用 · ${state.avgDuration}ms`
                : '等待调用'}
            </text>

            {/* 错误计数 */}
            {state.errorCount > 0 && (
              <circle cx="38" cy="-18" r="8" fill="#ef4444">
                <title>错误次数: {state.errorCount}</title>
              </circle>
            )}
            {state.errorCount > 0 && (
              <text x="38" y="-14" fontSize="9" fill="#fff" textAnchor="middle" fontWeight="bold" className="select-none">
                {state.errorCount}
              </text>
            )}
          </g>
        );
      })}

      {/* 标题 */}
      <text x="380" y="20" fontSize="14" fontWeight="700" fill={isDark ? '#e2e8f0' : '#1e293b'} textAnchor="middle" className="select-none">
        Agent 拓扑关系图
      </text>
    </svg>
  );
}
