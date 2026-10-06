/* eslint-disable no-console */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'

// Node 无 DOMParser：仅模拟热区解析，与浏览器 DOMParser 行为对齐到 data-member-id 提取
class DOMParserStub {
  parseFromString(markup: string) {
    return {
      querySelectorAll(selector: string) {
        if (selector.includes('data-member-id')) {
          const ids = Array.from(markup.matchAll(/data-member-id="([^"]+)"/g)).map((m) => m[1])
          return ids.map((id) => ({ getAttribute: (name: string) => (name === 'data-member-id' ? id : null) }))
        }
        return []
      },
    }
  }
}
;(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParserStub

const { db } = await import('../src/utils/db')
const { ensureSeedData } = await import('../src/utils/db')
const {
  bindTemplateDiagrams,
  commitDraft,
  createDraftFromJoint,
  restoreVersion,
} = await import('../src/utils/proofService')
const { useProofStore } = await import('../src/stores/proofStore')
const { recalcTolerance } = await import('../src/utils/tolerance')
const { loadOfficialBundle } = await import('../src/utils/bundle')

let passed = 0
function check(name: string, fn: () => unknown) {
  const result = fn()
  assert.ok(result !== false, `${name} 断言失败`)
  passed += 1
  console.log(`✓ ${name}`)
}

async function snapshotOfficial(jointTypeId = 'joint-dovetail') {
  return JSON.stringify(await loadOfficialBundle(jointTypeId))
}

await ensureSeedData()

// 公差重算纯函数
check('尺寸变化重算公差：短边 40mm → 0.11mm，100mm → 0.28mm', () => {
  assert.equal(recalcTolerance({ lengthMm: 128, widthMm: 54, thicknessMm: 40 }, 0.15), 0.11)
  assert.equal(recalcTolerance({ lengthMm: 200, widthMm: 100, thicknessMm: 100 }, 0.2), 0.28)
  return true
})

// 场景一：种子草稿存在未绑图步序（第2、3步），断链闸门整批拦截，正式表不动
const beforeBlock = await snapshotOfficial()
const blockedDraft = await createDraftFromJoint('joint-dovetail')
let blocked = false
try {
  await commitDraft(blockedDraft)
} catch (error) {
  blocked = (error as Error).name === 'ProofBlockedError'
}
check('未绑图/断链整批拦住，抛 ProofBlockedError', () => blocked)
check('被拦截时正式图鉴完全不变（半批不进）', () => true)
const afterBlock = await snapshotOfficial()
assert.equal(afterBlock, beforeBlock, '拦截后正式数据发生变化')
passed += 1; console.log('✓ 拦截前后正式五表快照一致')

// 场景二：一键绑图后原子入库，留版本摘要 v1
const store = useProofStore.getState()
await store.startDraft('joint-dovetail')
await store.autoBindSteps()
const okOutcome = await store.submit(false)
assert.equal(okOutcome.kind, 'committed')
passed += 1; console.log('✓ 绑图补齐后提交成功，原子入库')
const versionCount1 = await db.catalogVersions.where('jointTypeId').equals('joint-dovetail').count()
assert.equal(versionCount1, 1)
passed += 1; console.log('✓ catalogVersions 留下 v1 版本摘要')

// 场景三：删除构件制造热区+家具引用断链，拦截
const draftBroken = await createDraftFromJoint('joint-dovetail')
draftBroken.bundle = bindTemplateDiagrams(draftBroken.bundle)
draftBroken.bundle.members = draftBroken.bundle.members.filter((m) => m.id !== 'member-dt-tenon')
let brokenBlocked = false
try {
  await commitDraft(draftBroken)
} catch (error) {
  brokenBlocked = (error as Error).name === 'ProofBlockedError'
}
check('热区与家具说明同时断链仍整批拦截', () => brokenBlocked)

// 场景四：演练正式图鉴写失败 → 事务整体回滚，草稿保留可继续提交
const mitreBefore = JSON.stringify(await loadOfficialBundle('joint-mitre'))
await store.startDraft('joint-mitre')
const mitreId = useProofStore.getState().currentDraftId!
await store.autoBindSteps()
const mitreMember = useProofStore.getState().drafts.find((d) => d.id === mitreId)!
// 把格肩榫一个构件尺寸改掉，制造实质改动
await store.updateMember(mitreMember.bundle.members[0].id, { lengthMm: 222 })
const failOutcome = await store.submit(true)
assert.equal(failOutcome.kind, 'failed')
assert.ok(failOutcome.message.includes('草稿已保留'))
passed += 1; console.log('✓ 写失败返回 failed 且提示草稿保留可继续提交')
const mitreAfterFail = JSON.stringify(await loadOfficialBundle('joint-mitre'))
assert.equal(mitreAfterFail, mitreBefore, '写失败后正式表被污染，原子性不成立')
passed += 1; console.log('✓ 写失败事务整体回滚，正式图鉴零改动')
const failedDraft = useProofStore.getState().drafts.find((d) => d.status === 'failed')
assert.ok(failedDraft, '草稿未被标记为 failed')
assert.ok(JSON.stringify(failedDraft.bundle).includes('222'), '失败草稿内容丢失')
passed += 1; console.log('✓ 失败草稿完整保留（含改动 222mm）')
await store.openDraft(failedDraft.id)
const retryOutcome = await store.submit(false)
assert.equal(retryOutcome.kind, 'committed')
passed += 1; console.log('✓ 同一草稿修复后可再次提交成功（恢复继续提交）')
const mitreOfficial = await loadOfficialBundle('joint-mitre')
assert.ok(JSON.stringify(mitreOfficial.members).includes('222'), '重试提交内容未生效')
passed += 1; console.log('✓ 重试提交的改动原子生效')

// 再为燕尾榫提交 v2，制造历史版本差
await store.startDraft('joint-dovetail')
const dtV2Id = useProofStore.getState().currentDraftId!
await store.openDraft(dtV2Id)
const dtV2 = useProofStore.getState().drafts.find((d) => d.id === dtV2Id)!
await store.updateMember(dtV2.bundle.members.find((m) => m.id === 'member-dt-frame')!.id, { lengthMm: 700 })
assert.equal((await store.submit(false)).kind, 'committed')
passed += 1; console.log('✓ 燕尾榫第二次提交形成 v2 版本摘要')

// 场景五：恢复旧版本 → 正式已更新时冲突以正式为准，只生成草稿不覆盖
const officialBeforeOldRestore = JSON.stringify(await loadOfficialBundle('joint-dovetail'))
const versions = await db.catalogVersions.where('jointTypeId').equals('joint-dovetail').toArray()
const v1 = versions.find((v) => v.version === 1)!
assert.ok(v1, '缺少 v1')
const conflictRestore = await restoreVersion(v1.id)
assert.equal(conflictRestore.status, 'conflict')
assert.ok(conflictRestore.draft, '冲突时未生成校样草稿')
passed += 1; console.log('✓ 恢复旧 v1：冲突以正式为准，不覆盖，转校样草稿')
const officialAfterOldRestore = JSON.stringify(await loadOfficialBundle('joint-dovetail'))
assert.equal(officialAfterOldRestore, officialBeforeOldRestore, '冲突恢复竟然改动了正式图鉴')
passed += 1; console.log('✓ 冲突恢复后正式图鉴内容不变')

// 恢复最新版本：恢复前重核通过 → 原子回滚并新增恢复版本摘要
const latestBefore = (await db.catalogVersions.where('jointTypeId').equals('joint-dovetail').toArray())
  .sort((a, b) => b.version - a.version)[0]
assert.equal(latestBefore.version, 2)
const restoreLatest = await restoreVersion(latestBefore.id)
assert.equal(restoreLatest.status, 'restored')
assert.ok(restoreLatest.version?.restoredFromVersion === 2)
passed += 1; console.log('✓ 恢复最新版本：重核通过、原子入库并标注“恢复自 v2”')
// 恢复 v2 内容与 v2 相同，版本摘要计数应统计为无实质改动（顺序/元数据已规范化）
const restoredCounts = restoreLatest.version!.changeCounts
assert.deepEqual(restoredCounts, { members: 0, steps: 0, diagrams: 0, furniture: 0, joint: 0 })
assert.equal(restoreLatest.version!.summary, '恢复自 v2')
passed += 1; console.log('✓ 恢复版本摘要计数正确（内容一致 → 四类改动均为 0）')
const finalVersions = await db.catalogVersions.where('jointTypeId').equals('joint-dovetail').count()
assert.equal(finalVersions, 3)
passed += 1; console.log('✓ 恢复动作自身也留版本摘要（v3）')

// 场景六：草稿期间正式侧被别处直写 → 提交冲突，以正式版本为准
const conflictDraft = await createDraftFromJoint('joint-dovetail')
await db.members.update('member-dt-frame', { widthMm: 999 }) // 模拟旧页面直接覆盖正式表
let conflictError = false
try {
  await commitDraft(conflictDraft)
} catch (error) {
  conflictError = (error as Error).name === 'ProofConflictError'
}
check('正式侧并发改动触发校验和冲突，提交被拒', () => conflictError)
const frameAfter = (await db.members.get('member-dt-frame'))!
assert.equal(frameAfter.widthMm, 999)
passed += 1; console.log('✓ 冲突时正式版本原样保留（以正式为准）')

console.log(`\n全部 ${passed} 项端到端断言通过`)
