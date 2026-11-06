import { useEffect, useState } from 'react'
import { request } from '@/lib/api'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { meetingOutcomeLabel } from './MeetingActions'
import { callOutcomeLabel } from './CallHistory'

export const metricTitles = { leads: 'Leads', calls: 'Fullførte samtaler', meetings: 'Registrerte møter', buyers: 'Kjøpende kunder' }
export type Metric = keyof typeof metricTitles
export type ActivityRow = { id: string; company: string; project: string; detail?: string; sales?: number; date?: string }
type Page = { items: ActivityRow[]; has_more: boolean }

function description(metric: Metric, row: ActivityRow) {
  if (metric === 'buyers') return row.sales === 1 ? '1 registrert salg' : `${row.sales} registrerte salg`
  if (metric === 'meetings') return meetingOutcomeLabel(row.detail || '')
  if (metric === 'calls') return callOutcomeLabel(row.detail || '')
  return row.detail
}

export function PortfolioActivity({ metric, query, demoRows, onClose }: {
  metric: Metric; query: string; demoRows?: ActivityRow[]; onClose: () => void
}) {
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<Page | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (demoRows) return
    const controller = new AbortController()
    const params = new URLSearchParams(query)
    params.set('metric', metric)
    params.set('offset', String(offset))
    setPage(null)
    setError('')
    request<Page>(`/portfolio/sales?${params}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setPage(result) })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [query, metric, offset, attempt, demoRows])

  const data = demoRows ? { items: demoRows.slice(offset, offset + 25), has_more: offset + 25 < demoRows.length } : page
  return <Dialog open onOpenChange={open => { if (!open) onClose() }} title={metricTitles[metric]} description="Poster som inngår i det valgte rapportutvalget.">
    {error ? <div role="alert">{error} <Button variant="outline" onClick={() => setAttempt(n => n + 1)}>Prøv igjen</Button></div> :
      !data ? <p role="status">Henter poster…</p> :
      !data.items.length ? <p className="pf-empty">Ingen {metricTitles[metric].toLowerCase()} i dette utvalget.</p> :
      <ul className="pf-records">{data.items.map(row => <li key={row.id}>
        <strong>{row.company}</strong><span>{row.project}</span>
        <small>{[description(metric, row), row.date && metric !== 'leads' && new Date(row.date).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Oslo' })].filter(Boolean).join(' · ')}</small>
      </li>)}</ul>}
    {(offset > 0 || data?.has_more) && <div className="pf-paging">
      <Button variant="outline" disabled={!offset} onClick={() => setOffset(n => n - 25)}>Forrige</Button>
      <Button variant="outline" disabled={!data?.has_more} onClick={() => setOffset(n => n + 25)}>Neste</Button>
    </div>}
  </Dialog>
}
