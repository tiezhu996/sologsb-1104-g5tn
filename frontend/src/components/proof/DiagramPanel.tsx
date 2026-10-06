import { useState } from 'react'
import { SvgCanvas } from '../common/SvgCanvas'
import type { ProofDraft } from '../../types/proof'
import { useProofStore } from '../../stores/proofStore'

interface DiagramPanelProps {
  draft: ProofDraft
}

const views = ['正视', '俯视', '轴测'] as const

export function DiagramPanel({ draft }: DiagramPanelProps) {
  const updateDiagram = useProofStore((state) => state.updateDiagram)
  const setDiagramStep = useProofStore((state) => state.setDiagramStep)
  const addDiagram = useProofStore((state) => state.addDiagram)
  const removeDiagram = useProofStore((state) => state.removeDiagram)
  const updateHitArea = useProofStore((state) => state.updateHitArea)

  const steps = [...draft.bundle.steps].sort((a, b) => a.seq - b.seq)
  const [activeId, setActiveId] = useState<string | null>(draft.bundle.diagrams[0]?.id ?? null)
  const active = draft.bundle.diagrams.find((diagram) => diagram.id === activeId) ?? draft.bundle.diagrams[0] ?? null
  const memberMap = new Map(draft.bundle.members.map((member) => [member.id, member]))
  const stepMap = new Map(draft.bundle.steps.map((step) => [step.id, step]))
  const svgRefs = active ? extractRefs(active.svgMarkup) : []
  const danglingRefs = svgRefs.filter((ref) => !memberMap.has(ref))

  return (
    <section className="panel p-5" aria-label="示意图与热区编辑">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-wood-900">示意图与热区</h2>
          <p className="mt-1 text-xs text-stone-500">图必须绑定一步；SVG 热区 data-member-id 与登记热区都要回链现有构件。</p>
        </div>
        <button
          type="button"
          className="secondary-button text-xs"
          onClick={() => void addDiagram(steps[0]?.id ?? '')}
          disabled={steps.length === 0}
        >
          新增示意图
        </button>
      </header>

      <div className="mt-4 grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="space-y-2">
          {draft.bundle.diagrams.map((diagram) => {
            const bound = stepMap.has(diagram.stepId)
            return (
              <button
                key={diagram.id}
                type="button"
                onClick={() => setActiveId(diagram.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left text-sm transition ${
                  active?.id === diagram.id ? 'border-wood-500 bg-wood-50' : 'border-stone-200 bg-white hover:border-wood-100'
                }`}
              >
                <strong className="block text-stone-900">{diagram.title}</strong>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] ${bound ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
                  {bound ? `绑第${stepMap.get(diagram.stepId)?.seq}步` : '未绑步序'}
                </span>
              </button>
            )
          })}
          {draft.bundle.diagrams.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-300 p-4 text-xs text-stone-500">还没有示意图。</p>
          ) : null}
        </div>

        {active ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-stone-500">图名</span>
                <input
                  className="input-field mt-1"
                  value={active.title}
                  onChange={(event) => void updateDiagram(active.id, { title: event.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-xs text-stone-500">绑定步序</span>
                <select
                  className="input-field mt-1"
                  value={active.stepId}
                  onChange={(event) => void setDiagramStep(active.id, event.target.value)}
                >
                  <option value="">— 请选择步序（不选将被拦截）—</option>
                  {steps.map((step) => (
                    <option key={step.id} value={step.id}>第{step.seq}步 · {step.action}·{step.direction}</option>
                  ))}
                </select>
              </label>
            </div>

            <SvgCanvas svgMarkup={active.svgMarkup} title={active.title} hitAreas={active.hitAreas} />

            {danglingRefs.length > 0 ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                SVG 中有 {danglingRefs.length} 个热区指向已删除构件：{danglingRefs.join('、')}，提交将被整批拦下。
              </p>
            ) : null}

            <div>
              <h3 className="text-sm font-semibold text-wood-900">登记热区回链</h3>
              <div className="mt-2 space-y-2">
                {active.hitAreas.map((area) => {
                  const exists = memberMap.has(area.memberId)
                  return (
                    <div key={area.id} className="grid gap-2 rounded-lg border border-stone-200 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                      <input
                        className="input-field"
                        value={area.label}
                        aria-label="热区名称"
                        onChange={(event) => void updateHitArea(active.id, area.id, { label: event.target.value })}
                      />
                      <select
                        className={`input-field ${exists ? '' : 'border-rose-300 bg-rose-50'}`}
                        value={memberMap.has(area.memberId) ? area.memberId : ''}
                        onChange={(event) => void updateHitArea(active.id, area.id, { memberId: event.target.value })}
                      >
                        {!exists ? <option value="">断链 · 构件已删除</option> : null}
                        {draft.bundle.members.map((member) => (
                          <option key={member.id} value={member.id}>{member.name}（{member.part}）</option>
                        ))}
                      </select>
                      <span className={`text-[11px] ${exists ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {exists ? '回链成立' : '断链拦截'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            <label className="block">
              <span className="text-xs text-stone-500">视图</span>
              <select
                className="input-field mt-1 max-w-[160px]"
                value={active.view}
                onChange={(event) => void updateDiagram(active.id, { view: event.target.value as typeof views[number] })}
              >
                {views.map((view) => <option key={view} value={view}>{view}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-stone-500">SVG 源码（可改 data-member-id 制造热区断链）</span>
              <textarea
                className="input-field mt-1 font-mono text-xs"
                rows={6}
                value={active.svgMarkup}
                onChange={(event) => void updateDiagram(active.id, { svgMarkup: event.target.value })}
              />
            </label>

            <button
              type="button"
              className="rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-700 hover:bg-rose-50"
              onClick={() => void removeDiagram(active.id)}
            >
              删除该示意图
            </button>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-stone-300 p-6 text-sm text-stone-500">请先新增一张示意图。</p>
        )}
      </div>
    </section>
  )
}

function extractRefs(svgMarkup: string): string[] {
  const documentNode = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml')
  return Array.from(documentNode.querySelectorAll('g[data-member-id]'))
    .map((group) => group.getAttribute('data-member-id') ?? '')
    .filter(Boolean)
}
