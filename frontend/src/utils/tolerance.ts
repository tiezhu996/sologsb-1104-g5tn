import type { DimensionPatch, PairClearance } from '../types/proof'
import type { Member } from '../types/member'
import { roundMeasure } from './measure'

/** 公差随短边尺寸重算：木作干装按短边的千分级取，且不小于 0.1 mm，保留两位小数 */
export function recalcTolerance(dimensions: DimensionPatch, previousTolerance: number): number {
  const shortest = Math.min(
    dimensions.lengthMm ?? Number.POSITIVE_INFINITY,
    dimensions.widthMm ?? Number.POSITIVE_INFINITY,
    dimensions.thicknessMm ?? Number.POSITIVE_INFINITY,
  )
  if (!Number.isFinite(shortest) || shortest <= 0) return previousTolerance
  return roundMeasure(Math.max(0.1, shortest * 0.0028), 2)
}

/** 出榫件 / 受榫件配对间隙，用于提示尺寸变化后受影响的配合项 */
export function derivePairClearances(members: Member[]): PairClearance[] {
  const tenons = members.filter((member) => member.part === '出榫件')
  const sockets = members.filter((member) => member.part === '受榫件')
  if (tenons.length === 0 || sockets.length === 0) return []

  const tenon = tenons.slice().sort((a, b) => a.lengthMm - b.lengthMm)[0]
  const socket = sockets.slice().sort((a, b) => a.lengthMm - b.lengthMm)[0]
  if (!tenon || !socket) return []

  const thicknessGapMm = roundMeasure(socket.thicknessMm - tenon.thicknessMm, 2)
  const widthGapMm = roundMeasure(socket.widthMm - tenon.widthMm, 2)
  const lengthGapMm = roundMeasure(socket.lengthMm - tenon.lengthMm, 2)
  const warnings: string[] = []
  if (thicknessGapMm <= 0) warnings.push('厚向无间隙或已过盈，强行合榫会劈裂受榫件')
  if (thicknessGapMm > 0.6) warnings.push('厚向间隙过大，榫头会晃动')
  if (widthGapMm <= 0) warnings.push('宽向已干涉，需要修配眼口')
  if (widthGapMm > 0.6) warnings.push('宽向间隙偏大，锁齿可能失效')
  if (lengthGapMm < 0) warnings.push('榫眼浅于榫头，肩部无法落位')

  return [{
    pairKey: `${tenon.id}__${socket.id}`,
    tenon,
    socket,
    thicknessGapMm,
    widthGapMm,
    lengthGapMm,
    warnings,
  }]
}

/** 公差带是否落在干装推荐区间 [0.1, 0.25] mm */
export function toleranceBandWarning(member: Member): string | null {
  if (member.toleranceMm < 0.1) return '公差过严，干装容易卡死'
  if (member.toleranceMm > 0.25) return '公差过松，节点会旷动'
  return null
}
