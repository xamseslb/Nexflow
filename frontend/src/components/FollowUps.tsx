import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Clock3, Loader2, Plus, X } from 'lucide-react'
import { request, type Lead } from '@/lib/api'
import { Button } from '@/components/ui/button'

type Task = { id: string; lead_id: string; title: string; note: string; due_at: string; status: 'open' | 'done' | 'cancelled'; overdue: boolean }
type Page = { items: Task[]; has_more: boolean; offset: number; truncated?: boolean }
const date = (value: string) => new Intl.DateTimeFormat('nb-NO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))

export function FollowUps({ projectId, demo, leads, onLead }: { projectId: string; demo: boolean; leads: Lead[]; onLead: (lead: Lead) => void }) {
  const [status, setStatus] = useState('open')
  const [overdue, setOverdue] = useState(false)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<Page>({ items: [], has_more: false, offset: 0 })
  const [demoTasks, setDemoTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const idempotencyKey = useRef(crypto.randomUUID())
  const root = `/projects/${projectId}/follow-ups`
  useEffect(() => {
    let cancelled = false
    setError('')
    if (demo) {
      const items = demoTasks.map(task => ({ ...task, overdue: task.status === 'open' && new Date(task.due_at) < new Date() })).filter(task => (status === 'all' || task.status === status) && (!overdue || task.overdue)).sort((a, b) => a.due_at.localeCompare(b.due_at))
      setPage({ items: items.slice(offset, offset + 50), has_more: items.length > offset + 50, offset }); return
    }
    setLoading(true)
    request<Page>(`${root}?${new URLSearchParams({ status, overdue: String(overdue), offset: String(offset) })}`).then(data => !cancelled && setPage(data)).catch(e => !cancelled && setError(e.message)).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [root, demo, status, overdue, offset, version, demoTasks])
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget, data = new FormData(form)
    setBusy(true); setError('')
    try {
      const body = { lead_id: String(data.get('lead')), title: String(data.get('title')).trim(), note: String(data.get('note')).trim(), due_at: new Date(String(data.get('due'))).toISOString(), idempotency_key: idempotencyKey.current }
      if (!body.title) throw new Error('Skriv en tittel for oppgaven')
      if (new Date(body.due_at) <= new Date()) throw new Error('Velg et fremtidig tidspunkt for oppfølging')
      if (demo) setDemoTasks(tasks => [...tasks, { ...body, id: crypto.randomUUID(), status: 'open', overdue: false }])
      else await request(root, { method: 'POST', body: JSON.stringify(body) })
      form.reset(); idempotencyKey.current = crypto.randomUUID(); setStatus('open'); setOffset(0); setOverdue(false); setVersion(v => v + 1)
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke opprette oppgaven') } finally { setBusy(false) }
  }
  async function openLead(task: Task) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const lead = leads.find(l => l.id === task.lead_id) || await request<Lead>(`/projects/${projectId}/leads/${task.lead_id}`)
      onLead(lead)
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke hente leadet') } finally { setBusy(false) }
  }
  async function complete(task: Task, next: 'done' | 'cancelled') {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (demo) setDemoTasks(tasks => tasks.map(t => t.id === task.id ? { ...t, status: next, overdue: false } : t))
      else await request(`${root}/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) })
      setVersion(v => v + 1)
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke oppdatere oppgaven') } finally { setBusy(false) }
  }
  return <div className="follow-up-layout">
    <section className="panel task-queue"><div className="panel-heading"><div><h2>Oppfølgingskø</h2><p>{demo ? 'Oppgaver i denne demoøkten. Nullstilles når du forlater siden.' : 'Egne oppgaver. Ledere ser hele prosjektets kø.'}</p></div><Clock3 size={19} /></div>
      <div className="task-filters"><label>Status<select aria-label="Oppgavestatus" value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}>{[['open', 'Åpne'], ['done', 'Fullført'], ['cancelled', 'Avbrutt'], ['all', 'Alle']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={overdue} onChange={e => { setOverdue(e.target.checked); setOffset(0) }} />Kun forfalte</label></div>
      {error && <div className="task-error" role="alert">{error}<Button variant="outline" size="sm" onClick={() => setVersion(v => v + 1)}>Prøv igjen</Button></div>}
      {loading ? <div className="empty-state"><Loader2 className="animate-spin" /><p>Henter oppgaver…</p></div> : page.items.length ? <ul className="task-list">{page.items.map(task => {
        const lead = leads.find(l => l.id === task.lead_id)
        return <li key={task.id}><div className="task-title"><strong>{task.title}</strong><span className={task.overdue ? 'task-overdue' : 'muted'}>{task.status === 'done' ? 'Fullført' : task.status === 'cancelled' ? 'Avbrutt' : task.overdue ? 'Forfalt' : 'Planlagt'}</span></div><button className="text-link" disabled={busy} onClick={() => openLead(task)}>{lead?.company || 'Åpne tilknyttet lead'}</button><p className="task-due">{date(task.due_at)}</p>{task.note && <p className="task-note">{task.note}</p>}{task.status === 'open' && <div className="task-actions"><Button size="sm" variant="outline" disabled={busy} onClick={() => complete(task, 'done')}><Check />Fullfør</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => complete(task, 'cancelled')}><X />Avbryt</Button></div>}</li>
      })}</ul> : <div className="empty-state"><Check /><h3>Ingen oppgaver i denne visningen</h3><p>Opprett en oppfølging eller endre filteret.</p></div>}
      {page.truncated && <p className="report-footnote">Visningen er begrenset til 10 000 oppgaver. Bruk status- og forfallsfilter for å snevre inn.</p>}
      <div className="task-pagination"><Button size="sm" variant="outline" disabled={loading || offset === 0} onClick={() => setOffset(n => Math.max(0, n - 50))}>Forrige</Button><span>Side {offset / 50 + 1}</span><Button size="sm" variant="outline" disabled={loading || !page.has_more} onClick={() => setOffset(n => n + 50)}>Neste</Button></div>
    </section>
    <section className="panel report-panel task-create"><h2>Ny oppfølging</h2><p>Oppgaven tildeles deg. Påminnelser vises i køen; e-post og push sendes ikke.</p><form className="form-stack" onSubmit={create} onChange={() => { idempotencyKey.current = crypto.randomUUID() }}><label>Lead<select name="lead" required disabled={busy}><option value="">Velg lead</option>{leads.filter(l => !['sold', 'declined'].includes(l.status)).map(lead => <option key={lead.id} value={lead.id}>{lead.company}</option>)}</select></label><label>Oppgave<input name="title" required maxLength={200} placeholder="Følg opp tilbud" disabled={busy} /></label><label>Forfallsdato<input name="due" required type="datetime-local" disabled={busy} /></label><label>Notat<input name="note" maxLength={4000} placeholder="Hva skal følges opp?" disabled={busy} /></label><Button disabled={busy || !leads.some(l => !['sold', 'declined'].includes(l.status))}><Plus />Opprett oppfølging</Button></form></section>
  </div>
}

export function LeadActivity({ projectId, leadId, demo }: { projectId: string; leadId: string; demo: boolean }) {
  const [items, setItems] = useState<{ id: string; action: string; created_at: string }[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [offset, setOffset] = useState(0)
  const actions: Record<string, string> = { 'lead.created': 'Lead opprettet', 'lead.reserved': 'Lead reservert', 'lead.released': 'Reservasjon frigitt', 'call.authorized': 'Samtale autorisert', 'call.completed': 'Samtaleutfall registrert', 'sale.registered': 'Salg registrert', 'sale.approved': 'Salg godkjent', 'meeting.booked': 'Møte booket', 'follow_up.created': 'Oppfølging opprettet', 'follow_up.done': 'Oppfølging fullført', 'follow_up.cancelled': 'Oppfølging avbrutt' }
  useEffect(() => {
    if (demo) { setLoading(false); return }
    let cancelled = false
    setLoading(true); setError('')
    request<{ items: typeof items; has_more: boolean; truncated?: boolean }>(`/projects/${projectId}/leads/${leadId}/activity?offset=${offset}`).then(data => { if (!cancelled) { setItems(data.items); setHasMore(data.has_more); setTruncated(Boolean(data.truncated)) } }).catch(e => !cancelled && setError(e.message)).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [projectId, leadId, demo, offset])
  return <section className="lead-activity"><h3>Aktivitetshistorikk</h3>{demo ? <p>Historikk fra serveren vises når prosjektet er tilkoblet. Demoen oppretter ingen journalposter.</p> : error ? <p role="alert">{error}</p> : loading ? <p>Henter historikk…</p> : <><ol>{items.map(item => <li key={item.id}><span>{actions[item.action] || 'Prosjektaktivitet registrert'}</span><time dateTime={item.created_at}>{date(item.created_at)}</time></li>)}</ol>{!items.length && <p>Ingen aktivitet registrert.</p>}{truncated && <p className="report-footnote">Tidslinjen har nådd visningsgrensen på 10 000 poster.</p>}{(offset > 0 || hasMore) && <div className="task-pagination"><Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 30))}>Nyere</Button><Button size="sm" variant="outline" disabled={!hasMore} onClick={() => setOffset(n => n + 30)}>Eldre</Button></div>}</>}</section>
}
