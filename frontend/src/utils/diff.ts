import type { ChangeCounts, JointBundle } from '../types/proof'

/** 剔除落库元数据，只比较四类业务内容 */
function stripMeta<T>(item: T): T {
  if (Array.isArray(item)) return item.map(stripMeta) as T
  if (item && typeof item === 'object') {
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>)
        .filter(([key]) => key !== 'schemaRev')
        .map(([key, value]) => [key, stripMeta(value)]),
    ) as T
  }
  return item
}

function countChanged<T extends { id: string }>(beforeItemsRaw: T[], afterItemsRaw: T[]): number {
  const beforeItems = beforeItemsRaw.map(stripMeta)
  const afterItems = afterItemsRaw.map(stripMeta)
  const beforeMap = new Map(beforeItems.map((item) => [item.id, item]))
  let changed = 0
  afterItems.forEach((after) => {
    const before = beforeMap.get(after.id)
    if (!before || JSON.stringify(before) !== JSON.stringify(after)) changed += 1
  })
  beforeItems.forEach((before) => {
    if (!afterItems.some((after) => after.id === before.id)) changed += 1
  })
  return changed
}

export function diffBundles(before: JointBundle, after: JointBundle): ChangeCounts {
  return {
    members: countChanged(before.members, after.members),
    steps: countChanged(before.steps, after.steps),
    diagrams: countChanged(before.diagrams, after.diagrams),
    furniture: countChanged(before.furniture, after.furniture),
    joint: JSON.stringify(stripMeta(before.joint)) === JSON.stringify(stripMeta(after.joint)) ? 0 : 1,
  }
}

export function hasChanges(counts: ChangeCounts): boolean {
  return Object.values(counts).some((value) => value > 0)
}

export function describeChanges(counts: ChangeCounts): string {
  const segments: string[] = []
  if (counts.members > 0) segments.push(`构件尺寸 ${counts.members}`)
  if (counts.steps > 0) segments.push(`步序 ${counts.steps}`)
  if (counts.diagrams > 0) segments.push(`示意图 ${counts.diagrams}`)
  if (counts.furniture > 0) segments.push(`家具说明 ${counts.furniture}`)
  if (counts.joint > 0) segments.push('榫卯属性 1')
  return segments.length > 0 ? segments.join('，') : '无实质改动'
}
