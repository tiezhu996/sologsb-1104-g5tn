import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GatePanel } from '../components/proof/GatePanel'
import { MemberPanel } from '../components/proof/MemberPanel'
import { StepPanel } from '../components/proof/StepPanel'
import { DiagramPanel } from '../components/proof/DiagramPanel'
import { FurniturePanel } from '../components/proof/FurniturePanel'
import { VersionHistory } from '../components/proof/VersionHistory'
import { useJointStore } from '../stores/jointStore'
import { useProofStore, type CommitOutcome } from '../stores/proofStore'
import { loadOfficialBundle } from '../utils/bundle'
import { getChanges } from '../utils/proofService'
import { runProofCheck } from '../utils/proofCheck'
import type { JointBundle } from '../types/proof'

type TabKey = 'members' | 'steps' | 'diagrams' | 'furniture'

const tabs: { key: TabKey; label: string }[] = [
  { key: 'members', label: '构件尺寸' },
  { key: 'steps', label: '拆装步序' },
  { key: 'diagrams', label: '示意图' },
  { key: 'furniture', label: '家具说明' },
]

const statusLabels: Record<string, { label: string; className: string }> = {
  editing: { label: '编辑中', className: 'bg-sky-50 text-sky-800' },
  failed: { label: '提交失败·可继续', className: 'bg-rose-50 text-rose-800' },
  submitted: { label: '已提交', className: 'bg-emerald-50 text-emerald-800' },
  discarded: { label: '已放弃', className: 'bg-stone-100 text-stone-500' },
}

export default function ProofBench() {
  const joints = useJointStore((state) => state.joints)
  const loadAllJoints = useJointStore((state) => state.loadAll)
  const drafts = useProofStore((state) => state.drafts)
  const currentDraftId = useProofStore((state) => state.currentDraftId)
  const loading = useProofStore((state) => state.loading)
  const busy = useProofStore((state) => state.busy)
  const lastOutcome = useProofStore((state) => state.lastOutcome)
  const loadDrafts = useProofStore((state) => state.loadDrafts)
  const openDraft = useProofStore((state) => state.openDraft)
  const startDraft = useProofStore((state) => state.startDraft)
  const dropDraft = useProofStore((state) => state.dropDraft)
  const submit = useProofStore((state) => state.submit)
  const rebaseDraft = useProofStore((state) => state.rebaseDraft)
  const autoBindSteps = useProofStore((state) => state.autoBindSteps)
  const resequence = useProofStore((state) => state.resequence)

  const [tab, setTab] = useState<TabKey>('members')
  const [officialBaseline, setOfficialBaseline] = useState<JointBundle | null>(null)
  const [versionRefresh, setVersionRefresh] = useState(0)
  const [createJointId, setCreateJointId] = useState('')

  useEffect(() => {
    void loadAllJoints()
    void loadDrafts()
  }, [loadAllJoints, loadDrafts])

  const draft = drafts.find((item) => item.id === currentDraftId) ?? null
  const joint = draft ? joints.find((item) => item.id === draft.jointTypeId) : null

  useEffect(() => {
    if (!draft) {
      setOfficialBaseline(null)
      return
    }
    let active = true
    void loadOfficialBundle(draft.jointTypeId).then((bundle) => {
      if (active) setOfficialBaseline(bundle)
    })
    return () => {
      active = false
    }
  }, [draft?.jointTypeId, draft?.status, versionRefresh])

  const gate = useMemo(() => (draft ? runProofCheck(draft.bundle) : null), [draft])
  const changes = useMemo(() => {
    if (!draft || !officialBaseline) return null
    return getChanges(officialBaseline, draft.bundle)
  }, [draft, officialBaseline])

  const handleCreate = async () => {
    if (!createJointId) return
    const id = await startDraft(createJointId)
    await openDraft(id)
    setVersionRefresh((value) => value + 1)
  }

  const handleSubmit = async (simulateFailure: boolean) => {
    const outcome: CommitOutcome = await submit(simulateFailure)
    if (outcome.kind === 'committed') setVersionRefresh((value) => value + 1)
  }

  return (
    <div className="space-y-6" data-testid="proof-bench">
      <header className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs tracking-[0.2em] text-wood-500">PROOFING BENCH</p>
            <h1 className="mt-1 text-2xl font-bold text-wood-900">拆装校样台</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              从榫卯类型建草稿，四类内容（构件尺寸 / 步序 / 示意图 / 家具说明）在沙箱内改完再提交；
              尺寸变化自动重算公差与受影响项，断链整批拦住，半批不进正式图鉴；通过后原子入库留版本摘要，可回看、恢复。
            </p>
          </div>
          <Link to="/joints" className="secondary-button text-xs">返回图鉴（那边直写正式表）</Link>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-wood-100 pt-4">
          <label className="block">
            <span className="text-xs text-stone-500">从榫卯类型建草稿</span>
            <select className="input-field mt-1 min-w-[220px]" value={createJointId} onChange={(event) => setCreateJointId(event.target.value)}>
              <option value="">— 选择榫卯类型 —</option>
              {joints.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.family}）</option>)}
            </select>
          </label>
          <button type="button" className="primary-button" disabled={!createJointId} onClick={() => void handleCreate()}>
            建立校样草稿
          </button>
        </div>
      </header>

      <section className="panel p-4">
        <h2 className="text-sm font-semibold text-wood-900">草稿箱</h2>
        {loading ? (
          <p className="mt-3 text-xs text-stone-500">读取草稿…</p>
        ) : drafts.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-stone-300 p-4 text-xs text-stone-500">
            还没有草稿。正式图鉴的改动不再被直接覆盖，先建草稿校样。
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 lg:grid-cols-2">
            {drafts.map((item) => {
              const itemJoint = joints.find((jointItem) => jointItem.id === item.jointTypeId)
              const status = statusLabels[item.status] ?? statusLabels.editing
              return (
                <li
                  key={item.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                    item.id === currentDraftId ? 'border-wood-500 bg-wood-50' : 'border-stone-200 bg-white'
                  }`}
                >
                  <button type="button" className="min-w-0 text-left" onClick={() => void openDraft(item.id)}>
                    <strong className="block truncate text-sm text-stone-900">{item.label}</strong>
                    <span className="mt-0.5 block text-[11px] text-stone-500">
                      {itemJoint?.name ?? item.jointTypeId} · 基线 v{item.baseVersion} · 更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  </button>
                  <span className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.className}`}>{status.label}</span>
                    <button
                      type="button"
                      className="text-[11px] text-stone-400 hover:text-rose-600"
                      onClick={() => void dropDraft(item.id)}
                    >
                      放弃
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {draft && joint ? (
        <>
          <section className="panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-wood-900">{joint.name} · 草稿校样</h2>
                <p className="mt-1 text-xs text-stone-500">
                  基线 v{draft.baseVersion}（校验和 {draft.baseChecksum}）· 改动实时存入草稿，不触碰正式图鉴
                </p>
              </div>
              {changes ? (
                <span className={`rounded-full px-3 py-1.5 text-xs ${changes.changed ? 'bg-amber-50 text-amber-900' : 'bg-stone-100 text-stone-500'}`}>
                  相对正式当前：{changes.changed ? changes.summary : '无实质改动'}
                </span>
              ) : null}
            </div>
            {draft.status === 'failed' && draft.lastError ? (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                上次提交：{draft.lastError} 草稿内容完整保留，修好后可直接再次提交。
              </p>
            ) : null}
            {lastOutcome ? (
              <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs ${
                lastOutcome.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
              }`}>
                <span>{lastOutcome.message}</span>
                {lastOutcome.kind === 'conflict' ? (
                  <button type="button" className="secondary-button !px-2.5 !py-1 text-xs" onClick={() => void rebaseDraft()}>
                    以正式版本为准重整草稿
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <GatePanel draft={draft} onAutoBind={() => void autoBindSteps()} onResequence={() => void resequence()} />

          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  tab === item.key ? 'bg-wood-700 text-white' : 'border border-wood-100 bg-white text-wood-700 hover:bg-wood-50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'members' ? <MemberPanel draft={draft} /> : null}
          {tab === 'steps' ? <StepPanel draft={draft} /> : null}
          {tab === 'diagrams' ? <DiagramPanel draft={draft} /> : null}
          {tab === 'furniture' ? <FurniturePanel draft={draft} /> : null}

          <section className="panel sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 border-wood-200 bg-white/95 p-4 shadow-lg backdrop-blur">
            <div className="text-xs text-stone-600">
              {gate?.blocked ? (
                <span className="font-semibold text-rose-700">闸门未过：{gate.errors.length} 处断链，提交按钮整批拦下</span>
              ) : (
                <span className="font-semibold text-emerald-700">
                  闸门通过{gate && gate.warnings.length > 0 ? `（${gate.warnings.length} 条提醒不拦截）` : ''}，可原子入库
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="secondary-button text-xs"
                onClick={() => void handleSubmit(true)}
                disabled={busy}
                title="演练正式图鉴写失败：事务整体回滚，草稿保留可继续提交"
              >
                演练写失败/回滚
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleSubmit(false)}
                disabled={busy || Boolean(gate?.blocked) || draft.status === 'submitted'}
              >
                {busy ? '提交中…' : draft.status === 'submitted' ? '该草稿已入库' : '核对并原子提交'}
              </button>
            </div>
          </section>

          <VersionHistory
            jointTypeId={draft.jointTypeId}
            refreshKey={versionRefresh}
            onRestored={() => setVersionRefresh((value) => value + 1)}
          />
        </>
      ) : (
        <section className="panel p-10 text-center text-sm text-stone-500">
          从上方选择榫卯类型建立草稿，或打开草稿箱中的草稿开始四类内容校样。
        </section>
      )}
    </div>
  )
}
