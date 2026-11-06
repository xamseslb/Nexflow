import { useEffect, useState } from 'react'
import { request } from '@/lib/api'

export type CallEntry = { id: string; completed_at: string; outcome: string; note: string; can_flag?: boolean }

const outcomes: Record<string, string> = {
  answered: 'Svar', no_answer: 'Ikke svar', callback: 'Ring tilbake',
  meeting: 'Møte', sale: 'Salg', declined: 'Ikke aktuell'
}

export const callOutcomeLabel = (outcome: string) => outcomes[outcome] || outcome

function Entry({ entry }: { entry: CallEntry }) {
  return <div>
    <strong>{callOutcomeLabel(entry.outcome)}</strong>
    {' · '}<time dateTime={entry.completed_at}>{new Date(entry.completed_at).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })}</time>
    <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.note || 'Ingen notater registrert.'}</p>
  </div>
}

export function CallHistory({ projectId, leadId, demoEntries, manager }: {
  projectId: string; leadId: string; demoEntries?: CallEntry[]; manager: boolean
}) {
  const [entries, setEntries] = useState<CallEntry[] | null>(null)
  const [error, setError] = useState('')
  const demo = demoEntries !== undefined
  useEffect(() => {
    if (demo) return
    const controller = new AbortController()
    request<CallEntry[]>(`/projects/${projectId}/leads/${leadId}/call-history`, { signal: controller.signal })
      .then(items => { if (!controller.signal.aborted) setEntries(items) })
      .catch(() => { if (!controller.signal.aborted) setError('Kunne ikke hente samtalehistorikken.') })
    return () => controller.abort()
  }, [demo, projectId, leadId])
  const history = demoEntries ?? entries
  return <section className="lead-activity">
    <h3>{manager || history?.[0]?.can_flag === false ? 'Forrige samtale' : 'Din forrige samtale'}</h3>
    {error ? <p role="alert">{error}</p> : !history ? <p>Henter samtaler…</p> :
      history.length === 0 ? <p>Ingen registrerte samtaler å vise.</p> :
      <><Entry entry={history[0]} />{history.length > 1 &&
        <details><summary>Tidligere samtaler ({history.length - 1})</summary>
          {history.slice(1).map(entry => <Entry key={entry.id} entry={entry} />)}
        </details>}</>}
  </section>
}
