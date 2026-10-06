import { create } from 'zustand'
import type { Diagram } from '../types/diagram'
import type { Furniture } from '../types/furniture'
import type { Member, MemberName } from '../types/member'
import type {
  CommitResult,
  DraftContent,
  ProofDraft,
  ResolvedConflict,
  RestoreResult,
  VersionSummary,
} from '../types/proof'
import type { DisassemblyStep } from '../types/step'
import { db } from '../utils/db'
import {
  buildDraftFromFormal,
  buildRestoreDraft,
  createId,
  emptyCommitError,
  fingerprintContent,
  hasBlockingErrors,
  mergeDraftWithFormal,
  recomputeImpacts,
  summarizeChanges,
  validateContent,
} from '../utils/proofEngine'

const FAILURE_FLAG = 'gbmortise:proofCommitFailure'

export function isCommitFailureArmed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(FAILURE_FLAG) === 'on'
  } catch {
    return false
  }
}

export function setCommitFailureArmed(armed: boolean): void {
  try {
    if (armed) localStorage.setItem(FAILURE_FLAG, 'on')
    else localStorage.removeItem(FAILURE_FLAG)
  } catch {
    /* localStorage 不可用时忽略，故障注入仅用于演示 */
  }
}

interface ProofState {
  drafts: ProofDraft[]
  versions: VersionSummary[]
  loading: boolean
  submitting: boolean
  loadProofData: (jointTypeId?: string) => Promise<void>
  createDraft: (jointTypeId: string) => Promise<ProofDraft | null>
  removeDraft: (draftId: string) => Promise<void>
  getDraft: (draftId: string) => ProofDraft | undefined
  mutateDraft: (draftId: string, updater: (content: DraftContent) => DraftContent) => Promise<void>
  updateMember: (
    draftId: string,
    memberId: string,
    patch: Partial<Pick<Member, 'lengthMm' | 'widthMm' | 'thicknessMm' | 'toleranceMm' | 'name' | 'note' | 'part' | 'grainDir'>>,
  ) => Promise<void>
  addMember: (draftId: string) => Promise<void>
  removeMember: (draftId: string, memberId: string) => Promise<void>
  updateStep: (draftId: string, stepId: string, patch: Partial<Omit<DisassemblyStep, 'id' | 'jointTypeId'>>) => Promise<void>
  addStep: (draftId: string) => Promise<void>
  removeStep: (draftId: string, stepId: string) => Promise<void>
  reorderSteps: (draftId: string, from: number, to: number) => Promise<void>
  updateDiagram: (draftId: string, diagramId: string, patch: Partial<Pick<Diagram, 'title' | 'view' | 'svgMarkup' | 'stepId'>>) => Promise<void>
  addDiagram: (draftId: string) => Promise<void>
  removeDiagram: (draftId: string, diagramId: string) => Promise<void>
  updateFurniture: (draftId: string, furnitureId: string, patch: Partial<Omit<Furniture, 'id' | 'jointTypeId'>>) => Promise<void>
  addFurniture: (draftId: string) => Promise<void>
  removeFurniture: (draftId: string, furnitureId: string) => Promise<void>
  submitDraft: (draftId: string) => Promise<CommitResult>
  restoreVersion: (versionId: string) => Promise<RestoreResult>
  getVersions: (jointTypeId: string) => VersionSummary[]
  removeVersion: (versionId: string) => Promise<void>
}

function loadFormalContent(jointTypeId: string): Promise<DraftContent> {
  return Promise.all([
    db.members.where('jointTypeId').equals(jointTypeId).toArray(),
    db.steps.where('jointTypeId').equals(jointTypeId).toArray(),
    db.diagrams.where('jointTypeId').equals(jointTypeId).toArray(),
    db.furniture.where('jointTypeId').equals(jointTypeId).toArray(),
  ]).then(([members, steps, diagrams, furniture]) => ({
    members,
    steps: steps.sort((a, b) => a.seq - b.seq),
    diagrams,
    furniture,
  }))
}

export const useProofStore = create<ProofState>((set, get) => {
  const persistDraft = async (draft: ProofDraft): Promise<void> => {
    const stored: ProofDraft = { ...draft, updatedAt: Date.now() }
    await db.proofDrafts.put(stored)
    set((state) => ({
      drafts: state.drafts.some((item) => item.id === stored.id)
        ? state.drafts.map((item) => (item.id === stored.id ? stored : item))
        : [...state.drafts, stored],
    }))
  }

  const applyContent = async (
    draftId: string,
    updater: (content: DraftContent) => DraftContent,
  ): Promise<void> => {
    const draft = get().drafts.find((item) => item.id === draftId)
    if (!draft) return
    const next: ProofDraft = {
      ...draft,
      content: updater(draft.content),
      // 再次修改已入库草稿，回到编辑中；失败草稿的改动会清掉上次错误
      status: 'editing',
      lastError: null,
    }
    const recomputed = recomputeImpacts(next)
    next.changedMemberIds = recomputed.changedMemberIds
    await persistDraft(next)
  }

  const emptyDiagramSvg = (memberIds: string[]): string => {
    const groups = memberIds.slice(0, 3).map((memberId, index) => {
      const y = 70 + index * 70
      return `  <g data-member-id="${memberId}" style="cursor:pointer">
    <rect x="60" y="${y}" width="120" height="48" rx="8" fill="#c88c55" stroke="#66401f" stroke-width="3"/>
  </g>`
    }).join('\n')
    return `<svg viewBox="0 0 520 300" xmlns="http://www.w3.org/2000/svg" role="img">\n${groups}\n</svg>`
  }

  return {
    drafts: [],
    versions: [],
    loading: false,
    submitting: false,

    loadProofData: async (jointTypeId) => {
      set({ loading: true })
      try {
        const [drafts, versions] = await Promise.all([
          db.proofDrafts.toArray(),
          db.proofVersions.toArray(),
        ])
        drafts.sort((a, b) => b.updatedAt - a.updatedAt)
        versions.sort((a, b) => b.committedAt - a.committedAt)
        set({
          drafts: jointTypeId ? drafts.filter((draft) => draft.jointTypeId === jointTypeId) : drafts,
          versions,
        })
      } finally {
        set({ loading: false })
      }
    },

    createDraft: async (jointTypeId) => {
      const joint = await db.joints.get(jointTypeId)
      if (!joint) return null
      const formal = await loadFormalContent(jointTypeId)
      const draft = buildDraftFromFormal(jointTypeId, joint.name, formal, Date.now())
      await db.proofDrafts.add(draft)
      set((state) => ({ drafts: [draft, ...state.drafts] }))
      return draft
    },

    removeDraft: async (draftId) => {
      await db.proofDrafts.delete(draftId)
      set((state) => ({ drafts: state.drafts.filter((draft) => draft.id !== draftId) }))
    },

    getDraft: (draftId) => get().drafts.find((draft) => draft.id === draftId),

    mutateDraft: applyContent,

    updateMember: async (draftId, memberId, patch) => {
      await applyContent(draftId, (content) => ({
        ...content,
        members: content.members.map((member) =>
          member.id === memberId ? { ...member, ...patch } : member,
        ),
      }))
    },

    addMember: async (draftId) => {
      const draft = get().drafts.find((item) => item.id === draftId)
      if (!draft) return
      const member: Member = {
        id: createId('draft-member'),
        jointTypeId: draft.jointTypeId,
        name: '榫头' as MemberName,
        part: '出榫件',
        grainDir: '顺纹',
        lengthMm: 60,
        widthMm: 30,
        thicknessMm: 20,
        toleranceMm: 0.15,
        note: '校样草稿新增构件，补充加工说明。',
        schemaRev: 3,
      }
      await applyContent(draftId, (content) => ({ ...content, members: [...content.members, member] }))
    },

    removeMember: async (draftId, memberId) => {
      await applyContent(draftId, (content) => ({
        ...content,
        members: content.members.filter((member) => member.id !== memberId),
      }))
    },

    updateStep: async (draftId, stepId, patch) => {
      await applyContent(draftId, (content) => ({
        ...content,
        steps: content.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
      }))
    },

    addStep: async (draftId) => {
      const draft = get().drafts.find((item) => item.id === draftId)
      if (!draft) return
      const seq = draft.content.steps.reduce((max, step) => Math.max(max, step.seq), 0) + 1
      const step: DisassemblyStep = {
        id: createId('draft-step'),
        jointTypeId: draft.jointTypeId,
        seq,
        action: '装配',
        direction: '轴向',
        tool: '木槌',
        riskNote: '校样草稿新增步骤，补充风险提醒。',
        holdSec: 6,
        schemaRev: 3,
      }
      await applyContent(draftId, (content) => ({ ...content, steps: [...content.steps, step] }))
    },

    removeStep: async (draftId, stepId) => {
      await applyContent(draftId, (content) => {
        const remaining = content.steps
          .filter((step) => step.id !== stepId)
          .sort((a, b) => a.seq - b.seq)
          .map((step, index) => ({ ...step, seq: index + 1 }))
        return {
          ...content,
          steps: remaining,
          diagrams: content.diagrams.filter((diagram) => diagram.stepId !== stepId),
        }
      })
    },

    reorderSteps: async (draftId, from, to) => {
      await applyContent(draftId, (content) => {
        const ordered = [...content.steps].sort((a, b) => a.seq - b.seq)
        if (from === to || from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) return content
        const [moved] = ordered.splice(from, 1)
        if (!moved) return content
        ordered.splice(to, 0, moved)
        return { ...content, steps: ordered.map((step, index) => ({ ...step, seq: index + 1 })) }
      })
    },

    updateDiagram: async (draftId, diagramId, patch) => {
      await applyContent(draftId, (content) => ({
        ...content,
        diagrams: content.diagrams.map((diagram) =>
          diagram.id === diagramId ? { ...diagram, ...patch } : diagram,
        ),
      }))
    },

    addDiagram: async (draftId) => {
      const draft = get().drafts.find((item) => item.id === draftId)
      if (!draft) return
      const unboundStep = draft.content.steps.find(
        (step) => !draft.content.diagrams.some((diagram) => diagram.stepId === step.id),
      )
      const step = unboundStep ?? draft.content.steps[draft.content.steps.length - 1]
      if (!step) return
      const diagram: Diagram = {
        id: createId('draft-diagram'),
        jointTypeId: draft.jointTypeId,
        stepId: step.id,
        title: `第 ${step.seq} 步示意图`,
        view: '正视',
        svgMarkup: emptyDiagramSvg(draft.content.members.map((member) => member.id)),
        hitAreas: [],
        schemaRev: 3,
      }
      await applyContent(draftId, (content) => ({ ...content, diagrams: [...content.diagrams, diagram] }))
    },

    removeDiagram: async (draftId, diagramId) => {
      await applyContent(draftId, (content) => ({
        ...content,
        diagrams: content.diagrams.filter((diagram) => diagram.id !== diagramId),
      }))
    },

    updateFurniture: async (draftId, furnitureId, patch) => {
      await applyContent(draftId, (content) => ({
        ...content,
        furniture: content.furniture.map((item) =>
          item.id === furnitureId ? { ...item, ...patch } : item,
        ),
      }))
    },

    addFurniture: async (draftId) => {
      const draft = get().drafts.find((item) => item.id === draftId)
      if (!draft) return
      const furniture: Furniture = {
        id: createId('draft-furniture'),
        jointTypeId: draft.jointTypeId,
        name: '圈椅',
        era: '明式',
        position: '',
        loadNote: '',
        schemaRev: 3,
      }
      await applyContent(draftId, (content) => ({ ...content, furniture: [...content.furniture, furniture] }))
    },

    removeFurniture: async (draftId, furnitureId) => {
      await applyContent(draftId, (content) => ({
        ...content,
        furniture: content.furniture.filter((item) => item.id !== furnitureId),
      }))
    },

    submitDraft: async (draftId) => {
      const draft = get().drafts.find((item) => item.id === draftId)
      if (!draft) return emptyCommitError([], [])
      set({ submitting: true })
      try {
        const joint = await db.joints.get(draft.jointTypeId)
        const formal = await loadFormalContent(draft.jointTypeId)

        // 提交前核对：冲突以正式版本为准
        const { merged, conflicts } = mergeDraftWithFormal(draft, formal)
        const issues = validateContent(draft.jointTypeId, merged, Boolean(joint))
        if (hasBlockingErrors(issues)) {
          // 断链整批拦住，半批不进正式图鉴
          const failed: ProofDraft = {
            ...draft,
            status: 'submit_failed',
            conflicts,
            lastError: '存在断链或必填缺失，整批未入库',
            updatedAt: Date.now(),
          }
          await db.proofDrafts.put(failed)
          set((state) => ({
            drafts: state.drafts.map((item) => (item.id === draftId ? failed : item)),
          }))
          return emptyCommitError(issues, conflicts)
        }

        const previousVersions = await db.proofVersions
          .where('jointTypeId').equals(draft.jointTypeId)
          .toArray()
        const versionNumber = previousVersions.reduce((max, item) => Math.max(max, item.version), 0) + 1
        const now = Date.now()
        const version: VersionSummary = {
          id: createId('version'),
          jointTypeId: draft.jointTypeId,
          jointNameSnapshot: draft.jointNameSnapshot,
          version: versionNumber,
          note: draft.restoredFromVersionId ? `由历史版本恢复后提交` : '校样台提交',
          committedAt: now,
          changeSummary: summarizeChanges(draft.baseHashes, merged),
          conflictsResolved: conflicts,
          snapshot: JSON.parse(JSON.stringify(merged)) as DraftContent,
          schemaRev: 3,
        }

        try {
          // 原子入库：四类内容与版本摘要同一事务，任一失败整批回滚
          await db.transaction(
            'rw',
            [db.members, db.steps, db.diagrams, db.furniture, db.proofVersions],
            async () => {
              if (isCommitFailureArmed()) {
                throw new Error('模拟正式图鉴写入失败（故障注入已开启）')
              }
              await db.members.bulkPut(merged.members)
              await db.steps.bulkPut(merged.steps)
              await db.diagrams.bulkPut(merged.diagrams)
              await db.furniture.bulkPut(merged.furniture)

              const liveMemberIds = new Set(merged.members.map((item) => item.id))
              const liveStepIds = new Set(merged.steps.map((item) => item.id))
              const liveDiagramIds = new Set(merged.diagrams.map((item) => item.id))
              const liveFurnitureIds = new Set(merged.furniture.map((item) => item.id))
              const staleMemberIds = (await db.members.where('jointTypeId').equals(draft.jointTypeId).primaryKeys())
                .filter((id) => !liveMemberIds.has(id))
              const staleStepIds = (await db.steps.where('jointTypeId').equals(draft.jointTypeId).primaryKeys())
                .filter((id) => !liveStepIds.has(id))
              const staleDiagramIds = (await db.diagrams.where('jointTypeId').equals(draft.jointTypeId).primaryKeys())
                .filter((id) => !liveDiagramIds.has(id))
              const staleFurnitureIds = (await db.furniture.where('jointTypeId').equals(draft.jointTypeId).primaryKeys())
                .filter((id) => !liveFurnitureIds.has(id))
              if (staleMemberIds.length) await db.members.bulkDelete(staleMemberIds)
              if (staleStepIds.length) await db.steps.bulkDelete(staleStepIds)
              if (staleDiagramIds.length) await db.diagrams.bulkDelete(staleDiagramIds)
              if (staleFurnitureIds.length) await db.furniture.bulkDelete(staleFurnitureIds)

              await db.proofVersions.add(version)
            },
          )
        } catch (writeError) {
          // 正式图鉴写失败：事务已整体回滚，草稿保留并可继续提交
          const failed: ProofDraft = {
            ...draft,
            status: 'submit_failed',
            conflicts,
            lastError: writeError instanceof Error ? writeError.message : '正式图鉴写入失败，草稿已保留',
            failCount: draft.failCount + 1,
            updatedAt: Date.now(),
          }
          await db.proofDrafts.put(failed)
          set((state) => ({
            drafts: state.drafts.map((item) => (item.id === draftId ? failed : item)),
          }))
          return {
            ok: false,
            issues,
            conflicts,
            error: failed.lastError ?? undefined,
          }
        }

        // 入库成功后标记草稿为已提交（留档），基线对齐正式版本，刷新版本列表
        const nextDimBaseline: ProofDraft['dimBaseline'] = {}
        merged.members.forEach((member) => {
          nextDimBaseline[member.id] = {
            lengthMm: member.lengthMm,
            widthMm: member.widthMm,
            thicknessMm: member.thicknessMm,
            toleranceMm: member.toleranceMm,
          }
        })
        const committed: ProofDraft = {
          ...draft,
          content: merged,
          status: 'committed',
          conflicts,
          lastError: null,
          baseHashes: fingerprintContent(merged),
          dimBaseline: nextDimBaseline,
          changedMemberIds: [],
          updatedAt: Date.now(),
        }
        await db.proofDrafts.put(committed)
        set((state) => ({
          submitting: false,
          drafts: state.drafts.map((item) => (item.id === draftId ? committed : item)),
          versions: [version, ...state.versions].sort((a, b) => b.committedAt - a.committedAt),
        }))
        return { ok: true, issues, conflicts, versionId: version.id, version: version.version }
      } finally {
        set({ submitting: false })
      }
    },

    restoreVersion: async (versionId) => {
      const stored = await db.proofVersions.get(versionId)
      if (!stored) {
        return { ok: false, issues: [], conflicts: [] }
      }
      const formal = await loadFormalContent(stored.jointTypeId)
      const result = buildRestoreDraft(stored, formal, Date.now())
      await db.proofDrafts.add(result.draft)
      set((state) => ({ drafts: [result.draft, ...state.drafts] }))
      return { ok: result.ok, issues: result.issues, conflicts: result.conflicts, draftId: result.draft.id }
    },

    getVersions: (jointTypeId) =>
      get().versions
        .filter((version) => version.jointTypeId === jointTypeId)
        .sort((a, b) => b.version - a.version),

    removeVersion: async (versionId) => {
      await db.proofVersions.delete(versionId)
      set((state) => ({ versions: state.versions.filter((version) => version.id !== versionId) }))
    },
  }
})

