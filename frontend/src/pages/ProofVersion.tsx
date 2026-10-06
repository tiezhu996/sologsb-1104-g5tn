import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BlankPanel } from '../components/common/BlankPanel'
import { SvgCanvas } from '../components/common/SvgCanvas'
import { useProofStore } from '../stores/proofStore'
import type { ChangeSummary, RestoreResult } from '../types/proof'

export default function ProofVersion() {
  const { id: versionId = '' } = useParams()
  const navigate = useNavigate()
  const versions = useProofStore((state) => state.versions)
  const loadProofData = useProofStore((state) => state.loadProofData)
  const restoreVersion = useProofStore((state) => state.restoreVersion)
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    void loadProofData()
  }, [loadProofData])

  const version = versions.find((item) => item.id === versionId)

  const handleRestore = async () => {
    setRestoring(true)
    try {
      const result = await restoreVersion(versionId)
      setRestoreResult(result)
      if (result.ok && result.draftId) {
        navigate(`/proof/${result.draftId}`)
      }
    } finally {
      setRestoring(false)
    }
  }

  if (!version) {
    return (
      <div className="space-y-6">
        <BackLink />
        <BlankPanel title="未找到该版本" description="版本可能已被清理，请返回校样台查看。" />
      </div>
    )
  }

  const blocking = (restoreResult?.issues ?? []).filter((issue) => issue.severity === 'error')

  return (
    <div className="space-y-6" data-testid="proof-version">
      <BackLink />

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.24em] text-wood-500">FORMAL VERSION</p>
            <h1 className="mt-2 text-2xl font-bold text-wood-900 sm:text-3xl">
              {version.jointNameSnapshot} · 正式版本 v{version.version}
            </h1>
            <p className="mt-2 text-xs text-stone-500">
              {new Date(version.committedAt).toLocaleString('zh-CN')} · {version.note}
            </p>
          </div>
          <button type="button" className="primary-button" data-testid="proof-restore"
            disabled={restoring} onClick={() => void handleRestore()}>
            {restoring ? '恢复前重核中…' : '以此版本恢复为草稿'}
          </button>
        </div>
        <div className="border-t border-wood-100 bg-wood-50/60 px-6 py-4 text-xs leading-6 text-stone-600">
          恢复不会直接覆盖正式图鉴：系统先按当前正式版本重核，冲突一律以正式版本为准，生成一份新草稿再提交。
        </div>
      </section>

      {restoreResult && !restoreResult.ok ? (
        <section className="panel border-rose-200 bg-rose-50/70 p-5" data-testid="proof-restore-blocked">
          <h2 className="text-sm font-semibold text-rose-900">恢复重核未通过，已拦住</h2>
          <p className="mt-1 text-xs text-rose-800">历史快照与当前正式图鉴之间存在断链，已生成草稿需先修复再提交。</p>
          <ul className="mt-3 space-y-1.5">
            {blocking.map((issue, index) => (
              <li key={`${issue.code}-${index}`} className="rounded-md bg-white px-3 py-2 text-xs text-rose-800">{issue.message}</li>
            ))}
          </ul>
          {restoreResult.draftId ? (
            <Link className="secondary-button mt-4" to={`/proof/${restoreResult.draftId}`}>前往草稿修复</Link>
          ) : null}
        </section>
      ) : null}

      {restoreResult?.conflicts.length ? (
        <section className="panel border-stone-200 bg-stone-50 p-5" data-testid="proof-restore-conflicts">
          <h2 className="text-sm font-semibold text-stone-800">恢复重核：{restoreResult.conflicts.length} 处冲突以正式版本为准</h2>
          <ul className="mt-3 space-y-1.5">
            {restoreResult.conflicts.map((conflict) => (
              <li key={`${conflict.kind}-${conflict.id}`} className="rounded-md bg-white px-3 py-2 text-xs text-stone-600">
                {conflict.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ChangeSummaryPanel summary={version.changeSummary} />

      <section className="grid gap-6 xl:grid-cols-2">
        <SnapshotList title={`构件（${version.snapshot.members.length}）`}
          items={version.snapshot.members.map((member) => ({
            id: member.id,
            primary: `${member.name} · ${member.part} · ${member.grainDir}`,
            detail: `长 ${member.lengthMm} / 宽 ${member.widthMm} / 厚 ${member.thicknessMm} mm，公差 ±${member.toleranceMm}`,
          }))} />
        <SnapshotList title={`步序（${version.snapshot.steps.length}）`}
          items={[...version.snapshot.steps].sort((a, b) => a.seq - b.seq).map((step) => ({
            id: step.id,
            primary: `第 ${step.seq} 步 · ${step.action} · ${step.direction} · ${step.tool}`,
            detail: `${step.riskNote}（停留 ${step.holdSec} 秒）`,
          }))} />
        <SnapshotList title={`家具说明（${version.snapshot.furniture.length}）`}
          items={version.snapshot.furniture.map((item) => ({
            id: item.id,
            primary: `${item.name} · ${item.era} · ${item.position}`,
            detail: item.loadNote,
          }))} />
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-wood-900">示意图（{version.snapshot.diagrams.length}）</h2>
          {version.snapshot.diagrams.map((diagram) => (
            <div key={diagram.id} className="overflow-hidden rounded-2xl border border-wood-100 bg-white shadow-sm">
              <div className="border-b border-wood-100 px-4 py-2 text-xs text-stone-500">
                {diagram.title} · {diagram.view}
              </div>
              <SvgCanvas svgMarkup={diagram.svgMarkup} title={diagram.title} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/proof" className="inline-flex items-center gap-1.5 text-sm text-wood-700 hover:underline">
      <span aria-hidden="true">←</span> 返回校样台
    </Link>
  )
}

function ChangeSummaryPanel({ summary }: { summary: ChangeSummary }) {
  const groups: Array<{ label: string; counts: ChangeSummary['member'] }> = [
    { label: '构件', counts: summary.member },
    { label: '步序', counts: summary.step },
    { label: '示意图', counts: summary.diagram },
    { label: '家具说明', counts: summary.furniture },
  ]
  return (
    <section className="panel p-5" data-testid="proof-version-summary">
      <h2 className="text-sm font-semibold text-wood-900">版本变更摘要</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((group) => (
          <div key={group.label} className="rounded-xl border border-wood-100 p-3 text-xs">
            <strong className="block text-sm text-wood-800">{group.label}</strong>
            <p className="mt-1.5 text-emerald-700">新增 {group.counts.added.length}</p>
            <p className="text-amber-700">修改 {group.counts.updated.length}</p>
            <p className="text-rose-700">删除 {group.counts.removed.length}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function SnapshotList({ title, items }: { title: string; items: Array<{ id: string; primary: string; detail: string }> }) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-wood-900">{title}</h2>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-wood-100 px-4 py-6 text-center text-xs text-stone-400">无记录</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-wood-100 bg-white p-3 text-xs">
              <strong className="block text-sm text-wood-900">{item.primary}</strong>
              <span className="mt-1 block leading-5 text-stone-500">{item.detail}</span>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
