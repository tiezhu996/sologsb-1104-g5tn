import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BlankPanel } from '../components/common/BlankPanel'
import { SizeField } from '../components/common/SizeField'
import { SvgCanvas } from '../components/common/SvgCanvas'
import { useProofStore } from '../stores/proofStore'
import type { CommitResult, MemberImpact, ProofDraft, ValidationIssue } from '../types/proof'
import { hasBlockingErrors, parseDiagramMemberIds, recomputeImpacts, validateContent } from '../utils/proofEngine'
import type { MemberName, MemberPart, GrainDirection } from '../types/member'
import type { StepAction, StepDirection, StepTool } from '../types/step'
import type { DiagramView } from '../types/diagram'
import type { FurnitureName } from '../types/furniture'

type TabKey = 'members' | 'steps' | 'diagrams' | 'furniture'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'members', label: '构件尺寸' },
  { key: 'steps', label: '拆装步序' },
  { key: 'diagrams', label: '示意图' },
  { key: 'furniture', label: '家具说明' },
]

const MEMBER_NAMES: MemberName[] = ['榫头', '榫眼', '大边', '抹头']
const MEMBER_PARTS: MemberPart[] = ['出榫件', '受榫件']
const GRAIN_DIRS: GrainDirection[] = ['顺纹', '横纹']
const STEP_ACTIONS: StepAction[] = ['拆卸', '装配']
const STEP_DIRECTIONS: StepDirection[] = ['轴向', '侧向', '斜向']
const STEP_TOOLS: StepTool[] = ['木槌', '鱼线', '撬板']
const DIAGRAM_VIEWS: DiagramView[] = ['正视', '俯视', '轴测']
const FURNITURE_NAMES: FurnitureName[] = ['圈椅', '条案', '架子床', '官帽椅', '方桌', '柜架']

export default function ProofEditor() {
  const { id: draftId = '' } = useParams()
  const drafts = useProofStore((state) => state.drafts)
  const loadProofData = useProofStore((state) => state.loadProofData)
  const submitDraft = useProofStore((state) => state.submitDraft)
  const [tab, setTab] = useState<TabKey>('members')
  const [liveResult, setLiveResult] = useState<CommitResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [successBanner, setSuccessBanner] = useState<string | null>(null)

  useEffect(() => {
    void loadProofData()
  }, [loadProofData])

  const draft = drafts.find((item) => item.id === draftId)

  // 尺寸变化后重算公差与受影响项（每次草稿内容变动都即时反映）
  const { impacts, issues } = useMemo(() => {
    if (!draft) return { impacts: [] as MemberImpact[], issues: [] as ValidationIssue[] }
    const recomputed = recomputeImpacts(draft)
    return {
      impacts: recomputed.impacts,
      issues: validateContent(draft.jointTypeId, draft.content, true),
    }
  }, [draft])

  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')

  const handleSubmit = async () => {
    if (!draft) return
    setSubmitting(true)
    setSuccessBanner(null)
    try {
      const result = await submitDraft(draft.id)
      setLiveResult(result)
      if (result.ok) {
        setSuccessBanner(`已原子入库，形成正式版本 v${result.version ?? ''}`)
        setTab('members')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!draft) {
    return (
      <div className="space-y-6">
        <BackLink />
        <BlankPanel title="未找到这份草稿" description="草稿可能已被丢弃，请返回校样台重新建立。" />
      </div>
    )
  }

  const blocked = hasBlockingErrors(issues)

  return (
    <div className="space-y-6" data-testid="proof-editor">
      <BackLink />

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.24em] text-wood-500">PROOF DRAFT</p>
            <h1 className="mt-2 text-2xl font-bold text-wood-900 sm:text-3xl">
              {draft.jointNameSnapshot} · 校样草稿
            </h1>
            <p className="mt-2 text-xs text-stone-500">
              {draft.status === 'committed'
                ? '该草稿已入库为正式版本；继续修改会形成新的待提交草稿状态。'
                : '四类内容隔离修改，提交前整批核对，断链整批拦住。'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusPill status={draft.status} />
            <span className="text-[11px] text-stone-400">最近保存 {new Date(draft.updatedAt).toLocaleTimeString('zh-CN')}</span>
          </div>
        </div>
        {draft.lastError ? (
          <div className="border-t border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-800" data-testid="proof-editor-error">
            上次提交未入库：{draft.lastError}。草稿完整保留，修改后可重新提交。
          </div>
        ) : null}
        {successBanner ? (
          <div className="border-t border-emerald-100 bg-emerald-50 px-6 py-3 text-sm text-emerald-800" data-testid="proof-editor-success">
            {successBanner}
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="校样内容分类">
            {TABS.map((item) => {
              const count = item.key === 'members' ? draft.content.members.length
                : item.key === 'steps' ? draft.content.steps.length
                : item.key === 'diagrams' ? draft.content.diagrams.length
                : draft.content.furniture.length
              const kindOfTab = item.key === 'members' ? 'member'
                : item.key === 'steps' ? 'step'
                : item.key === 'diagrams' ? 'diagram'
                : 'furniture'
              const tabErrors = errors.filter((issue) => issue.kind === kindOfTab).length
              return (
                <button
                  key={item.key}
                  role="tab"
                  aria-selected={tab === item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={`relative rounded-lg border px-4 py-2 text-sm transition ${
                    tab === item.key
                      ? 'border-wood-700 bg-wood-700 text-white'
                      : 'border-wood-100 bg-white text-wood-700 hover:border-wood-500'
                  }`}
                >
                  {item.label}
                  <span className="ml-1.5 text-xs opacity-75">{count}</span>
                  {tabErrors > 0 ? (
                    <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{tabErrors}</span>
                  ) : null}
                </button>
              )
            })}
          </div>

          {tab === 'members' ? (
            <MembersTab draftId={draft.id} impacts={impacts} />
          ) : tab === 'steps' ? (
            <StepsTab draftId={draft.id} />
          ) : tab === 'diagrams' ? (
            <DiagramsTab draftId={draft.id} />
          ) : (
            <FurnitureTab draftId={draft.id} />
          )}
        </div>

        <aside className="space-y-5">
          <section className="panel sticky top-24 space-y-4 p-5" data-testid="proof-checklist">
            <div>
              <h2 className="font-semibold text-wood-900">提交核对</h2>
              <p className="mt-1 text-xs text-stone-500">步序有绑图 · 热区回现有构件 · 家具说明引用成立</p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className={`rounded-lg px-2 py-2 ${errors.length ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
                <strong className="block text-lg">{errors.length}</strong>断链 / 错误
              </div>
              <div className={`rounded-lg px-2 py-2 ${warnings.length ? 'bg-amber-50 text-amber-800' : 'bg-stone-50 text-stone-500'}`}>
                <strong className="block text-lg">{warnings.length}</strong>提醒
              </div>
            </div>

            {draft.conflicts.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-stone-600">冲突已按正式版本处理</p>
                {draft.conflicts.map((conflict) => (
                  <p key={`${conflict.kind}-${conflict.id}`} className="rounded-md bg-stone-50 px-2.5 py-1.5 text-[11px] leading-4 text-stone-600">
                    {conflict.message}
                  </p>
                ))}
              </div>
            ) : null}

            {issues.length > 0 ? (
              <ul className="max-h-72 space-y-1.5 overflow-auto pr-1">
                {issues.map((issue, index) => (
                  <li
                    key={`${issue.code}-${issue.targetId}-${index}`}
                    className={`rounded-md px-2.5 py-1.5 text-[11px] leading-4 ${
                      issue.severity === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                四类内容引用完整，没有断链，可以整批提交。
              </p>
            )}

            <button
              type="button"
              className="primary-button w-full"
              data-testid="proof-submit"
              disabled={submitting || blocked}
              onClick={() => void handleSubmit()}
            >
              {submitting ? '正在整批入库…' : blocked ? '断链未清，禁止提交' : '整批提交到正式图鉴'}
            </button>
            <p className="text-center text-[11px] text-stone-400">
              四类内容与版本摘要在同一事务中写入，任一失败整体回滚。
            </p>
            {liveResult && !liveResult.ok && liveResult.error ? (
              <p className="rounded-md bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800">
                写库失败已回滚，草稿保留：{liveResult.error}
              </p>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <div>
      <Link to="/proof" className="inline-flex items-center gap-1.5 text-sm text-wood-700 hover:underline">
        <span aria-hidden="true">←</span> 返回校样台
      </Link>
    </div>
  )
}

function StatusPill({ status }: { status: ProofStatus }) {
  const text = status === 'editing' ? '编辑中' : status === 'submit_failed' ? '提交失败 · 可继续' : '已入库'
  const className = status === 'editing'
    ? 'bg-amber-50 text-amber-800'
    : status === 'submit_failed'
      ? 'bg-rose-50 text-rose-800'
      : 'bg-emerald-50 text-emerald-800'
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${className}`}>{text}</span>
}

type ProofStatus = ProofDraft['status']

/* ---------------------------------- 构件尺寸 ---------------------------------- */

function MembersTab({ draftId, impacts }: { draftId: string; impacts: MemberImpact[] }) {
  const draft = useProofStore((state) => state.drafts.find((item) => item.id === draftId))
  const updateMember = useProofStore((state) => state.updateMember)
  const addMember = useProofStore((state) => state.addMember)
  const removeMember = useProofStore((state) => state.removeMember)
  if (!draft) return null
  const impactById = new Map(impacts.map((impact) => [impact.memberId, impact]))
  const diagramTitle = (id: string) => draft.content.diagrams.find((diagram) => diagram.id === id)?.title ?? id
  const stepLabel = (id: string) => {
    const step = draft.content.steps.find((item) => item.id === id)
    return step ? `第 ${step.seq} 步` : id
  }

  return (
    <section className="space-y-4" data-testid="proof-members">
      <SectionHeader
        title="构件尺寸与公差"
        hint="修改长宽厚或公差后，立即重算公差结论，并列出尺寸变化受影响的示意图与步序。"
        onAdd={() => void addMember(draftId)}
        addLabel="新增构件"
      />
      {draft.content.members.length === 0 ? (
        <BlankPanel title="草稿中没有构件" description="新增构件后才能被示意图热区引用。" />
      ) : (
        <div className="space-y-4">
          {draft.content.members.map((member) => {
            const impact = impactById.get(member.id)
            const tolerance = impact?.tolerance
            return (
              <article
                key={member.id}
                className={`panel p-5 ${impact?.dimensionChanged ? 'ring-2 ring-amber-300' : ''}`}
                data-testid="proof-member-row"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-lg border border-wood-100 px-2 py-1.5 text-sm"
                      value={member.name}
                      onChange={(event) => void updateMember(draftId, member.id, { name: event.target.value as MemberName })}
                    >
                      {MEMBER_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <select
                      className="rounded-lg border border-wood-100 px-2 py-1.5 text-sm"
                      value={member.part}
                      onChange={(event) => void updateMember(draftId, member.id, { part: event.target.value as MemberPart })}
                    >
                      {MEMBER_PARTS.map((part) => <option key={part} value={part}>{part}</option>)}
                    </select>
                    <select
                      className="rounded-lg border border-wood-100 px-2 py-1.5 text-sm"
                      value={member.grainDir}
                      onChange={(event) => void updateMember(draftId, member.id, { grainDir: event.target.value as GrainDirection })}
                    >
                      {GRAIN_DIRS.map((grain) => <option key={grain} value={grain}>{grain}</option>)}
                    </select>
                    {impact?.dimensionChanged ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800" data-testid="proof-member-changed">
                        尺寸已变
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-rose-600 hover:underline"
                    onClick={() => void removeMember(draftId, member.id)}
                  >
                    删除构件
                  </button>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <SizeField label="长度" valueMm={member.lengthMm} toleranceMm={member.toleranceMm}
                    onChange={(value) => void updateMember(draftId, member.id, { lengthMm: value })} />
                  <SizeField label="宽度" valueMm={member.widthMm} toleranceMm={member.toleranceMm}
                    onChange={(value) => void updateMember(draftId, member.id, { widthMm: value })} />
                  <SizeField label="厚度" valueMm={member.thicknessMm} toleranceMm={member.toleranceMm}
                    onChange={(value) => void updateMember(draftId, member.id, { thicknessMm: value })} />
                  <SizeField label="配合公差" valueMm={member.toleranceMm} toleranceMm={member.toleranceMm}
                    onChange={(value) => void updateMember(draftId, member.id, { toleranceMm: value })} />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                  <span className={`rounded-full px-3 py-1 font-medium ${
                    tolerance?.withinTolerance ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                  }`} data-testid="proof-member-tolerance">
                    {tolerance?.withinTolerance ? '公差合格' : '需要修配'} · {tolerance?.message}
                  </span>
                </div>

                {impact && (impact.referencingDiagramIds.length > 0 || impact.referencingStepIds.length > 0) ? (
                  <div className="mt-3 rounded-lg bg-amber-50/70 px-3 py-2.5 text-[11px] leading-5 text-amber-900" data-testid="proof-member-impact">
                    <strong>尺寸变化受影响项：</strong>
                    {impact.referencingDiagramIds.length > 0 && (
                      <span> 示意图（{impact.referencingDiagramIds.map(diagramTitle).join('、')}）</span>
                    )}
                    {impact.referencingStepIds.length > 0 && (
                      <span> 步序（{Array.from(new Set(impact.referencingStepIds)).map(stepLabel).join('、')}）</span>
                    )}
                    ，请复核图示与配合。
                  </div>
                ) : null}

                <label className="mt-3 block space-y-1 text-xs">
                  <span className="text-stone-500">加工说明</span>
                  <input
                    className="input-field"
                    value={member.note}
                    onChange={(event) => void updateMember(draftId, member.id, { note: event.target.value })}
                  />
                </label>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

/* ---------------------------------- 拆装步序 ---------------------------------- */

function StepsTab({ draftId }: { draftId: string }) {
  const draft = useProofStore((state) => state.drafts.find((item) => item.id === draftId))
  const updateStep = useProofStore((state) => state.updateStep)
  const addStep = useProofStore((state) => state.addStep)
  const removeStep = useProofStore((state) => state.removeStep)
  const reorderSteps = useProofStore((state) => state.reorderSteps)
  if (!draft) return null

  const boundDiagramOf = (stepId: string) => draft.content.diagrams.filter((diagram) => diagram.stepId === stepId)
  const ordered = [...draft.content.steps].sort((a, b) => a.seq - b.seq)

  return (
    <section className="space-y-4" data-testid="proof-steps">
      <SectionHeader
        title="拆装步序（必须绑定示意图）"
        hint="每一步都要能回到一张示意图；未绑图的步序会在提交时整批拦截。可用上下箭头调序。"
        onAdd={() => void addStep(draftId)}
        addLabel="新增步骤"
      />
      {ordered.length === 0 ? (
        <BlankPanel title="草稿中没有步序" description="至少需要一步并绑定示意图，否则无法提交。" />
      ) : (
        <div className="space-y-3">
          {ordered.map((step, index) => {
            const bound = boundDiagramOf(step.id)
            return (
              <article key={step.id} className="panel p-4" data-testid="proof-step-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-wood-700 text-sm font-semibold text-white">{step.seq}</span>
                  <select className="rounded-lg border border-wood-100 px-2 py-1.5 text-sm" value={step.action}
                    onChange={(event) => void updateStep(draftId, step.id, { action: event.target.value as StepAction })}>
                    {STEP_ACTIONS.map((action) => <option key={action} value={action}>{action}</option>)}
                  </select>
                  <select className="rounded-lg border border-wood-100 px-2 py-1.5 text-sm" value={step.direction}
                    onChange={(event) => void updateStep(draftId, step.id, { direction: event.target.value as StepDirection })}>
                    {STEP_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{direction}</option>)}
                  </select>
                  <select className="rounded-lg border border-wood-100 px-2 py-1.5 text-sm" value={step.tool}
                    onChange={(event) => void updateStep(draftId, step.id, { tool: event.target.value as StepTool })}>
                    {STEP_TOOLS.map((tool) => <option key={tool} value={tool}>{tool}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-stone-500">
                    停留
                    <input type="number" min="1" className="w-16 rounded-lg border border-wood-100 px-2 py-1 text-sm"
                      value={step.holdSec}
                      onChange={(event) => void updateStep(draftId, step.id, { holdSec: Number(event.target.value) })} />
                    秒
                  </label>
                  <div className="ml-auto flex items-center gap-1">
                    <button type="button" className="secondary-button px-2.5 py-1.5 text-xs" disabled={index === 0}
                      onClick={() => void reorderSteps(draftId, index, index - 1)}>上移</button>
                    <button type="button" className="secondary-button px-2.5 py-1.5 text-xs" disabled={index === ordered.length - 1}
                      onClick={() => void reorderSteps(draftId, index, index + 1)}>下移</button>
                    <button type="button" className="text-xs text-rose-600 hover:underline"
                      onClick={() => void removeStep(draftId, step.id)}>删除</button>
                  </div>
                </div>
                <input className="input-field mt-3" value={step.riskNote} placeholder="风险提醒"
                  onChange={(event) => void updateStep(draftId, step.id, { riskNote: event.target.value })} />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="proof-step-binding">
                  {bound.length > 0 ? (
                    <>
                      <span className="text-stone-500">已绑示意图：</span>
                      {bound.map((diagram) => (
                        <span key={diagram.id} className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">{diagram.title}</span>
                      ))}
                    </>
                  ) : (
                    <span className="rounded-full bg-rose-50 px-2.5 py-1 font-medium text-rose-800" data-testid="proof-step-unbound">
                      未绑定示意图 · 提交将被拦截
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

/* ---------------------------------- 示意图 ---------------------------------- */

function DiagramsTab({ draftId }: { draftId: string }) {
  const draft = useProofStore((state) => state.drafts.find((item) => item.id === draftId))
  const updateDiagram = useProofStore((state) => state.updateDiagram)
  const addDiagram = useProofStore((state) => state.addDiagram)
  const removeDiagram = useProofStore((state) => state.removeDiagram)
  const [activeId, setActiveId] = useState('')
  if (!draft) return null

  const active = draft.content.diagrams.find((diagram) => diagram.id === activeId) ?? draft.content.diagrams[0]
  const stepOptions = [...draft.content.steps].sort((a, b) => a.seq - b.seq)
  const memberName = (id: string) => draft.content.members.find((member) => member.id === id)?.name ?? id
  const referencedIds = active ? parseDiagramMemberIds(active) : []

  return (
    <section className="space-y-4" data-testid="proof-diagrams">
      <SectionHeader
        title="示意图与热区（热区须回到现有构件）"
        hint="在 SVG 源里保留 g[data-member-id]；热区指向已删除构件即为断链，提交整批拦截。"
        onAdd={() => { void addDiagram(draftId) }}
        addLabel="新增示意图"
        disabled={draft.content.steps.length === 0}
      />
      {draft.content.diagrams.length === 0 ? (
        <BlankPanel title="草稿中没有示意图" description="先在“拆装步序”里建立步骤，再为每一步配示意图。" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {draft.content.diagrams.map((diagram) => (
              <button key={diagram.id} type="button"
                className={`rounded-lg border px-3 py-1.5 text-xs ${active?.id === diagram.id ? 'border-wood-700 bg-wood-700 text-white' : 'border-wood-100 bg-white text-wood-700'}`}
                onClick={() => setActiveId(diagram.id)}>
                {diagram.title}
              </button>
            ))}
          </div>
          {active ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <div className="space-y-3">
                <SvgCanvas
                  svgMarkup={active.svgMarkup}
                  title={active.title || '示意图预览'}
                  hitAreas={active.hitAreas}
                />
                <label className="block space-y-1 text-sm">
                  <span className="text-xs text-stone-500">SVG 源（编辑 data-member-id 指向构件）</span>
                  <textarea rows={10} spellCheck={false}
                    className="w-full resize-y rounded-xl border border-wood-100 bg-stone-950 p-3 font-mono text-xs leading-5 text-stone-100 outline-none focus:border-wood-500"
                    value={active.svgMarkup}
                    onChange={(event) => void updateDiagram(draftId, active.id, { svgMarkup: event.target.value })}
                  />
                </label>
              </div>
              <div className="space-y-3">
                <label className="block space-y-1 text-sm">
                  <span className="text-xs text-stone-500">示意图标题</span>
                  <input className="input-field" value={active.title}
                    onChange={(event) => void updateDiagram(draftId, active.id, { title: event.target.value })} />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-sm">
                    <span className="text-xs text-stone-500">视角</span>
                    <select className="input-field" value={active.view}
                      onChange={(event) => void updateDiagram(draftId, active.id, { view: event.target.value as DiagramView })}>
                      {DIAGRAM_VIEWS.map((view) => <option key={view} value={view}>{view}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-xs text-stone-500">绑定步序</span>
                    <select className="input-field" value={active.stepId}
                      onChange={(event) => void updateDiagram(draftId, active.id, { stepId: event.target.value })}>
                      {stepOptions.map((step) => <option key={step.id} value={step.id}>第 {step.seq} 步 · {step.action}</option>)}
                    </select>
                  </label>
                </div>
                <div className="rounded-lg border border-wood-100 p-3 text-xs" data-testid="proof-diagram-hits">
                  <p className="font-semibold text-stone-600">热区回指构件</p>
                  <ul className="mt-2 space-y-1.5">
                    {referencedIds.length === 0 && <li className="text-stone-400">未解析到热区</li>}
                    {referencedIds.map((memberId) => {
                      const exists = draft.content.members.some((member) => member.id === memberId)
                      return (
                        <li key={memberId} className={exists ? 'text-emerald-700' : 'font-medium text-rose-700'}>
                          {exists ? '✓' : '✗ 断链'} {memberName(memberId)}
                          <span className="ml-1 text-stone-400">#{memberId.slice(0, 12)}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <button type="button" className="text-xs text-rose-600 hover:underline"
                  onClick={() => void removeDiagram(draftId, active.id)}>删除该示意图</button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

/* ---------------------------------- 家具说明 ---------------------------------- */

function FurnitureTab({ draftId }: { draftId: string }) {
  const draft = useProofStore((state) => state.drafts.find((item) => item.id === draftId))
  const updateFurniture = useProofStore((state) => state.updateFurniture)
  const addFurniture = useProofStore((state) => state.addFurniture)
  const removeFurniture = useProofStore((state) => state.removeFurniture)
  if (!draft) return null

  return (
    <section className="space-y-4" data-testid="proof-furniture">
      <SectionHeader
        title="适用家具说明（引用须成立）"
        hint="每条说明都引用当前榫卯类型，名称、使用部位与承力说明缺一不可。"
        onAdd={() => void addFurniture(draftId)}
        addLabel="新增家具说明"
      />
      {draft.content.furniture.length === 0 ? (
        <BlankPanel title="草稿中没有家具说明" description="可补充该榫卯在家具中的使用部位与承力作用。" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {draft.content.furniture.map((item) => {
            const incomplete = !item.name.trim() || !item.position.trim() || !item.loadNote.trim()
            return (
              <article key={item.id} className="panel space-y-3 p-4" data-testid="proof-furniture-row">
                <div className="flex items-start justify-between gap-2">
                  <div className="grid flex-1 grid-cols-2 gap-2">
                    <label className="space-y-1 text-xs">
                      <span className="text-stone-500">家具</span>
                      <select className="input-field" value={item.name}
                        onChange={(event) => void updateFurniture(draftId, item.id, { name: event.target.value as FurnitureName })}>
                        {FURNITURE_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-stone-500">年代</span>
                      <input className="input-field" value={item.era}
                        onChange={(event) => void updateFurniture(draftId, item.id, { era: event.target.value })} />
                    </label>
                  </div>
                  <button type="button" className="text-xs text-rose-600 hover:underline"
                    onClick={() => void removeFurniture(draftId, item.id)}>删除</button>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="text-stone-500">使用部位（引用当前榫卯）</span>
                  <input className="input-field" value={item.position} placeholder="例如：翘头与大边端部"
                    onChange={(event) => void updateFurniture(draftId, item.id, { position: event.target.value })} />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="text-stone-500">承力说明</span>
                  <textarea rows={2} className="input-field resize-y" value={item.loadNote}
                    onChange={(event) => void updateFurniture(draftId, item.id, { loadNote: event.target.value })} />
                </label>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-stone-400">引用榫卯：{draft.jointNameSnapshot}</span>
                  {incomplete ? (
                    <span className="rounded-full bg-rose-50 px-2 py-1 font-medium text-rose-800" data-testid="proof-furniture-incomplete">
                      说明不完整
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-800">引用成立</span>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function SectionHeader({ title, hint, onAdd, addLabel, disabled }: {
  title: string
  hint: string
  onAdd: () => void
  addLabel: string
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-wood-900">{title}</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-stone-500">{hint}</p>
      </div>
      <button type="button" className="secondary-button" disabled={disabled} onClick={onAdd}>{addLabel}</button>
    </div>
  )
}
