import { useMemo } from 'react'
import { useAppState } from '../store/appStore'
import { STATUS_META } from '../lib/status'

const NODE_W = 118
const NODE_H = 44

interface LayoutNode {
  id: string
  label: string
  sub: string
  x: number
  y: number
  color: string
  pulsing: boolean
  dim: boolean
}

interface LayoutEdge {
  key: string
  from: string
  to: string
  active: boolean
}

/** §FR-2 任务编排 DAG：节点/边由 task.dispatch 事件驱动实时增减，保留流动虚线与图例。 */
export default function DagGraph() {
  const { agents, tasks, dispatches } = useAppState()

  const { nodes, edges, height, width } = useMemo(() => {
    const agentById = new Map(agents.map((a) => [a.id, a]))
    const taskById = new Map(tasks.map((t) => [t.id, t]))

    // 去重边（同一 from→to 多条派发合并，任一任务执行中即视为活跃）
    const edgeMap = new Map<string, LayoutEdge>()
    const involved = new Set<string>()
    for (const d of dispatches) {
      if (!d.from_agent || !d.to_agent) continue
      involved.add(d.from_agent)
      involved.add(d.to_agent)
      const key = `${d.from_agent}->${d.to_agent}`
      const active = taskById.get(d.task_id)?.status === 'running'
      const prev = edgeMap.get(key)
      edgeMap.set(key, { key, from: d.from_agent, to: d.to_agent, active: (prev?.active ?? false) || active })
    }

    if (involved.size === 0) return { nodes: [] as LayoutNode[], edges: [] as LayoutEdge[], height: 300, width: 920 }

    const SRC = '__source__'
    const SINK = '__sink__'
    const edgesArr: LayoutEdge[] = []

    // 层深：从源头 BFS
    const adj = new Map<string, string[]>()
    for (const e of edgeMap.values()) {
      adj.set(e.from, [...(adj.get(e.from) ?? []), e.to])
    }
    const hasIncoming = new Set([...edgeMap.values()].map((e) => e.to))
    const roots = [...involved].filter((id) => !hasIncoming.has(id))
    const depth = new Map<string, number>([[SRC, 0]])
    for (const r of roots) {
      depth.set(r, 1)
      edgesArr.push({ key: `${SRC}->${r}`, from: SRC, to: r, active: true })
    }
    const queue = [...roots]
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const nxt of adj.get(cur) ?? []) {
        const d = (depth.get(cur) ?? 1) + 1
        if ((depth.get(nxt) ?? -1) < d) {
          depth.set(nxt, d)
          queue.push(nxt)
        }
      }
    }
    // 兜底：环或漏网节点
    for (const id of involved) if (!depth.has(id)) depth.set(id, 1)

    const maxDepth = Math.max(...[...depth.values()])
    for (const id of involved) {
      if (!(adj.get(id)?.length)) {
        edgesArr.push({ key: `${id}->${SINK}`, from: id, to: SINK, active: false })
      }
    }
    depth.set(SINK, maxDepth + 1)

    // 分列布局
    const columns = new Map<number, string[]>()
    for (const [id, d] of depth) {
      columns.set(d, [...(columns.get(d) ?? []), id])
    }
    const maxRows = Math.max(...[...columns.values()].map((c) => c.length))
    const height = Math.max(220, maxRows * 76 + 60)
    const width = Math.max(920, (maxDepth + 1) * 190 + 140)

    const meta = (id: string): { label: string; sub: string; color: string; pulsing: boolean; dim: boolean } => {
      if (id === SRC) return { label: '需求输入', sub: '操作员 · 手动触发', color: 'var(--cyan)', pulsing: false, dim: false }
      if (id === SINK) return { label: '合并 · 发布', sub: '待全部通过', color: 'var(--ink-mute)', pulsing: false, dim: true }
      const a = agentById.get(id)
      const status = a?.status ?? 'idle'
      const m = STATUS_META[status]
      return {
        label: a?.name ?? id,
        sub: a?.model ?? '未注册',
        color: m.color,
        pulsing: status === 'running' || status === 'waiting' || status === 'blocked',
        dim: false,
      }
    }

    const nodes: LayoutNode[] = []
    for (const [d, ids] of columns) {
      const x = 70 + d * ((width - 140) / (maxDepth + 1))
      ids.forEach((id, i) => {
        const y = height / 2 + (i - (ids.length - 1) / 2) * 76
        nodes.push({ id, x, y, ...meta(id) })
      })
    }
    return { nodes, edges: [...edgeMap.values(), ...edgesArr], height, width }
  }, [agents, tasks, dispatches])

  const byId = new Map(nodes.map((n) => [n.id, n]))

  return (
    <section className="panel p-4" aria-label="任务编排依赖图">
      <div className="flex items-center justify-between mb-3">
        <h2 className="panel-title">任务编排 · DAG</h2>
        <span className="text-[10px] tracking-[0.14em] text-[var(--ink-mute)] uppercase">
          {dispatches.length} 条派发 · 流动线表示活跃数据流
        </span>
      </div>

      {nodes.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--line)] py-10 text-center text-[12px] text-[var(--ink-mute)]">
          暂无 task.dispatch 事件，等待编排派发
        </div>
      ) : (
        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full min-w-[720px]"
            role="img"
            aria-label="代理任务依赖关系图"
          >
            <defs>
              <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#26344f" />
              </marker>
              <marker id="arrow-active" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#22d3ee" />
              </marker>
            </defs>

            {edges.map((e) => {
              const a = byId.get(e.from)
              const b = byId.get(e.to)
              if (!a || !b) return null
              const x1 = a.x + NODE_W / 2
              const y1 = a.y
              const x2 = b.x - NODE_W / 2
              const y2 = b.y
              const mx = (x1 + x2) / 2
              return (
                <path
                  key={e.key}
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

            {nodes.map((n) => (
              <g key={n.id}>
                {n.pulsing && (
                  <circle cx={n.x - NODE_W / 2 + 10} cy={n.y - NODE_H / 2 + 10} r="4" fill={n.color}>
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
                  stroke={n.color}
                  strokeOpacity={n.dim ? 0.45 : 0.8}
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
            ))}
          </svg>
        </div>
      )}

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
