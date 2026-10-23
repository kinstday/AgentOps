import { DAG_EDGES, DAG_NODES, STATUS_META, type DagNode } from '../data/mock'

const NODE_W = 118
const NODE_H = 44

function nodeColor(n: DagNode): string {
  if (n.status === 'source') return 'var(--cyan)'
  if (n.status === 'sink') return 'var(--ink-mute)'
  return STATUS_META[n.status].color
}

export default function DagGraph() {
  const byId = Object.fromEntries(DAG_NODES.map((n) => [n.id, n]))

  return (
    <section className="panel p-4" aria-label="任务编排依赖图">
      <div className="flex items-center justify-between mb-3">
        <h2 className="panel-title">任务编排 · DAG</h2>
        <span className="text-[10px] tracking-[0.14em] text-[var(--ink-mute)] uppercase">
          会话 S-0187 · 流动线表示活跃数据流
        </span>
      </div>

      <div className="w-full overflow-x-auto">
        <svg viewBox="0 0 920 300" className="w-full min-w-[720px]" role="img" aria-label="代理任务依赖关系图">
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#26344f" />
            </marker>
            <marker id="arrow-active" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#22d3ee" />
            </marker>
          </defs>

          {DAG_EDGES.map((e) => {
            const a = byId[e.from]
            const b = byId[e.to]
            const x1 = a.x + NODE_W / 2
            const y1 = a.y
            const x2 = b.x - NODE_W / 2
            const y2 = b.y
            const mx = (x1 + x2) / 2
            return (
              <path
                key={`${e.from}-${e.to}`}
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={e.active ? '#22d3ee' : '#26344f'}
                strokeWidth={e.active ? 1.6 : 1.2}
                className={e.active ? 'flow-line' : 'flow-line-slow'}
                opacity={e.active ? 0.9 : 0.55}
                markerEnd={e.active ? 'url(#arrow-active)' : 'url(#arrow)'}
              />
            )
          })}

          {DAG_NODES.map((n) => {
            const c = nodeColor(n)
            const pulsing = n.status === 'running' || n.status === 'waiting' || n.status === 'blocked'
            return (
              <g key={n.id}>
                {pulsing && (
                  <circle cx={n.x - NODE_W / 2 + 10} cy={n.y - NODE_H / 2 + 10} r="4" fill={c}>
                    <animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                )}
                <rect
                  x={n.x - NODE_W / 2}
                  y={n.y - NODE_H / 2}
                  width={NODE_W}
                  height={NODE_H}
                  rx="7"
                  fill="#0c1220"
                  stroke={c}
                  strokeOpacity={n.status === 'sink' ? 0.45 : 0.8}
                  strokeWidth="1.2"
                />
                <text
                  x={n.x}
                  y={n.y - 3}
                  textAnchor="middle"
                  fill="#d7e2f2"
                  fontSize="11.5"
                  fontWeight="600"
                  fontFamily="JetBrains Mono, Noto Sans SC, monospace"
                >
                  {n.label}
                </text>
                <text
                  x={n.x}
                  y={n.y + 13}
                  textAnchor="middle"
                  fill="#56678c"
                  fontSize="9.5"
                  fontFamily="JetBrains Mono, Noto Sans SC, monospace"
                >
                  {n.sub}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="flex gap-4 mt-3 text-[10px] tracking-[0.1em] text-[var(--ink-mute)] flex-wrap">
        {(['running', 'waiting', 'blocked', 'done'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="led" style={{ background: STATUS_META[s].color }} />
            {STATUS_META[s].label}
          </span>
        ))}
      </div>
    </section>
  )
}
