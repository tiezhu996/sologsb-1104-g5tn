import type { DisassemblyStep, StepAction, StepDirection, StepTool } from '../../types/step'
import type { ProofDraft } from '../../types/proof'
import { useProofStore } from '../../stores/proofStore'

interface StepPanelProps {
  draft: ProofDraft
}

const actions: StepAction[] = ['拆卸', '装配']
const directions: StepDirection[] = ['轴向', '侧向', '斜向']
const tools: StepTool[] = ['木槌', '鱼线', '撬板']

export function StepPanel({ draft }: StepPanelProps) {
  const updateStep = useProofStore((state) => state.updateStep)
  const moveStep = useProofStore((state) => state.moveStep)
  const addStep = useProofStore((state) => state.addStep)
  const removeStep = useProofStore((state) => state.removeStep)

  const steps = [...draft.bundle.steps].sort((a, b) => a.seq - b.seq)
  const boundStepIds = new Set(
    draft.bundle.diagrams.map((diagram) => diagram.stepId).filter(Boolean),
  )

  return (
    <section className="panel p-5" aria-label="拆装步序编辑">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-wood-900">拆装步序</h2>
          <p className="mt-1 text-xs text-stone-500">每一步都必须在示意图页签绑定一张图，否则提交闸门拦截。</p>
        </div>
        <button type="button" className="secondary-button text-xs" onClick={() => void addStep()}>新增步序</button>
      </header>

      <div className="mt-4 space-y-3">
        {steps.map((step, index) => {
          const bound = boundStepIds.has(step.id)
          return (
            <article key={step.id} className="rounded-xl border border-stone-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-wood-700 text-sm font-semibold text-white">
                    {step.seq}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="canvas-control h-7 w-7 text-sm"
                      aria-label="上移"
                      onClick={() => void moveStep(index, index - 1)}
                      disabled={index === 0}
                    >↑</button>
                    <button
                      type="button"
                      className="canvas-control h-7 w-7 text-sm"
                      aria-label="下移"
                      onClick={() => void moveStep(index, index + 1)}
                      disabled={index === steps.length - 1}
                    >↓</button>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${bound ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
                    {bound ? '已绑图' : '未绑图 · 闸门拦截'}
                  </span>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50"
                  onClick={() => void removeStep(step.id)}
                >
                  删除步序
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="text-xs text-stone-500">动作</span>
                  <select className="input-field mt-1" value={step.action} onChange={(event) => void updateStep(step.id, { action: event.target.value as StepAction })}>
                    {actions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-stone-500">方向</span>
                  <select className="input-field mt-1" value={step.direction} onChange={(event) => void updateStep(step.id, { direction: event.target.value as StepDirection })}>
                    {directions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-stone-500">工具</span>
                  <select className="input-field mt-1" value={step.tool} onChange={(event) => void updateStep(step.id, { tool: event.target.value as StepTool })}>
                    {tools.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              </div>
              <label className="mt-3 block">
                <span className="text-xs text-stone-500">风险提醒</span>
                <textarea
                  className="input-field mt-1"
                  rows={2}
                  value={step.riskNote}
                  onChange={(event) => void updateStep(step.id, { riskNote: event.target.value })}
                />
              </label>
              <label className="mt-3 block max-w-[180px]">
                <span className="text-xs text-stone-500">停留秒数</span>
                <input
                  type="number"
                  min="1"
                  className="input-field mt-1"
                  value={step.holdSec}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10)
                    if (Number.isFinite(next)) void updateStep(step.id, { holdSec: Math.max(1, next) })
                  }}
                />
              </label>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export type { DisassemblyStep }
