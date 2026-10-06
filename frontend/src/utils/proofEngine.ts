import type { Diagram, HitArea } from '../types/diagram'
import type { Furniture } from '../types/furniture'
import type { Member } from '../types/member'
import type { DisassemblyStep } from '../types/step'
import type {
  ChangeCounts,
  ChangeSummary,
  CommitResult,
  DraftContent,
  EntityKind,
  MemberImpact,
  ProofDraft,
  ResolvedConflict,
  RestoreResult,
  ValidationIssue,
  VersionSummary,
} from '../types/proof'
import { checkTolerance } from './measure'

/** 尺寸公差的基准：基准间隙 0.20 mm，允许偏离 ±0.12 mm */
export const TOLERANCE_BASE_MM = 0.2
export const TOLERANCE_BAND_MM = 0.12

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 稳定指纹：同一实体内容得到同一哈希，供版本/冲突比对 */
export function stableHash(value: unknown): string {
  const json = canonicalJson(value)
  let hash = 5381
  for (let index = 0; index < json.length; index += 1) {
    hash = ((hash << 5) + hash + json.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function hashEntity(kind: EntityKind, entity: { id: string }): string {
  return stableHash({ kind, entity })
}
export function hashKey(kind: EntityKind, id: string): string {
  return `${kind}:${id}`
}

export function fingerprintContent(content: DraftContent): Record<string, string> {
  const hashes: Record<string, string> = {}
  content.members.forEach((entity) => { hashes[hashKey('member', entity.id)] = hashEntity('member', entity) })
  content.steps.forEach((entity) => { hashes[hashKey('step', entity.id)] = hashEntity('step', entity) })
  content.diagrams.forEach((entity) => { hashes[hashKey('diagram', entity.id)] = hashEntity('diagram', entity) })
  content.furniture.forEach((entity) => { hashes[hashKey('furniture', entity.id)] = hashEntity('furniture', entity) })
  return hashes
}

/** 解析示意图热区实际指向的构件 id（SVG data-member-id 优先，缺失时回退登记的热区） */
export function parseDiagramMemberIds(diagram: Diagram): string[] {
  const ids: string[] = []
  if (typeof DOMParser !== 'undefined' && diagram.svgMarkup) {
    const documentNode = new DOMParser().parseFromString(diagram.svgMarkup, 'image/svg+xml')
    Array.from(documentNode.querySelectorAll('g[data-member-id]')).forEach((group) => {
      const memberId = group.getAttribute('data-member-id')?.trim()
      if (memberId) ids.push(memberId)
    })
  }
  if (ids.length === 0) {
    diagram.hitAreas.forEach((area: HitArea) => {
      if (area.memberId) ids.push(area.memberId)
    })
  }
  return Array.from(new Set(ids))
}

/** 从某类榫卯的正式图鉴建立隔离草稿（深拷贝，不动正式数据） */
export function buildDraftFromFormal(
  jointTypeId: string,
  jointName: string,
  formal: DraftContent,
  now: number,
): ProofDraft {
  const content: DraftContent = JSON.parse(JSON.stringify(formal)) as DraftContent
  const dimBaseline: ProofDraft['dimBaseline'] = {}
  content.members.forEach((member) => {
    dimBaseline[member.id] = {
      lengthMm: member.lengthMm,
      widthMm: member.widthMm,
      thicknessMm: member.thicknessMm,
      toleranceMm: member.toleranceMm,
    }
  })
  return {
    id: createId('draft'),
    jointTypeId,
    jointNameSnapshot: jointName,
    status: 'editing',
    content,
    baseHashes: fingerprintContent(formal),
    dimBaseline,
    changedMemberIds: [],
    restoredFromVersionId: null,
    conflicts: [],
    lastError: null,
    failCount: 0,
    createdAt: now,
    updatedAt: now,
    schemaRev: 3,
  }
}

/** 尺寸变化后重算：哪些构件改了尺寸、公差结论、受影响的示意图与步序 */
export function recomputeImpacts(draft: ProofDraft): { impacts: MemberImpact[]; changedMemberIds: string[] } {
  const { content, dimBaseline } = draft
  const changedMemberIds = content.members
    .filter((member) => {
      const baseline = dimBaseline[member.id]
      if (!baseline) return true
      return baseline.lengthMm !== member.lengthMm
        || baseline.widthMm !== member.widthMm
        || baseline.thicknessMm !== member.thicknessMm
        || baseline.toleranceMm !== member.toleranceMm
    })
    .map((member) => member.id)

  const diagramMemberIndex = new Map<string, string[]>()
  content.diagrams.forEach((diagram) => {
    diagramMemberIndex.set(diagram.id, parseDiagramMemberIds(diagram))
  })

  const impacts: MemberImpact[] = content.members.map((member) => {
    const referencingDiagramIds: string[] = []
    const referencingStepIds: string[] = []
    content.diagrams.forEach((diagram) => {
      if (diagramMemberIndex.get(diagram.id)?.includes(member.id)) {
        referencingDiagramIds.push(diagram.id)
        if (diagram.stepId && content.steps.some((step) => step.id === diagram.stepId)) {
          referencingStepIds.push(diagram.stepId)
        }
      }
    })
    return {
      memberId: member.id,
      dimensionChanged: changedMemberIds.includes(member.id),
      tolerance: checkTolerance(member.toleranceMm, TOLERANCE_BASE_MM, TOLERANCE_BAND_MM),
      referencingDiagramIds: Array.from(new Set(referencingDiagramIds)),
      referencingStepIds: Array.from(new Set(referencingStepIds)),
    }
  })

  return { impacts, changedMemberIds }
}

function issue(
  severity: ValidationIssue['severity'],
  kind: ValidationIssue['kind'],
  targetId: string,
  code: string,
  message: string,
): ValidationIssue {
  return { severity, kind, targetId, code, message }
}

/** 提交校验：步序有绑图、热区回现有构件、家具说明引用成立（另含尺寸与公差合法性） */
export function validateContent(
  jointTypeId: string,
  content: DraftContent,
  jointExists: boolean,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const memberIds = new Set(content.members.map((member) => member.id))
  const stepIds = new Set(content.steps.map((step) => step.id))
  const diagramIdsBoundToStep = new Set<string>()

  if (!jointExists) {
    issues.push(issue('error', 'joint', jointTypeId, 'joint-missing', '正式图鉴中已找不到该榫卯类型，无法入库'))
  }

  content.members.forEach((member) => {
    if (member.jointTypeId !== jointTypeId) {
      issues.push(issue('error', 'member', member.id, 'member-scope', `构件「${member.name}」已脱离原榫卯类型`))
    }
    if (![member.lengthMm, member.widthMm, member.thicknessMm, member.toleranceMm].every(Number.isFinite)
      || member.lengthMm <= 0 || member.widthMm <= 0 || member.thicknessMm <= 0) {
      issues.push(issue('error', 'member', member.id, 'member-dim-invalid', `构件「${member.name}」尺寸必须为正数`))
    }
    if (!(member.toleranceMm > 0)) {
      issues.push(issue('error', 'member', member.id, 'member-tolerance-invalid', `构件「${member.name}」公差必须为正数`))
    }
    const tolerance = checkTolerance(member.toleranceMm, TOLERANCE_BASE_MM, TOLERANCE_BAND_MM)
    if (!tolerance.withinTolerance) {
      issues.push(issue('warning', 'member', member.id, 'member-tolerance-exceed', `构件「${member.name}」${tolerance.message}，提交前请确认是否需要修配`))
    }
  })

  content.steps.forEach((step) => {
    if (step.jointTypeId !== jointTypeId) {
      issues.push(issue('error', 'step', step.id, 'step-scope', `第 ${step.seq} 步已脱离原榫卯类型`))
    }
    const bound = content.diagrams.filter((diagram) => diagram.stepId === step.id)
    if (bound.length === 0) {
      issues.push(issue('error', 'step', step.id, 'step-unbound', `第 ${step.seq} 步（${step.action}）未绑定示意图`))
    }
    bound.forEach((diagram) => diagramIdsBoundToStep.add(diagram.id))
  })

  content.diagrams.forEach((diagram) => {
    if (diagram.jointTypeId !== jointTypeId) {
      issues.push(issue('error', 'diagram', diagram.id, 'diagram-scope', `示意图「${diagram.title}」已脱离原榫卯类型`))
    }
    if (!diagram.stepId || !stepIds.has(diagram.stepId)) {
      issues.push(issue('error', 'diagram', diagram.id, 'diagram-step-broken', `示意图「${diagram.title}」没有绑定到有效步序`))
    }
    const referencedIds = parseDiagramMemberIds(diagram)
    if (referencedIds.length === 0) {
      issues.push(issue('warning', 'diagram', diagram.id, 'diagram-no-hitarea', `示意图「${diagram.title}」没有可点击的构件热区`))
    }
    referencedIds.forEach((memberId) => {
      if (!memberIds.has(memberId)) {
        issues.push(issue('error', 'diagram', diagram.id, 'diagram-hit-broken', `示意图「${diagram.title}」热区指向已不存在的构件（${memberId}）`))
      }
    })
  })

  content.furniture.forEach((item) => {
    if (item.jointTypeId !== jointTypeId) {
      issues.push(issue('error', 'furniture', item.id, 'furniture-scope', `家具说明「${item.name}」没有引用当前榫卯类型`))
    }
    if (!item.name.trim() || !item.position.trim() || !item.loadNote.trim()) {
      issues.push(issue('error', 'furniture', item.id, 'furniture-incomplete', `「${item.name || '未命名家具'}」的名称、部位与承力说明必须完整`))
    }
  })

  return issues
}

export function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((item) => item.severity === 'error')
}

const KIND_LABEL: Record<EntityKind, string> = {
  member: '构件',
  step: '步序',
  diagram: '示意图',
  furniture: '家具说明',
}

function entityLabel(kind: EntityKind, entity: Member | DisassemblyStep | Diagram | Furniture): string {
  if (kind === 'member') return (entity as Member).name
  if (kind === 'step') return `第 ${(entity as DisassemblyStep).seq} 步`
  if (kind === 'diagram') return (entity as Diagram).title
  return (entity as Furniture).name
}

/**
 * 以正式版本为准合并：草稿与正式版本同时改过（或正式版本已删除）同一实体时，正式版本获胜。
 * 仅草稿侧的新增 / 修改 / 删除照常生效；正式版本中新增的实体保留。
 */
export function mergeDraftWithFormal(
  draft: ProofDraft,
  formal: DraftContent,
): { merged: DraftContent; conflicts: ResolvedConflict[] } {
  const conflicts: ResolvedConflict[] = []

  const mergeGroup = <T extends Member | DisassemblyStep | Diagram | Furniture>(
    kind: EntityKind,
    draftEntities: T[],
    formalEntities: T[],
  ): T[] => {
    const draftMap = new Map(draftEntities.map((entity) => [entity.id, entity]))
    const result = new Map(formalEntities.map((entity) => [entity.id, entity]))

    draftMap.forEach((entity, id) => {
      const baseHash = draft.baseHashes[hashKey(kind, id)]
      if (!baseHash) {
        result.set(id, entity)
        return
      }
      const formalEntity = result.get(id)
      if (!formalEntity) {
        conflicts.push({
          kind,
          id,
          label: entityLabel(kind, entity),
          message: `${KIND_LABEL[kind]}「${entityLabel(kind, entity)}」已在正式图鉴中删除，以正式版本为准，不随草稿提交`,
        })
        result.delete(id)
        return
      }
      if (hashEntity(kind, formalEntity) !== baseHash) {
        conflicts.push({
          kind,
          id,
          label: entityLabel(kind, entity),
          message: `${KIND_LABEL[kind]}「${entityLabel(kind, entity)}」在草稿建立后已被正式图鉴修改，以正式版本为准`,
        })
        result.set(id, formalEntity)
        return
      }
      result.set(id, entity)
    })

    Object.keys(draft.baseHashes)
      .filter((key) => key.startsWith(`${kind}:`))
      .forEach((key) => {
        const id = key.slice(kind.length + 1)
        if (draftMap.has(id)) return
        const formalEntity = result.get(id)
        if (formalEntity && hashEntity(kind, formalEntity) === draft.baseHashes[key]) {
          result.delete(id)
        }
      })

    return Array.from(result.values())
  }

  const merged: DraftContent = {
    members: mergeGroup('member', draft.content.members, formal.members),
    steps: mergeGroup('step', draft.content.steps, formal.steps),
    diagrams: mergeGroup('diagram', draft.content.diagrams, formal.diagrams),
    furniture: mergeGroup('furniture', draft.content.furniture, formal.furniture),
  }

  merged.steps.sort((a, b) => a.seq - b.seq)
  return { merged, conflicts }
}

function emptyChangeCounts(): ChangeCounts {
  return { added: [], updated: [], removed: [] }
}

/** 依据建草稿时的指纹，给出四类内容的版本摘要 */
export function summarizeChanges(baseHashes: Record<string, string>, content: DraftContent): ChangeSummary {
  const summarizeGroup = <T extends Member | DisassemblyStep | Diagram | Furniture>(
    kind: EntityKind,
    entities: T[],
  ): ChangeCounts => {
    const counts: ChangeCounts = emptyChangeCounts()
    entities.forEach((entity) => {
      const baseHash = baseHashes[hashKey(kind, entity.id)]
      if (!baseHash) {
        counts.added.push(entity.id)
      } else if (hashEntity(kind, entity) !== baseHash) {
        counts.updated.push(entity.id)
      }
    })
    Object.keys(baseHashes)
      .filter((key) => key.startsWith(`${kind}:`))
      .forEach((key) => {
        const id = key.slice(kind.length + 1)
        if (!entities.some((entity) => entity.id === id)) counts.removed.push(id)
      })
    return counts
  }

  return {
    member: summarizeGroup('member', content.members),
    step: summarizeGroup('step', content.steps),
    diagram: summarizeGroup('diagram', content.diagrams),
    furniture: summarizeGroup('furniture', content.furniture),
  }
}

/** 恢复前重核：把历史版本快照与当前正式版本比对，产出带冲突记录的新草稿 */
export function buildRestoreDraft(
  version: VersionSummary,
  formal: DraftContent,
  now: number,
): RestoreResult & { draft: ProofDraft } {
  let draft = buildDraftFromFormal(version.jointTypeId, version.jointNameSnapshot, version.snapshot, now)
  draft.restoredFromVersionId = version.id
  // 以恢复点快照指纹为基线，与当前正式版本逐项重核
  draft.baseHashes = fingerprintContent(version.snapshot)
  const { merged, conflicts } = mergeDraftWithFormal(draft, formal)
  draft.content = merged
  draft.conflicts = conflicts
  draft.baseHashes = fingerprintContent(formal)
  draft.dimBaseline = {}
  merged.members.forEach((member) => {
    draft.dimBaseline[member.id] = {
      lengthMm: member.lengthMm,
      widthMm: member.widthMm,
      thicknessMm: member.thicknessMm,
      toleranceMm: member.toleranceMm,
    }
  })
  draft = { ...draft, id: createId('draft'), createdAt: now, updatedAt: now }
  const recomputed = recomputeImpacts(draft)
  draft.changedMemberIds = recomputed.changedMemberIds
  const issues = validateContent(version.jointTypeId, merged, true)
  return { ok: !hasBlockingErrors(issues), issues, conflicts, draft }
}

export function emptyCommitError(issues: ValidationIssue[], conflicts: ResolvedConflict[]): CommitResult {
  return { ok: false, issues, conflicts }
}
