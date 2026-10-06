import { useEffect, useState } from 'react'
import type { CatalogVersion } from '../../types/proof'
import { listVersions, restoreVersion } from '../../utils/proofService'
import { useProofStore } from '../../stores/proofStore'

interface VersionHistoryProps {
  jointTypeId: string
  refreshKey: number
  onRestored: () => void
}

export function VersionHistory({ jointTypeId, refreshKey, onRestored }: VersionHistoryProps) {
  const [versions, setVersions] = useState<CatalogVersion[]>([])
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const busy = useProofStore((state) => state.busy)
  const loadDrafts = useProofStore((state) => state.loadDrafts)

  useEffect(() => {
    let active = true
    void listVersions(jointTypeId).then((items) => {
      if (active) setVersions(items)
    })
    return () => {
      active = false
    }
  }, [jointTypeId, refreshKey])

  const handleRestore = async (version: CatalogVersion) => {
    setMessage(null)
    const result = await restoreVersion(version.id)
    if (!result) return
    const items = await listVersions(jointTypeId)
    setVersions(items)
    setMessage({
      ok: result.status === 'restored',
      text: result.message,
    })
    // 恢复会改变正式当前版本，刷新草稿箱基线展示，避免旧草稿误用
    await loadDrafts()
    onRestored()
  }

  if (versions.length === 0) {
    return (
      <section className="panel p-5">
        <h2 className="text-base font-semibold text-wood-900">版本摘要</h2>
        <p className="mt-2 text-xs text-stone-500">
          该榫卯尚无校样台提交记录（正式图鉴当前内容视作未归档基线）。首次提交后在此留版本摘要。
        </p>
      </section>
    )
  }

  const latest = versions.reduce((max, item) => Math.max(max, item.version), 0)

  return (
    <section className="panel p-5" aria-label="版本历史">
      <h2 className="text-base font-semibold text-wood-900">版本摘要 · 可回看 / 恢复</h2>
      <p className="mt-1 text-xs text-stone-500">
        恢复前自动重核断链闸门；若正式已有新版本，冲突以正式版本为准，改为据旧版本生成校样草稿。
      </p>
      {message ? (
        <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${message.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
          {message.text}
        </p>
      ) : null}
      <ol className="mt-4 space-y-3">
        {versions.map((version) => (
          <li key={version.id} className="rounded-xl border border-stone-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <strong className="text-sm text-wood-900">{version.label}</strong>
                {version.version === latest ? (
                  <span className="rounded-full bg-wood-700 px-2 py-0.5 text-[10px] text-white">正式当前</span>
                ) : null}
                {version.restoredFromVersion ? (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600">
                    恢复自 v{version.restoredFromVersion}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="secondary-button !px-2.5 !py-1 text-xs"
                disabled={busy}
                onClick={() => void handleRestore(version)}
              >
                {version.version === latest ? '重核并留恢复版本' : '回看/恢复'}
              </button>
            </div>
            <p className="mt-2 text-xs text-stone-600">{version.summary}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-stone-400">
              <span>构件 {version.changeCounts.members}</span>
              <span>步序 {version.changeCounts.steps}</span>
              <span>示意图 {version.changeCounts.diagrams}</span>
              <span>家具 {version.changeCounts.furniture}</span>
              <span>校验和 {version.checksum}</span>
              <span>{new Date(version.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
