import type { Diagram } from './diagram'
import type { Furniture } from './furniture'
import type { Member } from './member'
import type { DisassemblyStep } from './step'
import type { ToleranceResult } from '../utils/measure'

/** 校样四类可改内容：构件尺寸、拆装步序、示意图、家具说明 */
export interface DraftContent {
  members: Member[]
  steps: DisassemblyStep[]
  diagrams: Diagram[]
  furniture: Furniture[]
}

export type DraftStatus = 'editing' | 'submit_failed' | 'committed'

export type EntityKind = 'member' | 'step' | 'diagram' | 'furniture'

export interface MemberImpact {
  memberId: string
  dimensionChanged: boolean
  tolerance: ToleranceResult
  /** 热区引用该构件的示意图 */
  referencingDiagramIds: string[]
  /** 绑定上述示意图、需要一并复核的步序 */
  referencingStepIds: string[]
}

export type IssueSeverity = 'error' | 'warning'
export type IssueKind = EntityKind | 'joint'

export interface ValidationIssue {
  code: string
  severity: IssueSeverity
  kind: IssueKind
  targetId: string
  message: string
}

export interface ResolvedConflict {
  kind: EntityKind
  id: string
  label: string
  message: string
}

export interface ChangeCounts {
  added: string[]
  updated: string[]
  removed: string[]
}

export interface ChangeSummary {
  member: ChangeCounts
  step: ChangeCounts
  diagram: ChangeCounts
  furniture: ChangeCounts
}

/** 校样草稿：正式图鉴的隔离工作副本 */
export interface ProofDraft {
  id: string
  jointTypeId: string
  jointNameSnapshot: string
  status: DraftStatus
  content: DraftContent
  /** 建草稿（或从版本恢复）时各类正式实体的指纹，用于识别并发改动 */
  baseHashes: Record<string, string>
  /** 建草稿时的尺寸基准，用于判断尺寸是否变化 */
  dimBaseline: Record<string, Pick<Member, 'lengthMm' | 'widthMm' | 'thicknessMm' | 'toleranceMm'>>
  changedMemberIds: string[]
  restoredFromVersionId: string | null
  conflicts: ResolvedConflict[]
  lastError: string | null
  failCount: number
  createdAt: number
  updatedAt: number
  schemaRev?: number
}

/** 正式图鉴版本摘要：原子入库后留存，可回看、可恢复 */
export interface VersionSummary {
  id: string
  jointTypeId: string
  jointNameSnapshot: string
  version: number
  note: string
  committedAt: number
  changeSummary: ChangeSummary
  conflictsResolved: ResolvedConflict[]
  snapshot: DraftContent
  schemaRev?: number
}

export interface CommitResult {
  ok: boolean
  issues: ValidationIssue[]
  conflicts: ResolvedConflict[]
  versionId?: string
  version?: number
  error?: string
}

export interface RestoreResult {
  ok: boolean
  issues: ValidationIssue[]
  conflicts: ResolvedConflict[]
  draftId?: string
}
