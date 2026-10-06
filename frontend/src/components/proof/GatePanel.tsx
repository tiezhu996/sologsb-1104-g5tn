import { useMemo } from 'react'
import type { ProofDraft } from '../../types/proof'
import { runProofCheck } from '../../utils/proofCheck'

interface GatePanelProps {
  draft: ProofDraft
  onAutoBind: () => void
  onResequence: () => void
}

const categoryLabels: Record<string, string> = {
  'step-binding': '步序绑图',
  'hit-area': '热区回链',
  'furniture-ref': '家具引用',
  sequence: '步序序号',
  tolerance: '公差带',
}

export function GatePanel({ draft, onAutoBind, onResequence }: GatePanelProps) {
  const result = useMemo(() => runProofCheck(draft.bundle), [draft.bundle])

  return (
    <section className="panel p-5" aria-label="提交闸门">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-wood-900">提交核对 · 断链整批拦截</h2>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            三道闸门：步序有绑图、热区回现有构件、家具说明引用成立。任一断链，半批也不进正式图鉴。
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
          result.blocked ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'
        }`}>
          {result.blocked ? `拦截 · ${result.errors.length} 处断链` : '闸门通过'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <GateCounter
          title="步序绑图"
          ok={!result.issues.some((issue) => issue.category === 'step-binding' && issue.severity === 'error')}
          detail={`${draft.bundle.steps.length} 步 / ${new Set(draft.bundle.diagrams.map((d) => d.stepId).filter(Boolean)).size} 张绑图`}
        />
        <GateCounter
          title="热区回链"
          ok={!result.issues.some((issue) => issue.category === 'hit-area')}
          detail={`${draft.bundle.diagrams.length} 张示意图`}
        />
        <GateCounter
          title="家具引用"
          ok={!result.issues.some((issue) => issue.category === 'furniture-ref' && issue.severity === 'error')}
          detail={`${draft.bundle.furniture.length} 条说明`}
        />
      </div>

      {result.issues.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {result.issues.map((issue) => (
            <li
              key={issue.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
                issue.severity === 'error'
                  ? 'border-rose-200 bg-rose-50/60 text-rose-900'
                  : 'border-amber-200 bg-amber-50/60 text-amber-900'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  issue.severity === 'error' ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white'
                }`}>
                  {issue.severity === 'error' ? '断链' : '提醒'}
                </span>
                <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] text-stone-500">
                  {categoryLabels[issue.category]}
                </span>
                {issue.message}
              </span>
              {issue.fix === 'bind-step-diagram' ? (
                <button type="button" className="secondary-button !px-2.5 !py-1 text-xs" onClick={onAutoBind}>
                  一键生成绑图
                </button>
              ) : null}
              {issue.fix === 'resequence' ? (
                <button type="button" className="secondary-button !px-2.5 !py-1 text-xs" onClick={onResequence}>
                  重排序号
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          四类内容引用全部闭合，提交时会在事务内再核一次。
        </p>
      )}
    </section>
  )
}

function GateCounter({ title, ok, detail }: { title: string; ok: boolean; detail: string }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50'}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-stone-800">
        <span aria-hidden="true">{ok ? '✓' : '✕'}</span>
        {title}
      </div>
      <p className="mt-1 text-[11px] text-stone-500">{detail}</p>
    </div>
  )
}
