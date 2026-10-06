import type { Transaction } from 'dexie'
import { db, makeTemplateSvg } from './db'
import { checksumBundle, cloneBundle, canonicalizeBundle, loadOfficialBundle } from './bundle'
import { describeChanges, diffBundles, hasChanges } from './diff'
import { runProofCheck } from './proofCheck'
import type {
  CatalogVersion,
  JointBundle,
  ProofDraft,
} from '../types/proof'

export class ProofConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProofConflictError'
  }
}

export class ProofBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProofBlockedError'
  }
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

async function nextVersionNumber(jointTypeId: string): Promise<number> {
  return db.catalogVersions.where('jointTypeId').equals(jointTypeId).count()
}

async function txVersionCount(tx: Transaction, jointTypeId: string): Promise<number> {
  return tx.table<CatalogVersion, string>('catalogVersions')
    .where('jointTypeId').equals(jointTypeId).count()
}

/** 从某类榫卯的正式图鉴建立草稿（沙箱拷贝，不动正式表） */
export async function createDraftFromJoint(jointTypeId: string, label?: string): Promise<ProofDraft> {
  const official = await loadOfficialBundle(jointTypeId)
  if (!official) throw new Error('正式图鉴中不存在该榫卯类型')
  const now = new Date().toISOString()
  const version = await nextVersionNumber(jointTypeId)
  const draft: ProofDraft = {
    id: createId('draft'),
    jointTypeId,
    label: label?.trim() || `${official.joint.name}校样 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    status: 'editing',
    baseVersion: version,
    baseChecksum: checksumBundle(official),
    bundle: cloneBundle(official),
    dirtyMembers: [],
    lastError: '',
    failSimulated: false,
    createdAt: now,
    updatedAt: now,
    submittedAt: '',
  }
  await db.proofDrafts.put(draft)
  return draft
}

export async function saveDraft(draft: ProofDraft): Promise<ProofDraft> {
  const saved: ProofDraft = { ...draft, updatedAt: new Date().toISOString() }
  await db.proofDrafts.put(saved)
  return saved
}

export async function discardDraft(draftId: string): Promise<void> {
  await db.proofDrafts.update(draftId, { status: 'discarded', updatedAt: new Date().toISOString() })
}

export async function listDrafts(): Promise<ProofDraft[]> {
  const drafts = await db.proofDrafts.toArray()
  return drafts
    .filter((draft) => draft.status !== 'discarded')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function listVersions(jointTypeId?: string): Promise<CatalogVersion[]> {
  const versions = jointTypeId
    ? await db.catalogVersions.where('jointTypeId').equals(jointTypeId).toArray()
    : await db.catalogVersions.toArray()
  return versions.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || b.version - a.version)
}

/**
 * 原子提交：
 * 1) 断链闸门在事务内再核一次，整批拦住，半批不进正式图鉴；
 * 2) 正式版本校验和与基线不一致即冲突，以正式版本为准，草稿保持可恢复；
 * 3) 五张正式表 + 版本表 + 草稿表同一事务，任一步失败整体回滚。
 */
export async function commitDraft(draft: ProofDraft, simulateWriteFailure = false): Promise<{ version: CatalogVersion; draft: ProofDraft }> {
  const bundle = canonicalizeBundle(cloneBundle(draft.bundle))
  const check = runProofCheck(bundle)
  if (check.blocked) {
    throw new ProofBlockedError(`断链或未绑图 ${check.errors.length} 处，整批拦下，正式图鉴未写入`)
  }

  return db.transaction(
    'rw',
    [db.joints, db.members, db.steps, db.diagrams, db.furniture, db.catalogVersions, db.proofDrafts],
    async (tx) => {
      const officialRaw: JointBundle = {
        joint: await tx.table('joints').get(draft.jointTypeId),
        members: await tx.table('members').where('jointTypeId').equals(draft.jointTypeId).toArray(),
        steps: await tx.table('steps').where('jointTypeId').equals(draft.jointTypeId).toArray(),
        diagrams: await tx.table('diagrams').where('jointTypeId').equals(draft.jointTypeId).toArray(),
        furniture: await tx.table('furniture').where('jointTypeId').equals(draft.jointTypeId).toArray(),
      }
      if (!officialRaw.joint) throw new Error('正式图鉴中的榫卯已不存在，提交中止')
      const official = canonicalizeBundle(officialRaw)

      // 冲突以正式版本为准：正式侧已被别处改动，本草稿必须先按正式版本重整
      if (checksumBundle(official) !== draft.baseChecksum) {
        throw new ProofConflictError('正式图鉴在草稿期间已被改动（版本冲突），以正式版本为准，请重整草稿后再提交')
      }

      const versionNumber = await txVersionCount(tx, draft.jointTypeId) + 1
      const counts = diffBundles(official, bundle)
      const now = new Date().toISOString()
      const version: CatalogVersion = {
        id: createId('ver'),
        jointTypeId: draft.jointTypeId,
        version: versionNumber,
        label: `v${versionNumber} · ${bundle.joint.name}`,
        summary: describeChanges(counts),
        changeCounts: counts,
        bundle,
        checksum: checksumBundle(bundle),
        createdAt: now,
        sourceDraftId: draft.id,
        restoredFromVersion: null,
      }

      // 单榫卯域整体替换：先清旧行再写整包，五表同生共死
      await Promise.all([
        tx.table('members').where('jointTypeId').equals(draft.jointTypeId).delete(),
        tx.table('steps').where('jointTypeId').equals(draft.jointTypeId).delete(),
        tx.table('diagrams').where('jointTypeId').equals(draft.jointTypeId).delete(),
        tx.table('furniture').where('jointTypeId').equals(draft.jointTypeId).delete(),
      ])
      await tx.table('joints').put({ ...bundle.joint, schemaRev: 3 })
      await tx.table('members').bulkPut(bundle.members.map((item) => ({ ...item, schemaRev: 3 })))
      await tx.table('steps').bulkPut(bundle.steps.map((item) => ({ ...item, schemaRev: 3 })))
      await tx.table('diagrams').bulkPut(bundle.diagrams.map((item) => ({ ...item, schemaRev: 3 })))
      await tx.table('furniture').bulkPut(bundle.furniture.map((item) => ({ ...item, schemaRev: 3 })))

      await tx.table('catalogVersions').add(version)

      // 演练写入失败：抛在事务内部，上面所有正式表写入整体回滚，草稿仍可继续提交
      if (simulateWriteFailure) {
        throw new Error('模拟正式图鉴写入失败（磁盘/事务异常）')
      }

      const updatedDraft: ProofDraft = {
        ...draft,
        status: 'submitted',
        lastError: '',
        failSimulated: simulateWriteFailure,
        updatedAt: now,
        submittedAt: now,
      }
      await tx.table('proofDrafts').put(updatedDraft)
      return { version, draft: updatedDraft }
    },
  )
}

export interface RestoreResult {
  status: 'restored' | 'conflict' | 'blocked'
  draft?: ProofDraft
  version?: CatalogVersion
  message: string
}

/**
 * 恢复历史版本：
 * - 恢复前重核：先跑断链闸门，再比较正式当前版本；
 * - 正式版本更新时冲突以正式版本为准，不直接覆盖，改为据旧版本新建校样草稿走提交流程；
 * - 无冲突则在同一事务内整包回滚并留一条恢复版本摘要。
 */
export async function restoreVersion(versionId: string): Promise<RestoreResult> {
  const target = await db.catalogVersions.get(versionId)
  if (!target) return { status: 'blocked', message: '历史版本不存在' }

  const recheck = runProofCheck(target.bundle)
  if (recheck.blocked) {
    return {
      status: 'blocked',
      message: `恢复前重核未通过：${recheck.errors.map((issue) => issue.message).join('；')}`,
    }
  }

  const latestCount = await nextVersionNumber(target.jointTypeId)
  if (target.version !== latestCount) {
    // 冲突以正式版本为准：不覆盖正式，把旧版本快照作为新草稿的起点，重核后由用户再提交
    const official = await loadOfficialBundle(target.jointTypeId)
    if (!official) return { status: 'blocked', message: '正式图鉴中的榫卯已不存在' }
    const now = new Date().toISOString()
    const draft: ProofDraft = {
      id: createId('draft'),
      jointTypeId: target.jointTypeId,
      label: `恢复 v${target.version} 的校样（正式已到 v${latestCount}）`,
      status: 'editing',
      baseVersion: latestCount,
      baseChecksum: checksumBundle(official),
      bundle: cloneBundle(target.bundle),
      dirtyMembers: [],
      lastError: '',
      failSimulated: false,
      createdAt: now,
      updatedAt: now,
      submittedAt: '',
    }
    await db.proofDrafts.put(draft)
    return {
      status: 'conflict',
      draft,
      message: `正式版本已到 v${latestCount}，旧 v${target.version} 不能直接覆盖；已按正式版本为准生成校样草稿，重核通过后可再提交`,
    }
  }

  const restoredBundle = canonicalizeBundle(cloneBundle(target.bundle))
  const nowIso = new Date().toISOString()
  const result = await db.transaction(
    'rw',
    [db.joints, db.members, db.steps, db.diagrams, db.furniture, db.catalogVersions],
    async (tx) => {
      const beforeRaw: JointBundle = {
        joint: await tx.table('joints').get(target.jointTypeId),
        members: await tx.table('members').where('jointTypeId').equals(target.jointTypeId).toArray(),
        steps: await tx.table('steps').where('jointTypeId').equals(target.jointTypeId).toArray(),
        diagrams: await tx.table('diagrams').where('jointTypeId').equals(target.jointTypeId).toArray(),
        furniture: await tx.table('furniture').where('jointTypeId').equals(target.jointTypeId).toArray(),
      }
      const before = canonicalizeBundle(beforeRaw)
      await Promise.all([
        tx.table('members').where('jointTypeId').equals(target.jointTypeId).delete(),
        tx.table('steps').where('jointTypeId').equals(target.jointTypeId).delete(),
        tx.table('diagrams').where('jointTypeId').equals(target.jointTypeId).delete(),
        tx.table('furniture').where('jointTypeId').equals(target.jointTypeId).delete(),
      ])
      await tx.table('joints').put({ ...restoredBundle.joint, schemaRev: 3 })
      await tx.table('members').bulkPut(restoredBundle.members.map((item) => ({ ...item, schemaRev: 3 })))
      await tx.table('steps').bulkPut(restoredBundle.steps.map((item) => ({ ...item, schemaRev: 3 })))
      await tx.table('diagrams').bulkPut(restoredBundle.diagrams.map((item) => ({ ...item, schemaRev: 3 })))
      await tx.table('furniture').bulkPut(restoredBundle.furniture.map((item) => ({ ...item, schemaRev: 3 })))

      const newVersionNumber = target.version === latestCount ? target.version + 1 : latestCount + 1
      const version: CatalogVersion = {
        id: createId('ver'),
        jointTypeId: target.jointTypeId,
        version: newVersionNumber,
        label: `v${newVersionNumber} · ${restoredBundle.joint.name}`,
        summary: `恢复自 v${target.version}`,
        changeCounts: diffBundles(before, restoredBundle),
        bundle: restoredBundle,
        checksum: checksumBundle(restoredBundle),
        createdAt: nowIso,
        sourceDraftId: '',
        restoredFromVersion: target.version,
      }
      await tx.table('catalogVersions').add(version)
      return version
    },
  )

  return {
    status: 'restored',
    version: result,
    message: `已恢复并原子入库为 ${result.label}，恢复前重核通过`,
  }
}

/** 一键修复：给每个未绑图的步序用当前构件生成模板示意图 */
export function bindTemplateDiagrams(bundle: JointBundle): JointBundle {
  const next = cloneBundle(bundle)
  const boundStepIds = new Set(next.diagrams.map((diagram) => diagram.stepId))
  const members = next.members
  next.steps
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .forEach((step) => {
      if (boundStepIds.has(step.id)) return
      const refs = members.slice(0, 3)
      const diagramId = createId('diagram')
      next.diagrams.push({
        id: diagramId,
        jointTypeId: next.joint.id,
        stepId: step.id,
        title: `${next.joint.name}第${step.seq}步示意`,
        view: '轴测',
        svgMarkup: makeTemplateSvg(
          `${next.joint.name} · 第${step.seq}步`,
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
      boundStepIds.add(step.id)
    })
  return next
}

export function resequenceSteps(bundle: JointBundle): JointBundle {
  const next = cloneBundle(bundle)
  next.steps = next.steps
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((step, index) => ({ ...step, seq: index + 1 }))
  return next
}

export function getChanges(before: JointBundle, after: JointBundle) {
  const counts = diffBundles(before, after)
  return { counts, changed: hasChanges(counts), summary: describeChanges(counts) }
}
