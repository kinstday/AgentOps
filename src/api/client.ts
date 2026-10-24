import type { AgentEvent, CommandRecord, StateSnapshot } from '../types/events'

/** ISO8601 带本地时区偏移（与后端 nowIso 口径一致）。 */
export function nowIsoLocal(d: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const offMin = -d.getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(offMin) / 60))
  const om = pad(Math.abs(offMin) % 60)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${sign}${oh}:${om}`
  )
}

// ---------- REST ----------

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string; message?: string; readonly?: boolean }
      if (body.error) detail = body.error
      else if (body.message) detail = body.message
    } catch {
      /* 保持 HTTP 状态码 */
    }
    const err = new Error(detail) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return (await res.json()) as T
}

export function fetchState(): Promise<StateSnapshot> {
  return req<StateSnapshot>('/api/state')
}

export async function fetchCommandHistory(limit = 50): Promise<CommandRecord[]> {
  const res = await req<{ ok: boolean; history: CommandRecord[] }>(`/api/command/history?limit=${limit}`)
  return res.history
}

export interface CommandResult {
  ok: boolean
  target: string
  reply: string
  backend?: string
  degraded?: boolean
  readonly?: boolean
  error?: string
}

export function postCommand(target: string, text: string): Promise<CommandResult> {
  return req<CommandResult>('/api/command', {
    method: 'POST',
    body: JSON.stringify({ target, text }),
  })
}

export interface ControlResult {
  ok: boolean
  readonly?: boolean
  message?: string
  error?: string
}

export function postAgentAction(id: string, action: 'pause' | 'resume' | 'approve' | 'reject'): Promise<ControlResult> {
  return req<ControlResult>(`/api/agents/${encodeURIComponent(id)}/${action}`, { method: 'POST' })
}

// ---------- WS（断线指数退避重连） ----------

export type StreamMessage =
  | { type: 'hello'; data: { ts: string } }
  | { type: 'event'; data: AgentEvent }
  | { type: 'alerts'; data: StateSnapshot['alerts'] }

export interface StreamHandlers {
  onMessage: (msg: StreamMessage) => void
  /** 连接建立（每次重连成功都会触发，调用方应重新全量对齐） */
  onOpen: () => void
  onClose: () => void
}

export class StreamClient {
  private ws: WebSocket | null = null
  private closed = false
  private attempts = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private handlers: StreamHandlers

  constructor(handlers: StreamHandlers) {
    this.handlers = handlers
  }

  start(): void {
    this.closed = false
    this.connect()
  }

  stop(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.ws?.close()
    this.ws = null
  }

  private connect(): void {
    if (this.closed) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/stream`)
    this.ws = ws

    ws.onopen = () => {
      this.attempts = 0
      this.handlers.onOpen()
    }
    ws.onmessage = (evt) => {
      try {
        this.handlers.onMessage(JSON.parse(String(evt.data)) as StreamMessage)
      } catch {
        /* 忽略无法解析的帧 */
      }
    }
    ws.onclose = () => {
      this.ws = null
      this.handlers.onClose()
      if (this.closed) return
      // 指数退避：1s → 2s → 4s …封顶 30s
      const delay = Math.min(30_000, 1000 * 2 ** this.attempts)
      this.attempts += 1
      this.timer = setTimeout(() => this.connect(), delay)
    }
    ws.onerror = () => {
      ws.close()
    }
  }
}
