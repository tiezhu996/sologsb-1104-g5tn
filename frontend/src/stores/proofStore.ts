import { create } from 'zustand'
import type { Diagram, HitArea } from '../types/diagram'
import type { Furniture } from '../types/furniture'
import type { JointType } from '../types/jointType'
import type { Member } from '../types/member'
import type { DimensionPatch, ProofDraft } from '../types/proof'
import type { DisassemblyStep } from '../types/step'
import { cloneBundle } from '../utils/bundle'
import {
  bindTemplateDiagrams,
  commitDraft,
  createDraftFromJoint,
  createId,
  discardDraft,
  listDrafts,
  resequenceSteps,
  restoreVersion,
  saveDraft,
  type RestoreResult,
} from '../utils/proofService'
import { recalcTolerance } from '../utils/tolerance'
import { db, makeTemplateSvg } from '../utils/db'

interface CommitOutcome {
  ok: boolean
  kind: 'committed' | 'blocked' | 'conflict' | 'failed'
  message: string
}

interface ProofState {
  drafts: ProofDraft[]
  currentDraftId: string | null
  loading: boolean
  busy: boolean
  lastOutcome: CommitOutcome | null
  loadDrafts: () => Promise<void>
  openDraft: (id: string) => Promise<void>
  startDraft: (jointTypeId: string) => Promise<string>
  dropDraft: (id: string) => Promise<void>
  clearOutcome: () => void

  updateJoint: (patch: Partial<JointType>) => Promise<void>
  updateMember: (memberId: string, patch: Partial<Member> & DimensionPatch, autoTolerance?: boolean) => Promise<void>
  removeMember: (memberId: string) => Promise<void>
  addMember: () => Promise<void>

  updateStep: (stepId: string, patch: Partial<DisassemblyStep>) => Promise<void>
  moveStep: (fromIndex: number, toIndex: number) => Promise<void>
  addStep: () => Promise<void>
  removeStep: (stepId: string) => Promise<void>
  resequence: () => Promise<void>

  updateDiagram: (diagramId: string, patch: Partial<Diagram>) => Promise<void>
  setDiagramStep: (diagramId: string, stepId: string) => Promise<void>
  addDiagram: (stepId: string) => Promise<void>
  removeDiagram: (diagramId: string) => Promise<void>
  autoBindSteps: () => Promise<void>
  updateHitArea: (diagramId: string, hitId: string, patch: Partial<HitArea>) => Promise<void>

  updateFurniture: (furnitureId: string, patch: Partial<Furniture>) => Promise<void>
  addFurniture: () => Promise<void>
  removeFurniture: (furnitureId: string) => Promise<void>

  rebaseDraft: () => Promise<void>
  submit: (simulateWriteFailure?: boolean) => Promise<CommitOutcome>
  restore: (versionId: string) => Promise<RestoreResult | null>
}

function mutateDraft(draft: ProofDraft, mutate: (bundle: ProofDraft['bundle']) => void): ProofDraft {
  const bundle = cloneBundle(draft.bundle)
  mutate(bundle)
  return { ...draft, bundle, updatedAt: new Date().toISOString() }
}

export const useProofStore = create<ProofState>((set, get) => ({
  drafts: [],
  currentDraftId: null,
  loading: false,
  busy: false,
  lastOutcome: null,

  loadDrafts: async () => {
    set({ loading: true })
    try {
      const drafts = await listDrafts()
      set((state) => ({
        drafts,
        currentDraftId: state.currentDraftId && drafts.some((draft) => draft.id === state.currentDraftId)
          ? state.currentDraftId
          : drafts[0]?.id ?? null,
      }))
    } finally {
      set({ loading: false })
    }
  },

  openDraft: async (id) => {
    set({ currentDraftId: id, lastOutcome: null })
    const fresh = await db.proofDrafts.get(id)
    if (fresh) {
      set((state) => ({ drafts: state.drafts.map((item) => (item.id === id ? fresh : item)) }))
    }
  },

  startDraft: async (jointTypeId) => {
    const draft = await createDraftFromJoint(jointTypeId)
    set((state) => ({ drafts: [draft, ...state.drafts], currentDraftId: draft.id, lastOutcome: null }))
    return draft.id
  },

  dropDraft: async (id) => {
    await discardDraft(id)
    set((state) => {
      const drafts = state.drafts.filter((draft) => draft.id !== id)
      return {
        drafts,
        currentDraftId: state.currentDraftId === id ? drafts[0]?.id ?? null : state.currentDraftId,
      }
    })
  },

  clearOutcome: () => set({ lastOutcome: null }),

  updateJoint: async (patch) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      bundle.joint = { ...bundle.joint, ...patch }
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  updateMember: async (memberId, patch, autoTolerance = true) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const dimensionPatch: DimensionPatch = {
      lengthMm: patch.lengthMm,
      widthMm: patch.widthMm,
      thicknessMm: patch.thicknessMm,
    }
    const hasDimensionChange = Object.values(dimensionPatch).some((value) => value !== undefined)
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      bundle.members = bundle.members.map((member) => {
        if (member.id !== memberId) return member
        const dimensions = {
          lengthMm: dimensionPatch.lengthMm ?? member.lengthMm,
          widthMm: dimensionPatch.widthMm ?? member.widthMm,
          thicknessMm: dimensionPatch.thicknessMm ?? member.thicknessMm,
        }
        // 尺寸变化后重算公差
        const toleranceMm = hasDimensionChange && autoTolerance
          ? recalcTolerance(dimensions, member.toleranceMm)
          : (patch.toleranceMm ?? member.toleranceMm)
        return { ...member, ...patch, ...dimensions, toleranceMm }
      })
    }))
    set((state) => ({
      drafts: state.drafts.map((item) => (
        item.id === saved.id
          ? {
              ...saved,
              // 受影响项：改过尺寸的构件，其热区/家具引用需在提交时联动复核
              dirtyMembers: Array.from(new Set([...item.dirtyMembers, memberId])),
            }
          : item
      )),
    }))
  },

  removeMember: async (memberId) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      bundle.members = bundle.members.filter((member) => member.id !== memberId)
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  addMember: async () => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      const member: Member = {
        id: createId('member'),
        jointTypeId: bundle.joint.id,
        name: '榫头',
        part: '出榫件',
        grainDir: '顺纹',
        lengthMm: 80,
        widthMm: 40,
        thicknessMm: 24,
        toleranceMm: 0.11,
        note: '新构件，待补充加工说明。',
      }
      bundle.members.push(member)
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  updateStep: async (stepId, patch) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      bundle.steps = bundle.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step))
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  moveStep: async (fromIndex, toIndex) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      const ordered = bundle.steps.slice().sort((a, b) => a.seq - b.seq)
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= ordered.length || toIndex >= ordered.length) return
      const [moved] = ordered.splice(fromIndex, 1)
      if (!moved) return
      ordered.splice(toIndex, 0, moved)
      bundle.steps = ordered.map((step, index) => ({ ...step, seq: index + 1 }))
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  addStep: async () => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      const seq = bundle.steps.length + 1
      bundle.steps.push({
        id: createId('step'),
        jointTypeId: bundle.joint.id,
        seq,
        action: '装配',
        direction: '轴向',
        tool: '木槌',
        riskNote: '新步骤，待补充风险提醒。',
        holdSec: 6,
      })
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  removeStep: async (stepId) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      bundle.steps = bundle.steps.filter((step) => step.id !== stepId)
      // 同步断开示意图对该步的绑定，交由闸门拦截，避免静默指向
      bundle.diagrams = bundle.diagrams.map((diagram) => (
        diagram.stepId === stepId ? { ...diagram, stepId: '' } : diagram
      ))
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  resequence: async () => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      const next = resequenceSteps(bundle)
      bundle.steps = next.steps
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  updateDiagram: async (diagramId, patch) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      bundle.diagrams = bundle.diagrams.map((diagram) => (
        diagram.id === diagramId ? { ...diagram, ...patch } : diagram
      ))
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  setDiagramStep: async (diagramId, stepId) => {
    await get().updateDiagram(diagramId, { stepId })
  },

  addDiagram: async (stepId) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      const refs = bundle.members.slice(0, 3)
      const id = createId('diagram')
      bundle.diagrams.push({
        id,
        jointTypeId: bundle.joint.id,
        stepId,
        title: `${bundle.joint.name}新示意图`,
        view: '轴测',
        svgMarkup: makeTemplateSvg(
          `${bundle.joint.name} · 示意图`,
          refs.map((member) => member.id),
          refs.map((member) => member.name),
        ),
        hitAreas: refs.map((member, index) => ({
          id: createId('hit'),
          memberId: member.id,
          label: member.name,
          points: ['40,188 190,188 214,252 18,252', '196,50 324,50 324,148 196,148', '336,116 498,116 498,254 352,254'][index] ?? '',
        })),
      })
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  removeDiagram: async (diagramId) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      bundle.diagrams = bundle.diagrams.filter((diagram) => diagram.id !== diagramId)
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  autoBindSteps: async () => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      const next = bindTemplateDiagrams(bundle)
      bundle.diagrams = next.diagrams
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  updateHitArea: async (diagramId, hitId, patch) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      bundle.diagrams = bundle.diagrams.map((diagram) => (
        diagram.id !== diagramId
          ? diagram
          : {
              ...diagram,
              hitAreas: diagram.hitAreas.map((area) => (area.id === hitId ? { ...area, ...patch } : area)),
            }
      ))
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  updateFurniture: async (furnitureId, patch) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      bundle.furniture = bundle.furniture.map((item) => (
        item.id === furnitureId ? { ...item, ...patch, jointTypeId: bundle.joint.id } : item
      ))
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  addFurniture: async () => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      bundle.furniture.push({
        id: createId('furniture'),
        jointTypeId: bundle.joint.id,
        name: '圈椅',
        era: '明式',
        position: '',
        loadNote: '',
        memberId: bundle.members[0]?.id ?? '',
      })
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  removeFurniture: async (furnitureId) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    const saved = await saveDraft(mutateDraft(current, (bundle) => {
      bundle.furniture = bundle.furniture.filter((item) => item.id !== furnitureId)
    }))
    set((state) => ({ drafts: state.drafts.map((item) => (item.id === saved.id ? saved : item)) }))
  },

  rebaseDraft: async () => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) return
    // 冲突以正式版本为准：丢弃草稿改动，用正式当前快照重建同一草稿继续校
    const fresh = await createDraftFromJoint(current.jointTypeId, `${current.label}（已按正式重整）`)
    await discardDraft(current.id)
    set((state) => ({
      drafts: [fresh, ...state.drafts.filter((draft) => draft.id !== current.id)],
      currentDraftId: fresh.id,
      lastOutcome: { ok: true, kind: 'committed', message: '已以正式版本为准重建草稿，可继续校样提交' },
    }))
  },

  submit: async (simulateWriteFailure = false) => {
    const current = get().drafts.find((draft) => draft.id === get().currentDraftId)
    if (!current) {
      return { ok: false, kind: 'failed', message: '没有打开的草稿' }
    }
    set({ busy: true, lastOutcome: null })
    try {
      const { draft: updated } = await commitDraft(current, simulateWriteFailure)
      set((state) => ({
        drafts: state.drafts.map((item) => (item.id === updated.id ? updated : item)),
        lastOutcome: { ok: true, kind: 'committed', message: '断链闸门通过，已原子入库并留下版本摘要' },
      }))
      await get().loadDrafts()
      return { ok: true, kind: 'committed', message: '断链闸门通过，已原子入库并留下版本摘要' }
    } catch (error) {
      const outcome = classifyCommitError(error)
      // 写失败/被拦：草稿原样保留，可恢复继续提交
      if (outcome.kind === 'failed') {
        const failedDraft: ProofDraft = {
          ...current,
          status: 'failed',
          lastError: outcome.message,
          failSimulated: simulateWriteFailure,
          updatedAt: new Date().toISOString(),
        }
        await saveDraft(failedDraft)
        set((state) => ({
          drafts: state.drafts.map((item) => (item.id === failedDraft.id ? failedDraft : item)),
        }))
      }
      set({ lastOutcome: outcome })
      return outcome
    } finally {
      set({ busy: false })
    }
  },

  restore: async (versionId) => {
    set({ busy: true })
    try {
      const result = await restoreVersion(versionId)
      if (result?.status === 'conflict' && result.draft) {
        set((state) => ({
          drafts: [result.draft!, ...state.drafts],
          currentDraftId: result.draft!.id,
          lastOutcome: { ok: false, kind: 'conflict', message: result.message },
        }))
      } else if (result?.status === 'restored') {
        set({ lastOutcome: { ok: true, kind: 'committed', message: result.message } })
      } else if (result) {
        set({ lastOutcome: { ok: false, kind: 'blocked', message: result.message } })
      }
      await get().loadDrafts()
      return result
    } finally {
      set({ busy: false })
    }
  },
}))

function classifyCommitError(error: unknown): CommitOutcome {
  const name = (error as { name?: string })?.name
  const message = error instanceof Error ? error.message : '正式图鉴写入失败'
  if (name === 'ProofBlockedError') {
    return { ok: false, kind: 'blocked', message }
  }
  if (name === 'ProofConflictError') {
    return { ok: false, kind: 'conflict', message }
  }
  return { ok: false, kind: 'failed', message: `${message}；正式图鉴整体未写入，草稿已保留，可继续提交` }
}

export type { CommitOutcome }
