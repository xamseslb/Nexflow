import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, ExternalLink, MapPin, Pause, Play, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { request, type Project } from '@/lib/api'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import './company-discovery.css'
import { WebsitePhones, type WebsitePhone } from './WebsitePhones'

type Settings = { enabled: boolean; industries: string[]; call_list_id: string | null; area: string; daily_limit: number;
  imported_today: number; last_run_at: string | null; next_run_at: string | null; last_error: string | null; last_summary: Record<string, number | boolean> }
type Entry = { id: string; company: string; org_number: string; status: string; reason: string; lead_id: string | null; source_url: string; created_at: string; website_phones?: WebsitePhone[]; website_phone_status?: string; website_checked_at?: string }
type Queue = { id: string; name: string; category: string }
type Data = { settings: Settings; catalog: { code: string; name: string }[]; catalog_as_of: string }
const statusLabels: Record<string, string> = { imported: 'I Cold-kø', review: 'Må gjennomgås', duplicate: 'Allerede kjent', excluded: 'Utelatt', rejected: 'Avvist' }
const demoData: Data = { settings: { enabled: false, industries: [], call_list_id: 'demo-cold', area: 'Oslo', daily_limit: 20,
  imported_today: 0, last_run_at: null, next_run_at: null, last_error: null, last_summary: {} },
  catalog: [{code: '41', name: 'Oppføring av bygninger'}, {code: '43', name: 'Spesialisert bygge- og anleggsvirksomhet'},
    {code: '56', name: 'Serveringsvirksomhet'}, {code: '62', name: 'Dataprogrammering og datakonsulentvirksomhet'}], catalog_as_of: '2026-11-12' }
function time(value: string | null) { return value ? new Intl.DateTimeFormat('nb-NO', {dateStyle:'short', timeStyle:'short', timeZone:'Europe/Oslo'}).format(new Date(value)) : 'Ikke kjørt ennå' }

export function CompanyDiscovery({ project, demo, onCustomer, onQueues }: {
  project: Project; demo: boolean; onCustomer: (id: string) => void; onQueues: () => void
}) {
  const root = `/projects/${project.id}/discovery`
  const [data, setData] = useState<Data | null>(null)
  const [draft, setDraft] = useState<{enabled: boolean; industries: string[]; call_list_id: string}>({enabled:false, industries:[], call_list_id:''})
  const [queues, setQueues] = useState<Queue[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [review, setReview] = useState<Entry | null>(null)
  const [phone, setPhone] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    if (demo) {
      const value = structuredClone(demoData)
      setData(value); setDraft({...value.settings, call_list_id:'demo-cold'})
      setQueues([{id:'demo-cold', name:'Cold – Bedriftssøk', category:'cold'}]); setLoading(false)
      return
    }
    Promise.all([request<Data>(root), request<Queue[]>(`/projects/${project.id}/call-lists`)])
      .then(([value, lists]) => { if (!active) return; setData(value); setQueues(lists.filter(q=>q.category==='cold'))
        setDraft({enabled:value.settings.enabled, industries:value.settings.industries, call_list_id:value.settings.call_list_id || lists.find(q=>q.category==='cold')?.id || ''}) })
      .catch(e=>active && setError(e.message)).finally(()=>active && setLoading(false))
    return ()=>{active=false}
  }, [root, project.id, demo, revision])
  useEffect(() => {
    let active = true
    if (demo) { setEntries([]); setMore(false); return }
    setEntries([])
    request<{items: Entry[]; has_more: boolean}>(`${root}/records?status=${status}&page=${page}`)
      .then(value=>{if(active){setEntries(value.items); setMore(value.has_more)}}).catch(e=>active && setError(e.message))
    return ()=>{active=false}
  }, [root, demo, status, page, revision])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || !data) return
    setBusy(true); setError(''); setNotice('')
    try {
      const settings = demo ? {...data.settings, ...draft} : await request<Settings>(root,{method:'PATCH',body:JSON.stringify(draft)})
      setData({...data,settings}); setNotice(demo ? 'Demoinnstillinger lagret for denne visningen. Ingen bedrifter hentes.' : settings.enabled ? 'Lagret. Søket kjøres automatisk ved neste timekjøring.' : 'Lagret. Automatisk bedriftssøk er satt på pause.')
    } catch(e) { setError(e instanceof Error ? e.message : 'Kunne ikke lagre') } finally {setBusy(false)}
  }
  async function createQueue() {
    setBusy(true); setError('')
    try {
      const queue = await request<Queue>(`/projects/${project.id}/call-lists`,{method:'POST',body:JSON.stringify({name:'Cold – Bedriftssøk',category:'cold'})})
      setQueues(q=>[...q,queue]); setDraft(d=>({...d,call_list_id:queue.id}))
    } catch(e) {setError(e instanceof Error ? e.message : 'Kunne ikke opprette kø')} finally {setBusy(false)}
  }
  async function decide(decision: 'approve' | 'reject') {
    if (!review || busy) return
    setBusy(true); setError('')
    try {
      await request(`${root}/records/${review.id}/review`,{method:'POST',body:JSON.stringify({decision,phone,confirmed_business_number:confirmed})})
      setReview(null); setNotice(decision==='approve' ? 'Kontakten er lagt i Cold-køen.' : 'Treffet er avvist og blir ikke importert på nytt.')
      setRevision(n=>n+1)
    } catch(e) {setError(e instanceof Error ? e.message : 'Kunne ikke behandle treffet')} finally {setBusy(false)}
  }
  const dirty = data && (draft.enabled!==data.settings.enabled || draft.call_list_id!==(data.settings.call_list_id || '') || JSON.stringify([...draft.industries].sort())!==JSON.stringify([...data.settings.industries].sort()))
  const options = data?.catalog.filter(i=>`${i.name} ${i.code}`.toLocaleLowerCase('nb').includes(search.toLocaleLowerCase('nb'))) || []
  return <section className="discovery-workspace" aria-label="Automatisk bedriftssøk">
    <div className="discovery-toolbar"><span><MapPin size={16}/> Oslo <span className="discovery-divider">/</span> {project.name}</span>
      <Button variant="outline" disabled={busy || loading} onClick={()=>{setRevision(n=>n+1);setNotice('')}}><RefreshCw/>Hent status på nytt</Button></div>
    {error && !review && <p className="discovery-error" role="alert">{error}</p>}
    {notice && <p className="discovery-notice" role="status">{notice}</p>}
    {loading ? <p role="status">Henter søkeinnstillinger…</p> : data && <>
      <div className="discovery-summary">
        <div><span>Automatisk søk</span><strong>{data.settings.enabled ? <><Play size={17}/> Aktivt</> : <><Pause size={17}/> Pauset</>}</strong></div>
        <div><span>Nye bedrifter i dag</span><strong>{data.settings.imported_today} <small>/ {data.settings.daily_limit}</small></strong><span>Inkluderer treff til gjennomgang · norsk dato</span></div>
        <div><span>Siste søk</span><strong className="discovery-time">{time(data.settings.last_run_at)}</strong><span>{data.settings.next_run_at ? `Tidligst neste søk: ${time(data.settings.next_run_at)}` : 'Aktiver søket for å starte'}</span></div>
      </div>
      {data.settings.last_error && <p role="alert" className="discovery-error">{data.settings.last_error}</p>}
      <div className="discovery-layout">
        <form className="panel discovery-settings" onSubmit={save} data-tour="discovery-settings">
          <h2>Finn de riktige bedriftene</h2><p>Aktive bedrifter med forretningsadresse i Oslo. Vi henter høyst 20 nye per dag.</p>
          <label className="discovery-check"><input type="checkbox" checked={draft.enabled} disabled={busy || !project.active} onChange={e=>setDraft(d=>({...d,enabled:e.target.checked}))}/><span>Automatisk søk hver time</span></label>
          <label className="discovery-field">Legg klare kontakter i<select value={draft.call_list_id} disabled={busy} required onChange={e=>setDraft(d=>({...d,call_list_id:e.target.value}))}><option value="" disabled>Velg Cold-kø</option>{queues.map(q=><option key={q.id} value={q.id}>{q.name}</option>)}</select></label>
          {!queues.length && <Button type="button" variant="outline" disabled={busy || demo} onClick={createQueue}>Opprett Cold-kø</Button>}
          <fieldset disabled={busy}><legend>Bransjer</legend><p>{draft.industries.length ? `${draft.industries.length} bransjer valgt` : 'Alle bransjer er inkludert'}</p>
            <label className="discovery-check"><input type="checkbox" checked={!draft.industries.length} onChange={e=>setDraft(d=>({...d,industries:e.target.checked ? [] : data.catalog.map(i=>i.code)}))}/>Alle bransjer</label>
            <label className="discovery-search"><Search size={16}/><input aria-label="Søk etter bransje" placeholder="Søk navn eller næringskode" value={search} onChange={e=>setSearch(e.target.value)}/></label>
            <div className="discovery-options">{options.map(i=><label className="discovery-check" key={i.code}><input type="checkbox" checked={draft.industries.includes(i.code)} onChange={e=>setDraft(d=>({...d,industries:e.target.checked ? [...d.industries,i.code] : d.industries.filter(c=>c!==i.code)}))}/><span>{i.name}<small>Næringskode {i.code}</small></span></label>)}{!options.length && <p>Ingen bransjer matcher søket.</p>}</div>
            <small>Bransjegrupper fra SSB, hentet {data.catalog_as_of}. {demo && 'Et utvalg vises i demoen.'}</small>
          </fieldset>
          <div className="discovery-save"><Button disabled={busy || !draft.call_list_id || !dirty}>{busy ? 'Lagrer…' : draft.enabled ? 'Lagre og aktiver' : 'Lagre innstillinger'}</Button>{dirty && <small>Ulagrede endringer</small>}</div>
        </form>
        <div className="discovery-results panel" data-tour="discovery-results"><div className="discovery-results-heading"><div><h2>Treff og importhistorikk</h2><p>Åpne kundekortet, eller kontroller treff som mangler telefon.</p></div><Button variant="outline" onClick={onQueues}>Åpne ringekøer<ArrowRight/></Button></div>
          {Object.keys(data.settings.last_summary).length>0 && <p className="discovery-last">{data.settings.last_summary.quota_reached ? 'Dagens kvote er brukt opp. Søket fortsetter neste dag.' : `Siste søk: ${data.settings.last_summary.imported || 0} til Cold · ${data.settings.last_summary.review || 0} til gjennomgang · ${data.settings.last_summary.duplicate || 0} allerede kjent · ${data.settings.last_summary.excluded || 0} utelatt`}</p>}
          <label className="discovery-field">Vis treff<select value={status} onChange={e=>{setStatus(e.target.value);setPage(0)}}><option value="all">Alle treff</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          {!entries.length ? <div className="discovery-empty"><Search size={28}/><h3>{demo ? 'Ingen reelle søk i demonstrasjonen' : 'Ingen treff i denne visningen ennå'}</h3><p>{data.settings.enabled ? 'Nye treff vises etter neste timekjøring. Bruk «Hent status på nytt» for å oppdatere.' : 'Velg bransjer og en Cold-kø, og aktiver automatisk søk.'}</p></div> : <ul className="discovery-records">{entries.map(row=><li key={row.id}>
            <div><span className={`discovery-status ${row.status}`}>{statusLabels[row.status]}</span><h3>{row.lead_id ? <button onClick={()=>onCustomer(row.lead_id!)}>{row.company}<ArrowRight size={14}/></button> : row.company}</h3><p>Org.nr. {row.org_number} · {time(row.created_at)}</p><p>{row.reason}</p>{row.status==='review' && <p>{row.website_phones?.length ? `${row.website_phones.length} telefonforslag funnet på nettsiden` : row.website_phone_status==='missing_website' ? 'Ingen nettside registrert' : 'Telefon søkes på registrert nettside ved automatisk oppslag'}</p>}</div>
            <div className="discovery-record-actions"><a href={row.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Registerkilde for ${row.company}`}>Registerkilde<ExternalLink size={13}/></a>{row.status==='review' && <Button variant="outline" size="sm" onClick={()=>{setReview(row);setPhone(row.website_phone_status==='found' && row.website_phones?.length===1 ? row.website_phones[0].phone : '');setConfirmed(false);setError('')}}>Gjennomgå</Button>}</div>
          </li>)}</ul>}
          <div className="discovery-pagination"><Button variant="ghost" disabled={page===0} onClick={()=>setPage(n=>n-1)}>Forrige</Button><span>Side {page+1}</span><Button variant="ghost" disabled={!more} onClick={()=>setPage(n=>n+1)}>Neste</Button></div>
          <p className="discovery-explainer"><ShieldCheck size={16}/>Duplikater og registrerte reklamereservasjoner utelates. Treff uten telefon må gjennomgås før de kan ringes.</p>
        </div>
      </div>
    </>}
    <Dialog open={Boolean(review)} onOpenChange={open=>{if(!open && !busy)setReview(null)}} title="Kontroller bedriftsnummer" description={review?.company || ''}>
      <form className="form-stack" onSubmit={e=>{e.preventDefault();void decide('approve')}}>
        <p>Oppgi bedriftens offentlige telefonnummer. Godkjenning legger kontakten i prosjektets valgte Cold-kø.</p>
        <WebsitePhones phones={review?.website_phones} status={review?.website_phone_status} checked={review?.website_checked_at} onChoose={value=>{setPhone(value);setConfirmed(false)}}/>
        <label>Bedriftens telefonnummer<input type="tel" required maxLength={30} value={phone} placeholder="+47 22 00 00 00" onChange={e=>setPhone(e.target.value)}/></label>
        <label className="discovery-check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Jeg har kontrollert at nummeret tilhører bedriften.</label>
        {error && <p role="alert" className="discovery-error">{error}</p>}
        <Button disabled={busy || !confirmed}>Godkjenn og legg i Cold</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>void decide('reject')}>Avvis treff</Button>
      </form>
    </Dialog>
  </section>
}
