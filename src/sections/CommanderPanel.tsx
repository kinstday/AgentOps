import { useEffect, useMemo, useRef, useState } from 'react'
import {
  closeCommander,
  loadCommandHistory,
  openCommander,
  retryCommand,
  sendCommand,
  setCommanderThread,
  useAppState,
} from '../store/appStore'
import { fmtTime } from '../lib/status'

/**
 * §FR-8 指挥台：右下悬浮雷达按钮唤起右侧抽屉（~380px）。
 * 消息按线程分组（指挥 agent 默认 / @agent），历史落库刷新不丢，
 * 回复经 WS command.reply 实时到达；演示模式本地模拟回复并标注。
 */
export default function CommanderPanel() {
  const { commanderOpen, commanderThread, commanderPrefill, commanderPrefillSeq, commands, agents, accounts, commander, mode } =
    useAppState()
  const [draft, setDraft] = useState('')
  const [appliedPrefillSeq, setAppliedPrefillSeq] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // 卡片「对话」按钮唤起时预填 @agent（渲染期校正模式，避免 effect 内同步 setState）
  if (commanderPrefill !== null && commanderPrefillSeq !== appliedPrefillSeq) {
    setAppliedPrefillSeq(commanderPrefillSeq)
    setDraft(commanderPrefill)
  }

  // 打开面板时刷新历史（刷新页面不丢）
  useEffect(() => {
    if (commanderOpen && mode === 'live') void loadCommandHistory()
  }, [commanderOpen, mode])

  // 线程列表：指挥 agent + 历史中出现过的 agent 目标 + 当前线程
  const threads = useMemo(() => {
    const set = new Set<string>(['commander', commanderThread])
    for (const c of commands) if (c.target) set.add(c.target)
    return [...set]
  }, [commands, commanderThread])

  const threadMsgs = useMemo(
    () => commands.filter((c) => c.target === commanderThread),
    [commands, commanderThread],
  )

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [threadMsgs.length, commanderThread, commanderOpen])

  const targetAgent = agents.find((a) => a.id === commanderThread || a.name === commanderThread)
  const targetLabel = commanderThread === 'commander' ? '指挥 agent' : (targetAgent?.name ?? commanderThread)
  const targetSub =
    commanderThread === 'commander'
      ? `后端 ${commander?.backend ?? '—'}${commander?.degraded ? '（降级）' : ''}`
      : targetAgent
        ? `${targetAgent.model ?? '未知模型'} · ${accounts.find((x) => x.id === targetAgent.account_id)?.name ?? targetAgent.account_id ?? '未知账号'}`
        : '未注册 agent'

  const send = async () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await sendCommand(text)
  }

  return (
    // 包装层：避免 fixed 元素成为 .app-shell 的直接子级（.app-shell > * 会覆盖 position）
    <div>
      {/* 悬浮唤起按钮（雷达图标） */}
      <button
        onClick={() => (commanderOpen ? closeCommander() : openCommander())}
        aria-label={commanderOpen ? '关闭指挥台' : '打开指挥台'}
        className="cursor-pointer fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-[rgba(34,211,238,0.5)] bg-[var(--panel-2)] shadow-[0_0_18px_rgba(34,211,238,0.25)] hover:border-[var(--cyan)] transition-colors duration-150"
      >
        <span className="radar" style={{ width: 26, height: 26 }} aria-hidden />
      </button>

      {commanderOpen && (
        <aside
          className="cmdr-drawer fixed top-0 right-0 bottom-0 z-20 w-[380px] max-w-[92vw] flex flex-col border-l border-[var(--line)] bg-[var(--panel)]"
          aria-label="指挥台对话面板"
        >
          {/* 头部：当前对话对象及模型/账号 */}
          <div className="flex items-center gap-2.5 px-4 h-[60px] border-b border-[var(--line)] flex-none">
            <span className="led led-pulse" style={{ background: 'var(--cyan)', color: 'var(--cyan)' }} aria-hidden />
            <div className="min-w-0 leading-tight">
              <div className="text-[13px] font-semibold truncate">{targetLabel}</div>
              <div className="text-[10px] text-[var(--ink-mute)] truncate">{targetSub}</div>
            </div>
            {mode === 'demo' && (
              <span className="rounded-sm px-1.5 py-0.5 text-[9px] tracking-[0.1em] text-[var(--amber)] border border-[rgba(251,191,36,0.4)] flex-none">
                DEMO
              </span>
            )}
            <button
              onClick={closeCommander}
              aria-label="关闭"
              className="cursor-pointer ml-auto text-[var(--ink-mute)] hover:text-[var(--ink)] text-[16px] px-1 transition-colors duration-150"
            >
              ✕
            </button>
          </div>

          {/* 线程切换 */}
          <div className="flex gap-1.5 px-3 py-2 border-b border-[var(--line)] overflow-x-auto flex-none" role="tablist" aria-label="对话线程">
            {threads.map((t) => {
              const active = t === commanderThread
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCommanderThread(t)}
                  className={`cursor-pointer flex-none rounded-full border px-2.5 py-0.5 text-[10px] tracking-[0.06em] transition-colors duration-150 ${
                    active
                      ? 'border-[var(--cyan)] text-[var(--cyan)] bg-[rgba(34,211,238,0.08)]'
                      : 'border-[var(--line)] text-[var(--ink-mute)] hover:text-[var(--ink-dim)]'
                  }`}
                >
                  {t === 'commander' ? '指挥 agent' : `@${t}`}
                </button>
              )
            })}
          </div>

          {/* 消息列表 */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2.5">
            {threadMsgs.length === 0 && (
              <div className="rounded-md border border-dashed border-[var(--line)] py-8 text-center text-[11px] text-[var(--ink-mute)] leading-relaxed px-4">
                {commanderThread === 'commander'
                  ? '用自然语言描述需求或提问，指挥 agent 会结合当前状态回应'
                  : `输入消息发送给 @${commanderThread}；只读来源的 agent 无法对话`}
              </div>
            )}
            {threadMsgs.map((c) => (
              <div
                key={c.id}
                className={`max-w-[88%] rounded-md border px-3 py-2 text-[12px] leading-relaxed ${
                  c.direction === 'in'
                    ? 'self-end border-[rgba(34,211,238,0.35)] bg-[rgba(34,211,238,0.07)] text-[var(--ink)]'
                    : 'self-start border-[var(--line)] bg-[var(--panel-2)] text-[var(--ink-dim)]'
                }`}
              >
                <div className="whitespace-pre-wrap break-words">{c.text}</div>
                <div className="mt-1 flex items-center gap-2 text-[9px] text-[var(--ink-mute)] tabular-nums">
                  <span>{fmtTime(c.ts)}</span>
                  {c.direction === 'out' && c.cost_tokens > 0 && <span>{c.cost_tokens} tok</span>}
                  {c.pending && <span className="text-[var(--cyan)]">发送中…</span>}
                  {c.failed && (
                    <button
                      onClick={() => void retryCommand(c.id)}
                      className="cursor-pointer text-[var(--red)] underline underline-offset-2 hover:text-[var(--ink)]"
                    >
                      发送失败 · 重发
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 输入区 */}
          <div className="flex-none border-t border-[var(--line)] p-3">
            {mode === 'demo' && (
              <div className="mb-2 text-[10px] text-[var(--amber)]">演示模式：回复为本地模拟，不入库</div>
            )}
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={2}
                placeholder={commanderThread === 'commander' ? '描述需求，或用 @agent名 点名…' : `发给 @${commanderThread}…`}
                className="flex-1 resize-none rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-mute)] focus:border-[var(--cyan)] focus:outline-none"
              />
              <button
                onClick={() => void send()}
                disabled={!draft.trim()}
                className="cursor-pointer self-end rounded-md border border-[var(--cyan)] px-3 py-2 text-[11px] tracking-[0.1em] text-[var(--cyan)] hover:bg-[rgba(34,211,238,0.1)] transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                发送
              </button>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
