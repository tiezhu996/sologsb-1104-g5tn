import type { Member } from '../../types/member'
import type { ProofDraft } from '../../types/proof'
import { useProofStore } from '../../stores/proofStore'
import { formatDimension } from '../../utils/measure'
import { derivePairClearances, toleranceBandWarning } from '../../utils/tolerance'

interface MemberPanelProps {
  draft: ProofDraft
}

const memberNames: Member['name'][] = ['榫头', '榫眼', '大边', '抹头']

export function MemberPanel({ draft }: MemberPanelProps) {
  const updateMember = useProofStore((state) => state.updateMember)
  const removeMember = useProofStore((state) => state.removeMember)
  const addMember = useProofStore((state) => state.addMember)
  const { members } = draft.bundle
  const pairs = derivePairClearances(members)

  return (
    <section className="panel p-5" aria-label="构件尺寸编辑">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-wood-900">构件尺寸</h2>
          <p className="mt-1 text-xs text-stone-500">
            尺寸变化后自动按短边重算公差（干装 0.28% 短边，且不小于 0.10 mm），并联动受影响的配合与引用复核。
          </p>
        </div>
        <button type="button" className="secondary-button text-xs" onClick={() => void addMember()}>新增构件</button>
      </header>

      <div className="mt-4 space-y-3">
        {members.map((member) => {
          const bandWarning = toleranceBandWarning(member)
          const dirty = draft.dirtyMembers.includes(member.id)
          return (
            <article key={member.id} className="rounded-xl border border-stone-200 p-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
                <label className="block">
                  <span className="text-xs text-stone-500">构件名</span>
                  <select
                    className="input-field mt-1"
                    value={member.name}
                    onChange={(event) => void updateMember(member.id, { name: event.target.value as Member['name'] }, false)}
                  >
                    {memberNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                <NumberInput
                  label="长 mm"
                  value={member.lengthMm}
                  dirty={dirty}
                  onChange={(value) => void updateMember(member.id, { lengthMm: value })}
                />
                <NumberInput
                  label="宽 mm"
                  value={member.widthMm}
                  dirty={dirty}
                  onChange={(value) => void updateMember(member.id, { widthMm: value })}
                />
                <NumberInput
                  label="厚 mm"
                  value={member.thicknessMm}
                  dirty={dirty}
                  onChange={(value) => void updateMember(member.id, { thicknessMm: value })}
                />
                <button
                  type="button"
                  className="rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-700 hover:bg-rose-50"
                  onClick={() => void removeMember(member.id)}
                >
                  删除（造断链）
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-wood-50 px-2.5 py-1 text-wood-700">{member.part}</span>
                <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600">{member.grainDir}</span>
                <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600">
                  重算公差 ±{formatDimension(member.toleranceMm, 'mm', 2)}
                </span>
                {dirty ? <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-800">尺寸已改·受影响</span> : null}
                {bandWarning ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">{bandWarning}</span> : null}
              </div>
            </article>
          )
        })}
      </div>

      {pairs.length > 0 ? (
        <div className="mt-5 rounded-xl border border-wood-100 bg-wood-50/50 p-4">
          <h3 className="text-sm font-semibold text-wood-900">受影响项 · 榫头/榫眼配合间隙</h3>
          {pairs.map((pair) => (
            <div key={pair.pairKey} className="mt-2">
              <p className="text-xs text-stone-600">
                {pair.tenon.name}（出榫）× {pair.socket.name}（受榫）：
                厚向间隙 {pair.thicknessGapMm} mm，宽向间隙 {pair.widthGapMm} mm，深长差 {pair.lengthGapMm} mm
              </p>
              {pair.warnings.length > 0 ? (
                <ul className="mt-1 list-inside list-disc text-xs text-amber-800">
                  {pair.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-emerald-700">配合区间正常，尺寸改动未造成干涉。</p>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function NumberInput({ label, value, onChange, dirty }: { label: string; value: number; onChange: (value: number) => void; dirty?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs text-stone-500">{label}{dirty ? ' · 已改' : ''}</span>
      <input
        type="number"
        min="0"
        step="0.1"
        className="input-field mt-1"
        value={value}
        onChange={(event) => {
          const next = Number.parseFloat(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    </label>
  )
}
