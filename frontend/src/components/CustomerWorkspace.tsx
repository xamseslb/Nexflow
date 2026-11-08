import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Building2, CalendarDays, Check, ChevronRight, ClipboardList, Flag, Phone, Search } from 'lucide-react'
import { type Lead, type Meeting, type Sale, request } from '@/lib/api'
import { money } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import type { CallEntry } from '@/components/CallHistory'
import { meetingOutcomeLabel } from './MeetingActions'
import { BusinessFacts } from './BusinessFacts'
import bouvetExample from '@/lib/bouvet-example.json'
import './customer.css'

type Page<T> = { items: T[]; has_more: boolean }
type ProfileCall = CallEntry & { can_flag?: boolean; flag_status?: 'open' | 'reviewed' | null }
type Profile = {
  lead: Lead; step: number; org_number: string | null; calls: ProfileCall[]
  tasks: { id: string; title: string; due_at: string }[]
  meetings: Pick<Meeting, 'id' | 'starts_at' | 'ends_at' | 'outcome' | 'qualification'>[]
  sales: Pick<Sale, 'id' | 'status' | 'created_at' | 'amount_ore' | 'allocation'>[]
}
type QualityCase = {
  id: string; lead_id: string; company: string; reason: string; created_at: string
  call_note: string; call_outcome: string; reviewed_at: string | null; review_note: string | null
}
export type CustomerTarget = { project: string; lead: string; sales: boolean }
type Props = { target?: CustomerTarget | null;
  demoTasks?: import('./FollowUps').FollowUpTask[]
  projectId: string; demo: boolean; leads: Lead[]; role: string; onLead: (lead: Lead) => void
  sales?: Sale[]; meetings?: Meeting[]; demoCalls?: Record<string, CallEntry[]>; active?: boolean
}

const stageNames = ['Nytt lead', 'Tildelt selger', 'Kontakt planlagt', 'Første samtale', 'Oppfølging', 'Tilbud / forhandling', 'Closing', 'Salg gjennomført']
const outcomeNames: Record<string, string> = { answered: 'Svar', no_answer: 'Ikke svar', callback: 'Ring tilbake', sale: 'Salg', meeting: 'Møte', declined: 'Ikke aktuell' }
const saleLabels: Record<string, string> = { registered: 'Til godkjenning', awaiting_confirmation: 'Avventer bekreftelse', approved: 'Godkjent' }
const dateLabel = (value: string) => new Date(value).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })

function useRemote<T>(url: string | null, version: number, source?: unknown) {
  const [result, setResult] = useState<{ key: string; value?: T; error?: string }>()
  const key = url + '#' + version
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    request<T>(url, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setResult({ key, value })
    }).catch(e => {
      if (!controller.signal.aborted) setResult({ key, error: e.message })
    })
    return () => controller.abort()
  }, [url, key, source])
  return url && result?.key === key ? result : undefined
}



export function CustomerWorkspace({ target, projectId, demo, leads, role, onLead, sales = [], meetings = [], demoCalls = {}, demoTasks = [], active = true }: Props) {
  const [tab, setTab] = useState<'contacts' | 'quality'>('contacts')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [showExample, setShowExample] = useState(false)
  const [chosen, setChosen] = useState('')
  const [mobileDetail, setMobileDetail] = useState(false)
  const salesHeading = useRef<HTMLHeadingElement>(null)
  const focusSales = useRef(false)
  useEffect(() => {
    if (!target || target.project !== projectId) return
    setTab('contacts'); setChosen(target.lead); setQuery(''); setPage(0); setMobileDetail(true)
    focusSales.current = target.sales
  }, [projectId, target])
  const [reviewed, setReviewed] = useState(false)
  const [qualityPage, setQualityPage] = useState(0)
  const [version, setVersion] = useState(0)
  const [demoSteps, setDemoSteps] = useState<Record<string, number>>({})
  const [demoFlags, setDemoFlags] = useState<QualityCase[]>([])
  const [editing, setEditing] = useState<{ type: 'flag'; call: ProfileCall; lead: Lead } | { type: 'review'; item: QualityCase } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const manager = role === 'leader' || role === 'admin'
  const root = `/projects/${projectId}`
  const directory = useRemote<Page<Lead>>(!demo && active && tab === 'contacts' ? `${root}/customers?${new URLSearchParams({ search: query, page: String(page) })}` : null, version, leads)
  const demoMatches = demo ? leads.filter(lead => [lead.company, lead.contact, lead.phone].some(s => s.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .sort((a,b) => a.company.localeCompare(b.company, 'nb')) : []
  const rows = demo ? demoMatches.slice(page * 30, page * 30 + 30) : directory?.value?.items || []
  const nextPage = demo ? (page + 1) * 30 < demoMatches.length : directory?.value?.has_more
  const selectedId = chosen || rows[0]?.id
  const selected = (demo ? leads : rows).find(lead => lead.id === selectedId)
  const details = useRemote<Profile>(active && !demo && tab === 'contacts' && selectedId ? `${root}/customers/${selectedId}` : null, version, leads)
  const queue = useRemote<Page<QualityCase>>(active && !demo && tab === 'quality' && manager ? `${root}/quality-flags?reviewed=${reviewed}&page=${qualityPage}` : null, version)
  const matchedFlags = demoFlags.filter(item => Boolean(item.reviewed_at) === reviewed)
  const cases = demo ? matchedFlags.slice(qualityPage * 30, qualityPage * 30 + 30) : queue?.value?.items || []
  let profile = details?.value
  if (demo && selected) {
    const calls = (demoCalls[selected.id] || []).slice(0,10).map(call => {
      const flag = demoFlags.find(item => item.id === call.id)
      const flag_status: ProfileCall['flag_status'] = flag ? flag.reviewed_at ? 'reviewed' : 'open' : null
      return { ...call, flag_status }
    })
    const inferred = selected.status === 'sold' ? 8 : ['callback', 'meeting'].includes(selected.status) ? 5 : calls.some(call => call.outcome !== 'no_answer') ? 4 : 1
    profile = { lead: selected, step: Math.max(inferred, demoSteps[selected.id] || 1), org_number: null, calls, tasks: demoTasks.filter(task => task.lead_id === selected.id && task.status === 'open'),
      meetings: meetings.filter(m => m.lead_id === selected.id), sales: sales.filter(s => s.lead_id === selected.id) }
  }

  useEffect(() => {
    if (active && focusSales.current && profile?.lead.id === target?.lead && salesHeading.current) {
      focusSales.current = false
      salesHeading.current.focus()
    }
  }, [active, profile?.lead.id, target])
  async function advance(step: number) {
    if (!profile || busy) return
    setBusy(true); setError('')
    try {
      if (demo) setDemoSteps(prev => ({ ...prev, [profile.lead.id]: step }))
      else { await request(`${root}/customers/${profile.lead.id}/stage`, { method: 'PATCH', body: JSON.stringify({ step, expected: profile.step }) }); setVersion(v => v + 1) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke endre salgstrinnet.') }
    finally { setBusy(false) }
  }
  async function saveNote() {
    if (!editing || !note.trim() || busy) return
    setBusy(true); setError('')
    try {
      if (editing.type === 'flag') {
        const { call, lead } = editing
        if (demo) setDemoFlags(items => [{ id: call.id, lead_id: lead.id, company: lead.company, reason: note.trim(),
          call_note: call.note, call_outcome: call.outcome, created_at: new Date().toISOString(), reviewed_at: null, review_note: null }, ...items])
        else await request(`${root}/customers/${lead.id}/calls/${call.id}/flag`, { method: 'POST', body: JSON.stringify({ reason: note }) })
      } else {
        if (demo) setDemoFlags(items => items.map(item => item.id === editing.item.id ? { ...item, reviewed_at: new Date().toISOString(), review_note: note.trim() } : item))
        else await request(`${root}/quality-flags/${editing.item.id}`, { method: 'PATCH', body: JSON.stringify({ note }) })
      }
      setEditing(null); setVersion(v => v + 1)
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke lagre saken.') }
    finally { setBusy(false) }
  }
  const loadError = tab === 'quality' ? queue?.error : directory?.error || details?.error
  const retry = () => { setError(''); setVersion(v => v + 1) }
  return <div className="customer-workspace">
    <div className="customer-tools">
      <div className="customer-switch"><button aria-pressed={tab === 'contacts'} onClick={() => {setError(''); setTab('contacts')}}><Building2 />Kunderegister</button>
        {manager && <button aria-pressed={tab === 'quality'} onClick={() => {setError(''); setTab('quality')}}><Flag />Kvalitetskontroll</button>}</div>
      {demo && tab === 'contacts' && <Button className="business-example" variant="outline" size="sm" onClick={() => setShowExample(true)}>Se ekte bedriftsoppslag</Button>}
    </div>
    {demo && <Dialog open={showExample} onOpenChange={setShowExample} title="Bouvet Norge AS" description="Lagret eksempel fra offentlige kilder."><BusinessFacts info={bouvetExample} /></Dialog>}
    {(loadError || (error && !editing)) && <div role="alert" className="customer-alert">{error || loadError} <button onClick={retry}>Prøv igjen</button></div>}
    {tab === 'contacts' ? <div className={'customer-split' + (mobileDetail ? ' show-detail' : '')}>
      <aside className="customer-index" aria-label="Kunderegister">
        <div className="customer-search"><Search size={16} /><input aria-label="Søk i kunderegister" maxLength={100} placeholder="Søk etter bedrift eller person" value={query} onChange={e => { setQuery(e.target.value); setPage(0); setChosen('') }} /></div>
        {rows.map(lead => <button key={lead.id} className="customer-row" aria-pressed={lead.id === selected?.id}
          onClick={() => {setError(''); setChosen(lead.id); setMobileDetail(true)}}><span className="customer-monogram">{lead.company.slice(0,1)}</span>
          <span><strong>{lead.company}</strong><small>{lead.contact || lead.phone}</small></span><ChevronRight size={15} /></button>)}
        {!rows.length && <p className="customer-muted">{directory?.error ? 'Registeret er utilgjengelig.' : demo || directory?.value ? 'Ingen kunder å vise.' : 'Henter kunder…'}</p>}
        {(page > 0 || nextPage) && <div className="customer-paging"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => {setPage(v => v - 1); setChosen('')}}>Forrige</Button><Button size="sm" variant="outline" disabled={!nextPage} onClick={() => {setPage(v => v + 1); setChosen('')}}>Neste</Button></div>}
      </aside>
      <section className="customer-detail" aria-label="Kundeprofil">
        <button className="customer-back" onClick={() => setMobileDetail(false)}><ArrowLeft size={16} /> Kunderegister</button>
        {profile ? <>
          <header className="customer-heading"><span className="customer-tile"><Building2 /></span><div><h2>{profile.lead.company}</h2><p>{[profile.lead.industry, profile.lead.city].filter(Boolean).join(' · ') || profile.lead.kind.toUpperCase()}</p></div>
            <Button variant="outline" size="sm" onClick={() => onLead(profile!.lead)}>Åpne leadkort<ArrowUpRight /></Button></header>
          <dl className="customer-facts"><div><dt>Kontaktperson</dt><dd>{profile.lead.contact || 'Ikke oppgitt'}</dd></div><div><dt>Telefon</dt><dd>{profile.lead.phone}</dd></div><div><dt>Organisasjonsnummer</dt><dd>{profile.org_number || String(profile.lead.enrichment?.organization_number || 'Ikke oppgitt')}</dd></div></dl>
          {profile.lead.kind === 'b2b' && <BusinessFacts info={profile.lead.enrichment || {}} />}
          <section className="customer-stage"><div><h3>Salgsprosess</h3><p>{stageNames[profile.step - 1]} · {profile.step} av 8</p></div>
            <div className="customer-track" aria-hidden="true">{stageNames.map((name, i) => <i key={name} className={i < profile!.step ? 'on' : ''} />)}</div>
            {profile.step < 7 && !['sold','declined'].includes(profile.lead.status) && <label>Neste salgstrinn <select aria-label="Velg neste salgstrinn" disabled={busy} value="" onChange={e => void advance(Number(e.target.value))}><option value="" disabled>Velg trinn</option>{stageNames.slice(profile.step,7).map((name,i) => <option key={name} value={profile!.step + i + 1}>{name}</option>)}</select></label>}
            {profile.step === 7 && <p>Registrer salget fra leadkortet for å fullføre.</p>}
          </section>
          <div className="customer-columns"><section><h3><Phone/>Siste samtaler</h3>
            {!profile.calls.length && <p className="customer-muted">Ingen registrerte samtaler.</p>}
            {profile.calls.map(call => <article className="customer-event" key={call.id}><strong>{outcomeNames[call.outcome] || call.outcome}</strong><time>{dateLabel(call.completed_at)}</time>
              <p>{call.note || 'Ingen notater registrert.'}</p>{call.flag_status ? <small>{call.flag_status === 'open' ? 'Sendt til leder' : 'Gjennomgått'}</small> : call.can_flag !== false && <button onClick={() => { setError(''); setNote(''); setEditing({ type:'flag', call, lead: profile!.lead }) }}><Flag size={13} />Flagg samtale</button>}</article>)}
          </section><section><h3><CalendarDays/>Avtaler og neste steg</h3>
            {profile.lead.status === 'callback' && profile.lead.callback_at && <p>Ring tilbake · {dateLabel(profile.lead.callback_at)}</p>}
            {profile.tasks.map(t => <article className="customer-event" key={t.id}><strong>{t.title}</strong><time>{dateLabel(t.due_at)}</time></article>)}
            {profile.meetings.map(m => <details className="customer-event" key={m.id}><summary>Møte · {meetingOutcomeLabel(m.outcome)} · {dateLabel(m.starts_at)}</summary>
              <dl className="portfolio-details"><div><dt>Avsluttes</dt><dd>{m.ends_at ? dateLabel(m.ends_at) : 'Ikke registrert'}</dd></div>
                {Object.entries(m.qualification || {}).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Ikke registrert'}</dd></div>)}</dl></details>)}
            {!profile.tasks.length && !profile.meetings.length && !(profile.lead.status === 'callback' && profile.lead.callback_at) && <p className="customer-muted">Ingen oppfølging eller møter registrert.</p>}
            <h3 ref={salesHeading} tabIndex={-1} className="customer-sales"><ClipboardList/>Salg</h3>
            {profile.sales.map(s => <details className="customer-event" key={s.id}><summary>{money(s.amount_ore)} · {saleLabels[s.status] || s.status}</summary>
              <dl className="portfolio-details"><div><dt>Registrert</dt><dd>{dateLabel(s.created_at)}</dd></div>
                {s.allocation && <><div><dt>Selgerandel</dt><dd>{money(s.allocation.seller)}</dd></div><div><dt>Partnerandel</dt><dd>{money(s.allocation.partner)}</dd></div>
                <div><dt>Hubandel</dt><dd>{money(s.allocation.hub)}</dd></div></>}</dl></details>)}
            {!profile.sales.length && <p className="customer-muted">Ingen registrerte salg å vise.</p>}
          </section></div>
        </> : <p className="customer-muted">{details?.error ? 'Kundeprofilen er utilgjengelig.' : selectedId ? 'Henter kundeprofil…' : 'Velg en kunde fra registeret.'}</p>}
      </section>
    </div> : manager && <section className="customer-quality"><header><div><h2>Samtaler til gjennomgang</h2><p>Manuelt flaggede samtaler i prosjektet.</p></div><select aria-label="Kvalitetssaker" value={String(reviewed)} onChange={e => {setReviewed(e.target.value === 'true'); setQualityPage(0)}}><option value="false">Åpne saker</option><option value="true">Gjennomgåtte saker</option></select></header>
      {cases.map(item => <article key={item.id}><div><h3>{item.company}</h3><time>{dateLabel(item.created_at)} · {outcomeNames[item.call_outcome]}</time></div><p><strong>Flagget fordi</strong><br/>{item.reason}</p>
        {item.call_note && <p><strong>Samtalenotat</strong><br/>{item.call_note}</p>}
        {item.reviewed_at ? <p><strong>Ledervurdering</strong><br/>{item.review_note}</p> : <Button variant="outline" size="sm" onClick={() => {setNote(''); setError(''); setEditing({ type:'review', item })}}>Gjennomgå sak</Button>}</article>)}
      {!cases.length && <p className="customer-muted">{!demo && !queue ? 'Henter saker…' : reviewed ? 'Ingen gjennomgåtte saker.' : 'Ingen åpne saker.'}</p>}
      {(qualityPage > 0 || (demo ? (qualityPage + 1) * 30 < matchedFlags.length : queue?.value?.has_more)) && <div className="customer-paging"><Button variant="outline" disabled={!qualityPage} onClick={() => setQualityPage(p=>p-1)}>Forrige</Button><Button variant="outline" disabled={demo ? (qualityPage+1)*30>=matchedFlags.length : !queue?.value?.has_more} onClick={() => setQualityPage(p=>p+1)}>Neste</Button></div>}
    </section>}
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open && !busy) {setEditing(null); setError('')} }} title={editing?.type === 'review' ? 'Gjennomgå samtale' : 'Flagg samtale til leder'} description={editing?.type === 'review' ? 'Registrer vurderingen for å lukke saken.' : 'Beskriv hendelsen som lederen skal se nærmere på.'}>
      <form className="form-stack" onSubmit={e => {e.preventDefault(); void saveNote()}}><label>{editing?.type === 'review' ? 'Ledervurdering' : 'Grunn til flagging'}<textarea required maxLength={1000} rows={3} value={note} onChange={e=>setNote(e.target.value)}/></label>
        {error && <p role="alert">{error}</p>}<Button disabled={busy || !note.trim()}><Check/>{editing?.type === 'review' ? 'Lagre vurdering' : 'Send til leder'}</Button></form></Dialog>
  </div>
}
