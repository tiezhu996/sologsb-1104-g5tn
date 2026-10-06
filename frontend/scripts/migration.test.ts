import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import Dexie, { type Table } from 'dexie'
import type { Diagram } from '../src/types/diagram'
import type { Furniture } from '../src/types/furniture'
import type { JointType } from '../src/types/jointType'
import type { Member } from '../src/types/member'
import type { DisassemblyStep } from '../src/types/step'

// 先以旧版 v2 schema 建库并写入一条无 memberId 的家具
class LegacyDb extends Dexie {
  joints!: Table<JointType, string>
  members!: Table<Member, string>
  steps!: Table<DisassemblyStep, string>
  diagrams!: Table<Diagram, string>
  furniture!: Table<Furniture, string>
  constructor() {
    super('gbmortise-db')
    const schema = {
      joints: 'id, name, family, difficulty',
      members: 'id, jointTypeId, name, part, lengthMm',
      steps: 'id, jointTypeId, seq, action',
      diagrams: 'id, jointTypeId, stepId, view',
      furniture: 'id, jointTypeId, name',
    }
    this.version(1).stores(schema)
    this.version(2).stores(schema)
  }
}

const legacy = new LegacyDb()
await legacy.transaction('rw', [legacy.joints, legacy.members, legacy.steps, legacy.diagrams, legacy.furniture], async () => {
  await legacy.joints.add({ id: 'j1', name: '燕尾榫', family: '出头', difficulty: '入门', strengthNote: '', glueNeeded: false })
  await legacy.furniture.add({ id: 'furniture-tiaoan', jointTypeId: 'j1', name: '条案', era: '明式', position: '端部', loadNote: '受力' })
})
await legacy.close()

// 再用当前代码打开：应自动升到 v3 并回填 memberId
const { db: currentDb } = await import('../src/utils/db')
const furniture = await currentDb.furniture.get('furniture-tiaoan')
assert.ok(furniture, '升级后旧家具记录丢失')
assert.equal(furniture.memberId, 'member-dt-tenon', 'v3 升级未回填家具构件引用')
const tables = currentDb.tables
assert.ok(tables.some((t) => t.name === 'proofDrafts'), '缺少 proofDrafts 表')
assert.ok(tables.some((t) => t.name === 'catalogVersions'), '缺少 catalogVersions 表')
const joint = await currentDb.joints.get('j1')
assert.ok(joint, '升级后 joints 数据丢失')
console.log('✓ v2 → v3 升级成功：两新表就位、家具引用回填、旧数据保留')
console.log('迁移断言通过')
