import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BlankPanel } from '../components/common/BlankPanel'
import { useJointStore } from '../stores/jointStore'
import { useProofStore, isCommitFailureArmed, setCommitFailureArmed } from '../stores/proofStore'
import type { ChangeSummary, ProofDraft } from '../types/proof'

const STATUS_TEXT: Record<ProofDraft['status'], string> = {
  editing: '编辑中',
  submit_failed: '提交失败 · 可继续',
  committed: '已入库',
}

const STATUS_CLASS: Record<ProofDraft['status'], string> = {
  editing: 'bg-amber-50 text-amber-800',
  submit_failed: 'bg-rose-50 text-rose-800',
  committed: 'bg-emerald-50 text-emerald-800',
}

export default function ProofIndex() {
  const joints = useJointStore((state) => state.joints)
  const loadingJoints = useJointStore((state) => state.loading)
  const loadAllJoints = useJointStore((state) => state.loadAll)
  const drafts = useProofStore((state) => state.drafts)
  const versions = useProofStore((state) => state.versions)
  const loadingProof = useProofStore((state) => state.loading)
  const loadProofData = useProofStore((state) => state.loadProofData)
  const createDraft = useProofStore((state) => state.createDraft)
  const removeDraft = useProofStore((state) => state.removeDraft)
  const navigate = useNavigate()
  const [selectedJoint, setSelectedJoint] = useState('')
  const [creating, setCreating] = useState(false)
  const [failureArmed, setFailureArmed] = useState(() => isCommitFailureArmed())

  useEffect(() => {
    void loadAllJoints()
    void loadProofData()
  }, [loadAllJoints, loadProofData])

  const jointNameById = useMemo(() => {
    const map = new Map(joints.map((joint) => [joint.id, joint.name]))
    return (id: string) => map.get(id) ?? '未知榫卯'
  }, [joints])

  const handleCreate = async () => {
    const jointTypeId = selectedJoint || joints[0]?.id
    if (!jointTypeId) return
    setCreating(true)
    try {
      const draft = await createDraft(jointTypeId)
      if (draft) navigate(`/proof/${draft.id}`)
    } finally {
      setCreating(false)
    }
  }

  const toggleFailure = () => {
    const next = !failureArmed
    setFailureArmed(next)
    setCommitFailureArmed(next)
  }

  const draftsSorted = [...drafts].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="space-y-7" data-testid="proof-index">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-[0.24em] text-wood-500">PROOF BENCH</p>
          <h1 className="text-3xl font-bold tracking-tight text-wood-900 sm:text-4xl">拆装校样台</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600">
            从正式榫卯类型建隔离草稿，分别修改构件尺寸、拆装步序、示意图与家具说明；
            提交前整批核对引用，断链整批拦住，通过后原子入库并留存版本。
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-stone-500">选择榫卯类型建草稿</span>
            <select
              className="input-field min-w-44"
              data-testid="proof-source-joint"
              value={selectedJoint}
              onChange={(event) => setSelectedJoint(event.target.value)}
            >
              {joints.map((joint) => (
                <option key={joint.id} value={joint.id}>{joint.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            data-testid="proof-create"
            disabled={creating || joints.length === 0}
            onClick={() => void handleCreate()}
          >
            {creating ? '正在建草稿…' : '从该类型建草稿'}
          </button>
        </div>
      </section>

      <section className="panel flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/70 p-4 text-sm">
        <div>
          <strong className="text-amber-900">故障演练：正式图鉴写失败</strong>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            开启后下一次提交会在写入事务中抛错并整体回滚，用于验证草稿能恢复并继续提交；验证后请关闭。
          </p>
        </div>
        <button
          type="button"
          data-testid="proof-failure-toggle"
          onClick={toggleFailure}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            failureArmed ? 'bg-rose-600 text-white' : 'border border-amber-300 bg-white text-amber-800 hover:bg-amber-100'
          }`}
        >
          {failureArmed ? '故障注入：开启（点击关闭）' : '故障注入：关闭'}
        </button>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4 border-b border-wood-100 pb-3">
          <div>
            <h2 className="text-xl font-semibold text-wood-900">校样草稿</h2>
            <p className="mt-1 text-xs text-stone-500">草稿与正式图鉴隔离，四类内容随时可改、可删除重建。</p>
          </div>
          <span className="text-xs text-wood-700">{draftsSorted.length} 份</span>
        </div>
        {loadingJoints || loadingProof ? (
          <div className="py-12 text-center text-sm text-stone-500">正在读取校样数据…</div>
        ) : draftsSorted.length === 0 ? (
          <BlankPanel title="还没有校样草稿" description="选择一类榫卯，点击“从该类型建草稿”开始校样。" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {draftsSorted.map((draft) => {
              const versionCount = versions.filter((version) => version.jointTypeId === draft.jointTypeId).length
              return (
                <article key={draft.id} className="panel flex flex-col gap-3 p-5" data-testid="proof-draft-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs text-wood-500">{jointNameById(draft.jointTypeId)}</span>
                      <h3 className="mt-1 text-lg font-bold text-wood-900">
                        {draft.jointNameSnapshot} · 校样草稿
                      </h3>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_CLASS[draft.status]}`}>
                      {STATUS_TEXT[draft.status]}
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-stone-500">
                    构件 {draft.content.members.length} · 步序 {draft.content.steps.length} ·
                    示意图 {draft.content.diagrams.length} · 家具 {draft.content.furniture.length}
                    {versionCount > 0 ? ` · 已留版本 ${versionCount}` : ''}
                  </p>
                  {draft.lastError ? (
                    <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800" data-testid="proof-draft-error">
                      上次失败：{draft.lastError}
                    </p>
                  ) : null}
                  {draft.conflicts.length > 0 ? (
                    <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs leading-5 text-stone-600">
                      已按正式版本处理 {draft.conflicts.length} 处冲突。
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center gap-2 pt-2">
                    <Link className="primary-button flex-1 justify-center" to={`/proof/${draft.id}`} data-testid="proof-open">
                      {draft.status === 'committed' ? '回看 / 继续校样' : '继续校样'}
                    </Link>
                    <button
                      type="button"
                      className="secondary-button"
                      data-testid="proof-discard"
                      onClick={() => void removeDraft(draft.id)}
                    >
                      丢弃
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4 border-b border-wood-100 pb-3">
          <div>
            <h2 className="text-xl font-semibold text-wood-900">正式图鉴版本</h2>
            <p className="mt-1 text-xs text-stone-500">每次通过校样并原子入库都会留一份版本摘要，可回看、可恢复。</p>
          </div>
          <span className="text-xs text-wood-700">{versions.length} 个版本</span>
        </div>
        {versions.length === 0 ? (
          <BlankPanel title="尚无正式版本" description="草稿通过整批核对并入库后，会在此留下版本摘要。" />
        ) : (
          <div className="panel divide-y divide-stone-100 overflow-hidden">
            {versions.map((version) => (
              <div key={version.id} className="flex flex-wrap items-center gap-4 px-5 py-4" data-testid="proof-version-row">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-wood-700 text-sm font-semibold text-white">
                  v{version.version}
                </span>
                <div className="min-w-0 flex-1">
                  <strong className="block text-sm text-wood-900">
                    {version.jointNameSnapshot}
                    <span className="ml-2 text-xs font-normal text-stone-500">{version.note}</span>
                  </strong>
                  <span className="mt-1 block text-xs text-stone-500">
                    {new Date(version.committedAt).toLocaleString('zh-CN')} ·
                    新增 {countChanges(version.changeSummary, 'added')} ·
                    修改 {countChanges(version.changeSummary, 'updated')} ·
                    删除 {countChanges(version.changeSummary, 'removed')}
                    {version.conflictsResolved.length > 0 ? ` · 冲突 ${version.conflictsResolved.length} 处以正式为准` : ''}
                  </span>
                </div>
                <Link className="secondary-button" to={`/proof/version/${version.id}`}>回看 / 恢复</Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function countChanges(
  summary: ChangeSummary,
  key: 'added' | 'updated' | 'removed',
): number {
  return (['member', 'step', 'diagram', 'furniture'] as const).reduce(
    (total, kind) => total + summary[kind][key].length,
    0,
  )
}
