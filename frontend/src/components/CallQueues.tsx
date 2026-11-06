import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, ChevronRight, CircleCheck, CornerUpLeft, Flame, ListFilter, MapPin, Phone, Plus, RotateCcw, Search, Settings2, Snowflake, UserRound, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { CallHistory, type CallEntry } from '@/components/CallHistory'
import type { Lead, Project } from '@/lib/api'
import { categories, DemoQueues, projectQueues, type CallList, type CallResult, type Category, type Member, type NewList, type QueueLead } from '@/lib/callQueues'
import './callQueues.css'

const icons = { hot: Flame, cold: Snowflake, winback: RotateCcw }
const outcomes = { answered: 'Svar', no_answer: 'Ikke svar', callback: 'Ring tilbake', declined: 'Ikke aktuell', meeting: 'Møte', sale: 'Salg' }
const categoryDetails = { hot: 'Vist interesse', cold: 'Første kontakt', winback: 'Tidligere kunder og leads' }

type Props = {
  project: Project
  leads: QueueLead[]
  demo: boolean
  onRefresh: () => Promise<void>
  onDisposition?: (lead: Lead, kind: 'sale' | 'meeting') => void
  dispositionOpen?: boolean
  demoHistory?: Record<string, CallEntry[]>
  onDemoCall?: (leadId: string, entry: CallEntry, callbackAt: string | null) => void
}
type Session = { list: CallList; lead: Lead | null; callId: string | null; completed: number }
type Editor = { kind: 'create' } | { kind: 'manage'; list: CallList }
const getMemberName = (member: Member) => member.name?.trim() || member.id

function CategoryMark({ category }: { category: Category }) {
  const Icon = icons[category]
  return <span className={`cq-mark cq-${category}`} aria-hidden="true"><Icon size={23} /></span>
}

function CategoryTag({ category }: { category: Category }) {
  const Icon = icons[category]
  return <span className={`cq-tag cq-${category}`}><Icon size={14} aria-hidden="true" />{categories[category]}</span>
}

export function CallQueues({ project, leads, demo, onRefresh, demoHistory, onDemoCall, onDisposition, dispositionOpen = false }: Props) {
  const manager = ['admin', 'leader'].includes(project.role)
  const service = useMemo(() => projectQueues(project.id), [project.id])
  const [example] = useState(() => new DemoQueues(project))
  const [lists, setLists] = useState<CallList[]>([])
  const [team, setTeam] = useState<Member[]>([])
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const alive = useRef(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [disposition, setDisposition] = useState<{ lead: Lead; kind: 'meeting' | 'sale' } | null>(null)
  const resume = useRef<Pick<Session, 'list' | 'completed'> | null>(null)
  const contactHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (session?.lead) contactHeading.current?.focus() }, [session?.lead?.id])
  const [discard, setDiscard] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const canWork = project.active && (demo || online)
  const load = useCallback(async () => {
    const [rows, members] = await Promise.all([
      demo ? example.snapshot() : service.lists(),
      !manager ? [] : demo ? example.team : service.team()
    ])
    if (!alive.current) return
    setLists(rows)
    setTeam(members.filter(member => ['seller', 'booker', 'closer', 'leader', 'admin'].includes(member.role)))
  }, [demo, example, manager, service])
  useEffect(() => {
    alive.current = true
    let cancelled = false
    load().catch(e => { if (!cancelled) setError(e.message) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; alive.current = false }
  }, [load])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  async function action(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try { await work() } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Kunne ikke fullføre handlingen.')
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function next(list: CallList, completed: number) {
    const lead = demo ? example.next(list.id, leads) : await service.next(list.id)
    if (alive.current) setSession({ list, lead, completed, callId: null })
  }
  useEffect(() => {
    if (dispositionOpen || !resume.current) return
    const pending = resume.current
    resume.current = null
    setSession({ ...pending, lead: null, callId: null })
    void action(() => next(pending.list, pending.completed))
  }, [dispositionOpen])

  function openDisposition() {
    if (!session || !disposition || !onDisposition || session.callId) return
    void action(async () => {
      if (session.lead && !demo) await service.release(session.lead.id)
      if (!alive.current) return
      resume.current = { list: session.list, completed: session.completed }
      setSession(null)
      setDisposition(null)
      onDisposition(disposition.lead, disposition.kind)
    })
  }
  function start(list: CallList) {
    setDisposition(null)
    setDiscard(false)
    void action(() => next(list, 0))
  }
  function authorize() {
    if (!session?.lead) return
    const lead = session.lead
    void action(async () => {
      const call = demo ? { id: crypto.randomUUID(), phone: '' } : await service.authorize(lead.id)
      if (!alive.current) return
      setDisposition(null)
      setSession({ ...session, callId: call.id })
      if (!demo && /^\+[1-9]\d{7,14}$/.test(call.phone)) window.location.href = `tel:${call.phone}`
    })
  }
  function finish(result: CallResult) {
    if (!session?.callId || !session.lead) return
    const { lead, callId, completed, list } = session
    void action(async () => {
      if (demo) {
        const entry = example.finish(lead.id, result)
        onDemoCall?.(lead.id, entry, result.callback_at)
      }
      else await service.finish(callId, lead.id, result)
      if (!alive.current) return
      setDiscard(false)
      setSession({ list, lead: null, completed: completed + 1, callId: null })
      setMessage('Samtaleutfallet er lagret.')
      if (result.outcome === 'meeting' || (result.outcome === 'sale' && project.role !== 'booker')) {
        setDisposition({ lead, kind: result.outcome })
      }
      await next(list, completed + 1)
      await onRefresh()
    })
  }
  function closeSession(force = false) {
    if (!session || lock.current) return
    if (session.callId && !force) { setDiscard(true); return }
    void action(async () => {
      if (session.lead && !demo) {
        try { await service.release(session.lead.id) }
        catch { setMessage('Ringekøen er lukket. En eventuell reservasjon utløper automatisk.') }
      }
      setSession(null); setDiscard(false); setDisposition(null)
    })
  }
  function update(work: () => Promise<unknown> | void, notice: string) {
    void action(async () => {
      await work()
      setEditor(null); setMessage(notice)
      await load()
      if (!demo) await onRefresh()
    })
  }
  function create(input: NewList) {
    update(() => demo ? example.create(input) : service.create(input), 'Ringelisten er opprettet.')
  }
  const shown = lists.filter(list => filter === 'all' || list.category === filter)
  const memberName = (id: string | null) => !id ? 'Ikke tildelt' : !manager ? 'Tildelt deg' : team.find(member => member.id === id)?.name || id
  const alerts = <>{error && <p role="alert" className="cq-alert">{error}</p>}{message && <p role="status" className="cq-message">{message}</p>}</>

  return <section className="cq-shell" aria-label="Ringekøer">
    <header className="cq-toolbar">
      <div className="cq-filters" aria-label="Filtrer ringelister">{(['all', 'hot', 'cold', 'winback'] as const).map(value =>
        <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'Alle lister' : categories[value]}</button>)}</div>
      {manager && <Button disabled={busy || !canWork} onClick={() => { setError(''); setMessage(''); setEditor({ kind: 'create' }) }}><Plus />Ny ringeliste</Button>}
    </header>
    {!session && !editor && alerts}
    {!project.active && <p className="cq-alert">Prosjektet er satt på pause.</p>}
    {!online && !demo && <p className="cq-alert">Du trenger nettforbindelse for å arbeide i ringekøen.</p>}
    {loading ? <p className="cq-empty">Henter ringelister…</p> :
      shown.length ? <div className="cq-directory">{shown.map(list => <article key={list.id} className="cq-row">
        <CategoryMark category={list.category} />
        <div className="cq-title"><CategoryTag category={list.category} /><h2>{list.name}</h2></div>
        <span className="cq-meta"><UsersRound />{list.lead_count} {list.lead_count === 1 ? 'kontakt' : 'kontakter'}</span>
        <span className="cq-meta"><UserRound />{memberName(list.assignee_id)}</span>
        <div className="cq-actions">{manager && <Button size="icon" variant="outline" aria-label={`Administrer ${list.name}`} disabled={busy || !canWork} onClick={() => { setError(''); setMessage(''); setEditor({ kind: 'manage', list }) }}><Settings2 /></Button>}
          <Button variant="outline" disabled={busy || !canWork} aria-label={`Åpne ${list.name}`} onClick={() => start(list)}>Åpne liste<ChevronRight /></Button>
        </div>
      </article>)}</div> : <div className="cq-empty"><ListFilter /><h2>{error ? 'Listene kunne ikke lastes' : 'Ingen ringelister å vise'}</h2>{error ? <Button variant="outline" onClick={() => action(load)}>Prøv igjen</Button> : <p>{filter !== 'all' ? 'Velg en annen kategori.' : manager ? 'Opprett en liste og fordel kontakter til en selger.' : 'Tildelte lister vises her.'}</p>}</div>}

    {editor && <Dialog open onOpenChange={open => { if (!open && !busy) { setEditor(null); setError('') } }}
      title={editor.kind === 'create' ? 'Ny ringeliste' : editor.list.name}
      description={editor.kind === 'create' ? 'Velg kategori og hvem som skal arbeide med listen.' : 'Tildel listen eller flytt kontakter hit fra prosjektet.'}>
      {alerts}
      {editor.kind === 'create' ? <CreateList team={team} busy={busy} onCreate={create} /> :
        <ManageList list={editor.list} lists={lists} team={team} leads={leads} busy={busy}
          membership={demo ? example.membership : undefined} searchProject={demo ? undefined : service.search}
          onAssign={id => update(() => demo ? example.assign(editor.list.id, id) : service.assign(editor.list.id, id), 'Tildelingen er lagret.')}
          onMove={ids => update(() => demo ? example.move(editor.list, leads.filter(lead => ids.includes(lead.id))) : service.move(editor.list.id, ids), 'Kontaktene er flyttet til listen.')} />}
    </Dialog>}

    {session && <Dialog open onOpenChange={open => { if (!open) closeSession() }} title={session.list.name}
      description={`${categories[session.list.category]} · ${session.completed} ${session.completed === 1 ? 'fullført samtale' : 'fullførte samtaler'} i denne økten`}>
      <div className="cq-session">
        {alerts}
        {disposition && onDisposition && <div className="cq-follow-on"><span>{disposition.lead.company}</span><Button variant="outline" size="sm" disabled={busy || !canWork} onClick={openDisposition}>{disposition.kind === 'meeting' ? 'Book møte' : 'Registrer salg'}<ArrowRight /></Button></div>}
        {discard && <div className="cq-discard"><h3>Avslutte uten å lagre utfallet?</h3><p>Notat og utfall fra denne samtalen blir forkastet.</p>
          <Button onClick={() => setDiscard(false)}>Fortsett samtalen</Button> <Button variant="outline" onClick={() => closeSession(true)}>Forkast og avslutt</Button></div>}
        <div hidden={discard}>{
          session.lead ? <div className={`cq-call-workspace ${session.callId ? 'cq-in-call' : ''}`}><div className="cq-dossier"><div className="cq-contact"><span className="cq-monogram">{session.lead.company.slice(0, 1)}</span><div><h3 ref={contactHeading} tabIndex={-1}>{session.lead.company}</h3><p>{session.lead.contact || 'Ingen kontaktperson'} · {session.lead.kind.toUpperCase()}</p></div></div>
            <div className="cq-contact-meta"><span><Phone />{session.lead.phone}</span>{session.lead.city && <span><MapPin />{session.lead.city}</span>}</div>
            {session.lead.summary && <p className="cq-summary">{session.lead.summary}</p>}
            <CallHistory key={session.lead.id} projectId={project.id} leadId={session.lead.id} manager={manager}
              demoEntries={demo ? demoHistory?.[session.lead.id] || example.history[session.lead.id] || [] : undefined} />
            </div><div className="cq-dial-panel">{session.callId ? <OutcomeForm key={session.callId} busy={busy || !canWork} onFinish={finish} /> :
              <Button disabled={busy || !canWork} onClick={authorize}><Phone />{demo ? 'Simuler oppringing' : 'Ring kontakt'}</Button>}</div>
          </div> : <div className="cq-empty"><CircleCheck /><h3>{error ? 'Neste kontakt er ikke hentet' : 'Ingen kontakter klare til å ringes'}</h3><p>Avtalte tilbakekallinger blir tilgjengelige når tidspunktet er nådd.</p>
            <Button variant="outline" disabled={busy || !canWork} onClick={() => action(() => next(session.list, session.completed))}><RotateCcw />Sjekk på nytt</Button></div>}</div>
        {!discard && <button type="button" className="cq-back" disabled={busy} onClick={() => closeSession()}><CornerUpLeft size={15} /> Tilbake til listene</button>}
      </div>
    </Dialog>}
  </section>
}

function CreateList({ team, busy, onCreate }: { team: Member[]; busy: boolean; onCreate: (input: NewList) => void }) {
  const [category, setCategory] = useState<Category>('cold')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const name = String(data.get('name')).trim()
    if (name) onCreate({ name, category, assignee_id: String(data.get('assignee')) || null })
  }
  return <form className="cq-form" onSubmit={submit}><label>Listenavn<input name="name" required maxLength={100} pattern=".*\S.*" autoFocus /></label>
    <fieldset><legend>Kategori</legend><div className="cq-category-options">{(Object.keys(categories) as Category[]).map(value =>
      <label key={value}><input type="radio" name="category" checked={category === value} onChange={() => setCategory(value)} /><CategoryTag category={value} /><small>{categoryDetails[value]}</small></label>
    )}</div></fieldset>
    <label>Ansvarlig selger<select name="assignee"><option value="">Tildel senere</option>{team.map(member => <option key={member.id} value={member.id}>{getMemberName(member)}</option>)}</select></label>
    <Button type="submit" disabled={busy}><Plus />Opprett liste</Button></form>
}

function ManageList({ list, lists, team, leads, membership, searchProject, busy, onAssign, onMove }: {
  list: CallList; lists: CallList[]; team: Member[]; leads: QueueLead[]; membership?: Map<string, string>; busy: boolean
  searchProject?: (query: string, signal: AbortSignal) => Promise<QueueLead[]>
  onAssign: (id: string | null) => void; onMove: (ids: string[]) => void
}) {
  const [assignee, setAssignee] = useState(list.assignee_id || '')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [matches, setMatches] = useState<QueueLead[]>([])
  const [searchError, setSearchError] = useState('')
  const [searching, setSearching] = useState(false)
  const term = search.trim()
  useEffect(() => {
    setSearchError('')
    if (!searchProject || !term) { setSearching(false); return }
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(() => {
      searchProject(term, controller.signal)
        .then(rows => { if (!controller.signal.aborted) setMatches(rows) })
        .catch(() => { if (!controller.signal.aborted) setSearchError('Søket kunne ikke gjennomføres.') })
        .finally(() => { if (!controller.signal.aborted) setSearching(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [term, searchProject])
  const listOf = (lead: QueueLead) => membership ? membership.get(lead.id) : lead.call_list_id
  const filtered = searchProject && term ? matches : leads.filter(l => `${l.company} ${l.contact}`.toLowerCase().includes(search.trim().toLowerCase()))
  return <div className="cq-form">
    <form className="cq-assign" onSubmit={e => { e.preventDefault(); onAssign(assignee || null) }}><label>Ansvarlig selger<select value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Ikke tildelt</option>
      {team.map(member => <option value={member.id} key={member.id}>{getMemberName(member)}</option>)}</select></label>
      <Button variant="outline" type="submit" disabled={busy || assignee === (list.assignee_id || '')}>Lagre tildeling</Button></form>
    <fieldset><legend>Kontakter i prosjektet</legend><label className="cq-search"><Search size={16} /><input aria-label="Søk i prosjektkontakter" placeholder="Søk etter navn eller bedrift" value={search} maxLength={100} onChange={e => setSearch(e.target.value)} /></label>
      {searchError && <p className="cq-alert" role="alert">{searchError}</p>}<div className="cq-choices" aria-busy={searching}>{searching ? <p>Søker…</p> : !searchError && filtered.map(lead => {
        const source = listOf(lead), current = source === list.id
        return <label key={lead.id}><input type="checkbox" checked={current || selected.includes(lead.id)} disabled={busy || current} onChange={e => setSelected(e.target.checked ? [...selected, lead.id] : selected.filter(id => id !== lead.id))} />
          <span><strong>{lead.company}</strong><small>{current ? 'I denne listen' : lists.find(row => row.id === source)?.name || 'Uten ringeliste'}</small></span></label>
      })}{!searching && !searchError && !filtered.length && <p>Ingen kontakter funnet.</p>}{!searching && !searchError && filtered.length === 500 && <p>De første 500 treffene vises. Avgrens søket for å finne flere kontakter.</p>}</div></fieldset>
    <Button disabled={busy || selected.length === 0} onClick={() => onMove(selected)}>Flytt til listen ({selected.length})<ArrowRight /></Button>
  </div>
}

function OutcomeForm({ busy, onFinish }: { busy: boolean; onFinish: (result: CallResult) => void }) {
  const [outcome, setOutcome] = useState<keyof typeof outcomes | null>(null)
  const [note, setNote] = useState('')
  const [time, setTime] = useState('')
  const [error, setError] = useState('')
  function save(e: FormEvent) {
    e.preventDefault()
    if (!outcome) return
    const callback = outcome === 'callback' ? new Date(time) : null
    if (callback && !(callback.getTime() > Date.now())) { setError('Velg et fremtidig tidspunkt.'); return }
    setError('')
    onFinish({ outcome, note: note.trim(), callback_at: callback?.toISOString() || null })
  }
  return <form className="cq-form cq-result" onSubmit={save}><fieldset><legend>Samtaleutfall</legend><div className="cq-outcomes">
    {(Object.keys(outcomes) as (keyof typeof outcomes)[]).map(value => <button type="button" key={value} aria-pressed={outcome === value} onClick={() => setOutcome(value)}>{value === outcome && <Check size={14} />}{outcomes[value]}</button>)}</div></fieldset>
    {(outcome === 'sale' || outcome === 'meeting') && <p>{outcome === 'sale' ? 'Salg med beløp og godkjenning registreres separat.' : 'Møtet trenger også tidspunkt og closer.'}</p>}
    {outcome === 'callback' && <label>Tidspunkt for tilbakekalling<input type="datetime-local" value={time} required onChange={e => setTime(e.target.value)} /></label>}
    <label>Samtalenotat<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={4000} placeholder="Hva avtalte dere?" /></label>
    {error && <p role="alert" className="cq-alert">{error}</p>}
    <Button type="submit" disabled={!outcome || busy}>Lagre og vis neste kontakt<ArrowRight /></Button></form>
}
