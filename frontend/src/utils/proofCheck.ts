import type { HitArea } from '../types/diagram'
import type { JointBundle } from '../types/proof'

export type CheckSeverity = 'error' | 'warning'

export interface CheckIssue {
  id: string
  severity: CheckSeverity
  category: 'step-binding' | 'hit-area' | 'furniture-ref' | 'sequence' | 'tolerance'
  message: string
  /** 可一键修复时给出动作键 */
  fix?: 'bind-step-diagram' | 'resequence'
}

export interface ProofCheckResult {
  issues: CheckIssue[]
  errors: CheckIssue[]
  warnings: CheckIssue[]
  blocked: boolean
  checkedAt: string
}

/** 解析 SVG 中真实存在的热区（data-member-id），热区必须回链到草稿里现有的构件 */
export function parseSvgMemberRefs(svgMarkup: string): string[] {
  if (!svgMarkup) return []
  const documentNode = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml')
  return Array.from(documentNode.querySelectorAll('g[data-member-id]'))
    .map((group) => group.getAttribute('data-member-id') ?? '')
    .filter((memberId) => memberId.length > 0)
}

export function runProofCheck(bundle: JointBundle): ProofCheckResult {
  const issues: CheckIssue[] = []
  const memberIds = new Set(bundle.members.map((member) => member.id))
  const stepIds = new Set(bundle.steps.map((step) => step.id))

  // 闸门一：每步步序都必须绑定一张示意图，且示意图绑定的步序真实存在
  const boundStepIds = new Set<string>()
  bundle.diagrams.forEach((diagram) => {
    if (diagram.stepId && stepIds.has(diagram.stepId)) {
      boundStepIds.add(diagram.stepId)
    }
  })
  bundle.steps.forEach((step) => {
    if (!boundStepIds.has(step.id)) {
      issues.push({
        id: `step-unbound:${step.id}`,
        severity: 'error',
        category: 'step-binding',
        message: `第 ${step.seq} 步（${step.action}·${step.direction}）未绑定示意图，提交后正式图鉴将缺图`,
        fix: 'bind-step-diagram',
      })
    }
  })
  bundle.diagrams.forEach((diagram) => {
    if (!diagram.stepId || !stepIds.has(diagram.stepId)) {
      issues.push({
        id: `diagram-orphan:${diagram.id}`,
        severity: 'error',
        category: 'step-binding',
        message: `示意图《${diagram.title}》绑定的步序已不存在（断链）`,
      })
    }
  })

  // 闸门二：热区回现有构件 —— SVG 内联引用与登记热区都要回链到现有构件
  bundle.diagrams.forEach((diagram) => {
    const svgRefs = parseSvgMemberRefs(diagram.svgMarkup)
    if (svgRefs.length === 0) {
      issues.push({
        id: `diagram-no-hit:${diagram.id}`,
        severity: 'error',
        category: 'hit-area',
        message: `示意图《${diagram.title}》没有任何热区，无法回链构件`,
      })
    }
    svgRefs.forEach((memberId) => {
      if (!memberIds.has(memberId)) {
        issues.push({
          id: `hit-broken:${diagram.id}:${memberId}`,
          severity: 'error',
          category: 'hit-area',
          message: `示意图《${diagram.title}》热区指向已删除构件 ${memberId}（断链）`,
        })
      }
    })
    const verifyArea = (area: HitArea) => {
      if (!memberIds.has(area.memberId)) {
        issues.push({
          id: `hit-record-broken:${diagram.id}:${area.id}`,
          severity: 'error',
          category: 'hit-area',
          message: `示意图《${diagram.title}》登记热区「${area.label}」指向已删除构件（断链）`,
        })
      }
    }
    diagram.hitAreas.forEach(verifyArea)
  })

  // 闸门三：家具说明引用成立 —— 归属榫卯即当前草稿，且 memberId 指向现有构件
  bundle.furniture.forEach((item) => {
    if (item.jointTypeId !== bundle.joint.id) {
      issues.push({
        id: `furniture-joint:${item.id}`,
        severity: 'error',
        category: 'furniture-ref',
        message: `家具《${item.name}》的榫卯归属引用不成立（断链）`,
      })
    }
    if (!item.memberId || !memberIds.has(item.memberId)) {
      issues.push({
        id: `furniture-member:${item.id}`,
        severity: 'error',
        category: 'furniture-ref',
        message: `家具《${item.name}》的说明引用了不存在的关键构件（断链）`,
      })
    }
    if (!item.position.trim() || !item.loadNote.trim()) {
      issues.push({
        id: `furniture-text:${item.id}`,
        severity: 'warning',
        category: 'furniture-ref',
        message: `家具《${item.name}》的部位或承力说明为空`,
      })
    }
  })

  // 步序序号应连续
  const ordered = [...bundle.steps].sort((a, b) => a.seq - b.seq)
  const gap = ordered.findIndex((step, index) => step.seq !== index + 1)
  if (gap >= 0) {
    issues.push({
      id: 'sequence-gap',
      severity: 'warning',
      category: 'sequence',
      message: '步序序号不连续，正式图鉴轨道会出现空位',
      fix: 'resequence',
    })
  }

  // 公差带提示（不拦截）
  bundle.members.forEach((member) => {
    if (member.toleranceMm < 0.1 || member.toleranceMm > 0.25) {
      issues.push({
        id: `tolerance-band:${member.id}`,
        severity: 'warning',
        category: 'tolerance',
        message: `构件「${member.name}」登记公差 ±${member.toleranceMm} mm 偏离干装推荐带 0.10–0.25 mm`,
      })
    }
  })

  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  return {
    issues,
    errors,
    warnings,
    blocked: errors.length > 0,
    checkedAt: new Date().toISOString(),
  }
}
