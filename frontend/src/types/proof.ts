import type { Diagram } from './diagram'
import type { Furniture } from './furniture'
import type { JointType } from './jointType'
import type { Member } from './member'
import type { DisassemblyStep } from './step'

/** 某个榫卯类型的四类内容在某一时刻的完整快照：构件尺寸 / 步序 / 示意图 / 家具说明 */
export interface JointBundle {
  joint: JointType
  members: Member[]
  steps: DisassemblyStep[]
  diagrams: Diagram[]
  furniture: Furniture[]
}

export type DraftStatus = 'editing' | 'failed' | 'submitted' | 'discarded'

export type DraftStatusLabel = '编辑中' | '提交失败' | '已提交' | '已放弃'

export interface ChangeCounts {
  members: number
  steps: number
  diagrams: number
  furniture: number
  joint: number
}

export interface ProofDraft {
  id: string
  jointTypeId: string
  label: string
  status: DraftStatus
  /** 创建草稿时所依据的正式版本号 */
  baseVersion: number
  /** 创建草稿时正式图鉴的校验和，用于提交时发现正式侧的并发改动 */
  baseChecksum: string
  bundle: JointBundle
  /** 与基线相比发生过改动的构件 id（尺寸变化后联动重算公差与受影响项） */
  dirtyMembers: string[]
  lastError: string
  failSimulated: boolean
  createdAt: string
  updatedAt: string
  submittedAt: string
}

export interface CatalogVersion {
  id: string
  jointTypeId: string
  version: number
  label: string
  summary: string
  changeCounts: ChangeCounts
  bundle: JointBundle
  checksum: string
  createdAt: string
  sourceDraftId: string
  /** 恢复自哪个版本；新建草稿提交时为空 */
  restoredFromVersion: number | null
}

export interface DimensionPatch {
  lengthMm?: number
  widthMm?: number
  thicknessMm?: number
}

export interface PairClearance {
  pairKey: string
  tenon: Member
  socket: Member
  thicknessGapMm: number
  widthGapMm: number
  lengthGapMm: number
  warnings: string[]
}
