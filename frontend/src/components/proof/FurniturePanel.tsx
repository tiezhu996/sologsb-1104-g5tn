import type { FurnitureName } from '../../types/furniture'
import type { ProofDraft } from '../../types/proof'
import { useProofStore } from '../../stores/proofStore'

interface FurniturePanelProps {
  draft: ProofDraft
}

const furnitureNames: FurnitureName[] = ['圈椅', '条案', '架子床', '官帽椅', '方桌', '柜架']

export function FurniturePanel({ draft }: FurniturePanelProps) {
  const updateFurniture = useProofStore((state) => state.updateFurniture)
  const addFurniture = useProofStore((state) => state.addFurniture)
  const removeFurniture = useProofStore((state) => state.removeFurniture)

  const memberMap = new Map(draft.bundle.members.map((member) => [member.id, member]))

  return (
    <section className="panel p-5" aria-label="家具说明编辑">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-wood-900">适用家具说明</h2>
          <p className="mt-1 text-xs text-stone-500">每条说明都要引用一个现有构件作为受力依据，引用断链整批拦截。</p>
        </div>
        <button type="button" className="secondary-button text-xs" onClick={() => void addFurniture()}>新增家具说明</button>
      </header>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {draft.bundle.furniture.map((item) => {
          const memberExists = Boolean(item.memberId && memberMap.has(item.memberId))
          return (
            <article key={item.id} className="rounded-xl border border-stone-200 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-stone-500">家具</span>
                  <select
                    className="input-field mt-1"
                    value={item.name}
                    onChange={(event) => void updateFurniture(item.id, { name: event.target.value as FurnitureName })}
                  >
                    {furnitureNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-stone-500">年代</span>
                  <input
                    className="input-field mt-1"
                    value={item.era}
                    onChange={(event) => void updateFurniture(item.id, { era: event.target.value })}
                  />
                </label>
              </div>
              <label className="mt-3 block">
                <span className="text-xs text-stone-500">使用部位</span>
                <input
                  className="input-field mt-1"
                  value={item.position}
                  onChange={(event) => void updateFurniture(item.id, { position: event.target.value })}
                />
              </label>
              <label className="mt-3 block">
                <span className="text-xs text-stone-500">承力说明</span>
                <textarea
                  className="input-field mt-1"
                  rows={2}
                  value={item.loadNote}
                  onChange={(event) => void updateFurniture(item.id, { loadNote: event.target.value })}
                />
              </label>
              <label className="mt-3 block">
                <span className="text-xs text-stone-500">引用构件</span>
                <select
                  className={`input-field mt-1 ${memberExists ? '' : 'border-rose-300 bg-rose-50'}`}
                  value={memberExists ? item.memberId : ''}
                  onChange={(event) => void updateFurniture(item.id, { memberId: event.target.value })}
                >
                  {!memberExists ? <option value="">断链 · 请重新引用现有构件</option> : null}
                  {draft.bundle.members.map((member) => (
                    <option key={member.id} value={member.id}>{member.name}（{member.part}）</option>
                  ))}
                </select>
              </label>
              <div className="mt-3 flex items-center justify-between">
                <span className={`rounded-full px-2.5 py-1 text-[11px] ${memberExists ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
                  {memberExists ? `引用成立 → ${memberMap.get(item.memberId ?? '')?.name}` : '引用断链'}
                </span>
                <button
                  type="button"
                  className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50"
                  onClick={() => void removeFurniture(item.id)}
                >
                  删除说明
                </button>
              </div>
            </article>
          )
        })}
      </div>
      {draft.bundle.furniture.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-stone-300 p-6 text-sm text-stone-500">
          没有家具说明也可提交，但图鉴将无法反查该榫卯。
        </p>
      ) : null}
    </section>
  )
}
