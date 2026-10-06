import { db } from './db'
import type { JointBundle } from '../types/proof'

/** 深拷贝整包，草稿编辑绝不与正式表共享对象引用 */
export function cloneBundle(bundle: JointBundle): JointBundle {
  return {
    joint: { ...bundle.joint },
    members: bundle.members.map((item) => ({ ...item })),
    steps: bundle.steps.map((item) => ({ ...item })),
    diagrams: bundle.diagrams.map((item) => ({
      ...item,
      hitAreas: item.hitAreas.map((area) => ({ ...area })),
    })),
    furniture: bundle.furniture.map((item) => ({ ...item })),
  }
}

/** 规范化排序：校验和只比对内容，不受 IndexedDB 物理返回顺序影响 */
export function canonicalizeBundle(bundle: JointBundle): JointBundle {
  return {
    joint: bundle.joint,
    members: bundle.members.slice().sort((a, b) => a.lengthMm - b.lengthMm || a.id.localeCompare(b.id)),
    steps: bundle.steps.slice().sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id)),
    diagrams: bundle.diagrams.slice().sort((a, b) => a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id)),
    furniture: bundle.furniture.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id)),
  }
}

export async function loadOfficialBundle(jointTypeId: string): Promise<JointBundle | null> {
  const joint = await db.joints.get(jointTypeId)
  if (!joint) return null
  const [members, steps, diagrams, furniture] = await Promise.all([
    db.members.where('jointTypeId').equals(jointTypeId).toArray(),
    db.steps.where('jointTypeId').equals(jointTypeId).toArray(),
    db.diagrams.where('jointTypeId').equals(jointTypeId).toArray(),
    db.furniture.where('jointTypeId').equals(jointTypeId).toArray(),
  ])
  return canonicalizeBundle({ joint, members, steps, diagrams, furniture })
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** 简化 FNV-1a：同结构快照同值，结构一变即变；用于提交时发现正式侧漂移 */
export function checksumBundle(bundle: JointBundle): string {
  const material = stableStringify(bundle)
  let hash = 0x811c9dc5
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
