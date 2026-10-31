import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowRight, Bell, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, LayoutDashboard, ListFilter, Loader2, LogOut, Menu, MoreHorizontal, Phone, Plus, Search, ShieldCheck, Sparkles, Target, TrendingUp, Users, Wallet, X, BriefcaseBusiness, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { money, cn } from '@/lib/utils'
import { apiUrl, request, supabase, demoProjects, demoLeads, demoProducts, demoSales, initialMeetings, type Project, type Lead, type Sale, type Product, type Meeting } from '@/lib/api'

type View = 'overview' | 'leads' | 'meetings' | 'sales' | 'projects'
const labels: Record<string, string> = { new: 'Ny', callback: 'Ring tilbake', meeting: 'Møte booket', sold: 'Salg', declined: 'Ikke aktuell', blocked: 'Sperret', registered: 'Til godkjenning', approved: 'Godkjent', awaiting_confirmation: 'Venter på bekreftelse' }
const navigation: { id: View; label: string; icon: typeof Phone }[] = [
  { id: 'overview', label: 'Oversikt', icon: LayoutDashboard }, { id: 'leads', label: 'Ringeliste', icon: Phone },
  { id: 'meetings', label: 'Møter', icon: CalendarDays }, { id: 'sales', label: 'Salg og opptjening', icon: Wallet }, { id: 'projects', label: 'Prosjekter', icon: BriefcaseBusiness }
]

function Badge({ status }: { status: string }) { return <span className={cn('badge', `badge-${status}`)}>{labels[status] || status}</span> }
function initials(name: string) { return name.split(' ').slice(0, 2).map(x => x[0]).join('') }
function dateLabel(value: string) { return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }

export default function App() {
  const [demo, setDemo] = useState(import.meta.env.VITE_DEMO_MODE === 'true')
  const [authenticated, setAuthenticated] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [view, setView] = useState<View>('overview')
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [closers, setClosers] = useState<{ id: string; name: string }[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<Lead | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [modal, setModal] = useState<'lead' | 'sale' | 'meeting' | 'help' | null>(null)
  const [call, setCall] = useState<{ id: string; phone: string } | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [eligibility, setEligibility] = useState<{ allowed: boolean; reason: string } | null>(null)
  const [callbackTime, setCallbackTime] = useState('')
  const [demoLog, setDemoLog] = useState(0)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setAuthenticated(Boolean(data.session)))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setAuthenticated(Boolean(session)))
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer) } }, [notice])
  useEffect(() => {
    let cancelled = false
    if (demo) { setProjects(demoProjects); setProjectId(demoProjects[0].id); return }
    if (!authenticated) return
    setLoading(true)
    request<Project[]>('/projects').then(data => { if (!cancelled) { setProjects(data); setProjectId(data[0]?.id || '') } }).catch(e => !cancelled && setError(e.message)).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [demo, authenticated])

  async function loadProject(id: string) {
    const root = `/projects/${id}`
    const [l, s, p, m] = await Promise.all([request<Lead[]>(`${root}/leads`), request<Sale[]>(`${root}/sales`), request<Product[]>(`${root}/products`), request<Meeting[]>(`${root}/meetings`)])
    return { l, s, p, m }
  }
  useEffect(() => {
    let cancelled = false
    setSelected(null); setCall(null); setSearch(''); setFilter('all'); setError('')
    if (!projectId) return
    setLeads([]); setSales([]); setMeetings([]); setProducts([])
    if (demo) { setLeads(projectId === 'demo-1' ? structuredClone(demoLeads) : []); setSales(projectId === 'demo-1' ? structuredClone(demoSales) : []); setProducts(demoProducts); setMeetings(projectId === 'demo-1' ? initialMeetings() : []); return }
    setLoading(true)
    loadProject(projectId).then(({ l, s, p, m }) => { if (!cancelled) { setLeads(l); setSales(s); setProducts(p); setMeetings(m) } }).catch(e => !cancelled && setError(e.message)).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [projectId, demo])
  useEffect(() => {
    let cancelled = false
    setEligibility(null); setCall(null)
    if (!selected) return
    if (demo) { setEligibility({ allowed: !selected.blocked, reason: selected.blocked ? 'Reservert mot telefonsalg – mangler gyldig samtykke' : 'Kan ringes · B2B' }); return }
    request<{ allowed: boolean; reason: string }>(`/projects/${projectId}/leads/${selected.id}/eligibility`).then(data => !cancelled && setEligibility(data)).catch(e => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [selected?.id, projectId, demo])
  useEffect(() => {
    let cancelled = false
    setClosers([])
    if (modal !== 'meeting') return
    if (demo) { setClosers([{ id: 'demo-closer', name: 'Alex · Demo-closer' }]); return }
    request<{ id: string; name: string }[]>(`/projects/${projectId}/closers`).then(data => !cancelled && setClosers(data)).catch(e => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [modal, projectId, demo])

  const project = projects.find(p => p.id === projectId)
  const pending = leads.filter(l => !['sold', 'declined'].includes(l.status))
  const filtered = useMemo(() => leads.filter(l => (filter === 'all' || (filter === 'available' ? !l.blocked && ['new', 'callback'].includes(l.status) : l.status === filter)) && `${l.company} ${l.contact} ${l.city}`.toLowerCase().includes(search.toLowerCase())), [leads, filter, search])
  const totalSales = sales.reduce((s, x) => s + x.amount_ore, 0)
  const earnings = sales.reduce((s, x) => s + x.allocation.seller, 0)
  const root = `/projects/${projectId}`
  const manager = project && ['leader', 'admin'].includes(project.role)

  async function action(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Noe gikk galt') } finally { setBusy(false) }
  }
  async function refresh() { if (!demo) { const { l, s, p, m } = await loadProject(projectId); setLeads(l); setSales(s); setProducts(p); setMeetings(m) } }
  async function login(e: FormEvent) {
    e.preventDefault()
    await action(async () => { if (!supabase) throw new Error('Supabase må konfigureres før innlogging'); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; setPassword('') })
  }
  async function startCall() {
    if (!selected) return
    await action(async () => {
      if (demo) { setCall({ id: 'demo-call', phone: '' }); setNotice('Demonstrasjon: Samtale startet. Ingen nummer ringes.'); return }
      const result = await request<{ id: string; phone: string }>(`${root}/leads/${selected.id}/call-authorization`, { method: 'POST' })
      setCall(result); window.location.href = `tel:${result.phone}`
    })
  }
  async function logCall(outcome: string) {
    if (!selected || !call) return
    await action(async () => {
      if (outcome === 'callback' && !callbackTime) throw new Error('Velg tidspunkt for tilbakekalling')
      if (demo) { setDemoLog(x => x + 1); setLeads(ls => ls.map(l => l.id === selected.id && ['callback', 'declined'].includes(outcome) ? { ...l, status: outcome } : l)) }
      else await request(`${root}/calls/${call.id}`, { method: 'PATCH', body: JSON.stringify({ outcome, callback_at: outcome === 'callback' ? new Date(callbackTime).toISOString() : null }) })
      setCall(null); setSelected(null); setNotice('Samtaleutfallet er registrert'); await refresh()
    })
  }
  async function submitLead(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget)
    await action(async () => {
      const body = { company: String(data.get('company')), contact: String(data.get('contact')), phone: String(data.get('phone')), kind: String(data.get('kind')), org_number: String(data.get('org_number')) || null }
      if (demo) setLeads(ls => [...ls, { ...body, kind: body.kind as 'b2b' | 'b2c', id: crypto.randomUUID(), project_id: projectId, status: 'new', priority: 50, industry: '', city: '', summary: '', blocked: body.kind === 'b2c', enrichment: {} }])
      else await request(`${root}/leads`, { method: 'POST', body: JSON.stringify(body) })
      setModal(null); setNotice('Lead lagt til'); await refresh()
    })
  }
  async function submitSale(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget); if (!selected) return
    await action(async () => {
      const product = products.find(p => p.id === data.get('product'))!
      if (demo) {
        const seller = Math.floor(product.price_ore / 10), hub = Math.floor(product.price_ore / 5)
        setSales(ss => [...ss, { id: crypto.randomUUID(), lead_id: selected.id, amount_ore: product.price_ore, created_at: new Date().toISOString(), status: selected.kind === 'b2c' ? 'awaiting_confirmation' : 'registered', allocation: { seller, hub, partner: product.price_ore - seller - hub } }])
        setLeads(ls => ls.map(l => l.id === selected.id ? { ...l, status: 'sold' } : l))
      } else {
        await request(`${root}/leads/${selected.id}/reserve`, { method: 'POST' })
        await request(`${root}/sales`, { method: 'POST', body: JSON.stringify({ lead_id: selected.id, product_id: product.id, idempotency_key: crypto.randomUUID() }) })
      }
      setModal(null); setSelected(null); setNotice('Salg registrert og sendt til godkjenning'); await refresh()
    })
  }
  async function submitMeeting(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget); if (!selected) return
    await action(async () => {
      const start = new Date(String(data.get('starts')))
      if (start <= new Date()) throw new Error('Velg et fremtidig tidspunkt')
      const body = { lead_id: selected.id, closer_id: String(data.get('closer')), starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 30 * 60000).toISOString(), qualification: { behov: String(data.get('needs')), budsjett: String(data.get('budget')), beslutningstaker: String(data.get('decision')), tidslinje: String(data.get('timeline')) } }
      if (demo) { setMeetings(ms => [...ms, { ...body, id: crypto.randomUUID(), outcome: 'booked' }]); setLeads(ls => ls.map(l => l.id === selected.id ? { ...l, status: 'meeting' } : l)) }
      else { await request(`${root}/leads/${selected.id}/reserve`, { method: 'POST' }); await request(`${root}/meetings`, { method: 'POST', body: JSON.stringify(body) }) }
      setModal(null); setSelected(null); setNotice('Møte registrert. Kalenderutsending er ikke aktivert ennå.'); await refresh()
    })
  }
  function download(content: string, name: string, type = 'text/csv;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
  }
  async function exportSales() {
    await action(async () => {
      if (demo) { download('sale_id,amount_ore,status\n' + sales.map(s => `${s.id},${s.amount_ore},${s.status}`).join('\n'), 'demo-salg.csv'); return }
      const { data } = await supabase!.auth.getSession()
      const res = await fetch(`${apiUrl}${root}/exports/sales.csv`, { headers: { Authorization: `Bearer ${data.session?.access_token}` }, cache: 'no-store' })
      if (!res.ok) throw new Error('Kunne ikke eksportere salg')
      download(await res.text(), 'salg.csv')
    })
  }

  if (!demo && !authenticated) return <div className="login-page"><div className="login-story"><div className="brand"><span className="brand-icon">h</span> hub<span className="brand-sub">CRM</span></div><div><span className="eyebrow">ET SAMLET SALGSTEAM</span><h1>Flere gode samtaler.<br />Mer felles vekst.</h1><p>Prosjektene, kundene og mulighetene dine.<br />Samlet i én arbeidsdag.</p></div><span className="login-foot">Bygget for mennesker som bygger relasjoner.</span></div><main className="login-main"><div className="login-card"><span className="eyebrow">VELKOMMEN TIL HUB</span><h2>Din neste mulighet<br />starter her.</h2><p>Logg inn for å åpne arbeidsdagen din.</p><form onSubmit={login} className="form-stack"><label>E-post<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="deg@bedrift.no" /></label><label>Passord<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><Button disabled={busy || !supabase}>{busy ? <Loader2 className="animate-spin" /> : null}Logg inn <ArrowRight /></Button></form>{!supabase && <p className="setup-note">Ekte innlogging blir tilgjengelig når Supabase er koblet til.</p>}{error && <p role="alert" className="error-text">{error}</p>}<div className="login-divider">ELLER UTFORSK ARBEIDSFLATEN</div><Button variant="outline" className="w-full" onClick={() => { setDemo(true); setError('') }}>Åpne demonstrasjon <ArrowRight /></Button><p className="demo-disclaimer">Kun fiktive data. Ingen anrop eller utsendinger.</p></div></main></div>

  return <div className="app-shell">
    {sidebar && <button className="sidebar-overlay" aria-label="Lukk meny" onClick={() => setSidebar(false)} />}
    <aside className={cn('sidebar', sidebar && 'sidebar-open')}>
      <a href="#" className="brand" onClick={e => { e.preventDefault(); setView('overview'); setSidebar(false) }}><span className="brand-icon">h</span> hub<span className="brand-sub">CRM</span></a>
      <div className="workspace"><span className="workspace-icon"><Building2 size={18} /></span><div><strong>Partnerhuben</strong><small>Din felles arbeidsflate</small></div><ChevronDown size={15} /></div>
      <span className="nav-caption">ARBEIDSOMRÅDE</span>
      <nav>{navigation.map(item => <button key={item.id} className={cn('nav-item', view === item.id && 'active')} onClick={() => { setView(item.id); setSelected(null); setSidebar(false) }}><item.icon size={19} /><span>{item.label}</span>{item.id === 'meetings' && meetings.length > 0 && <span className="nav-count">{meetings.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="team-card"><div className="team-card-icon"><Users size={19} /></div><strong>Bedre sammen.</strong><p>Ett team. Flere partnere.<br />Nye muligheter hver dag.</p><button onClick={() => setView('projects')}>Se prosjektene <ArrowRight size={14} /></button></div><button className="nav-item" onClick={() => setModal('help')}><CircleHelp size={18} />Hjelp og informasjon</button><div className="profile"><div className="avatar">{demo ? 'DE' : 'DU'}</div><div><strong>{demo ? 'Demobruker' : 'Min arbeidsflate'}</strong><small>{demo ? 'Demonstrasjon' : project?.role || 'Innlogget'}</small></div><button aria-label="Logg ut" onClick={() => { setDemo(false); setProjects([]); setLeads([]); setSelected(null); supabase?.auth.signOut() }}><LogOut size={17} /></button></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><button className="mobile-menu" aria-label="Åpne meny" onClick={() => setSidebar(true)}><Menu size={21} /></button><span>Arbeidsområde</span><ChevronRight size={14} /><strong>{navigation.find(n => n.id === view)?.label}</strong></div><div className="topbar-right"><span className="today">{new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span><span className={cn('connection', !online && 'offline')}><i />{online ? 'Tilkoblet' : 'Frakoblet'}</span><button className="notification" aria-label="Vis informasjon" onClick={() => setNotice(demo ? 'Du bruker en demonstrasjon med fiktive data.' : 'Ingen nye systemvarsler.')}><Bell size={19} /></button></div></header>
      {demo && <div className="demo-banner"><span><span className="demo-dot" />Demonstrasjon · fiktive data, endringer lagres ikke ved prosjektbytte</span><button onClick={() => { setDemo(false); setProjectId(''); setProjects([]) }}>Avslutt demo <X size={13} /></button></div>}
      {!online && <div className="error-banner">Du er frakoblet. Ringing og registrering krever nettilgang.</div>}
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="Lukk feilmelding"><X size={16} /></button></div>}
      <main className="content">
        <div className="page-heading"><div><span className="eyebrow">{view === 'overview' ? 'DIN ARBEIDSDAG, SAMLET' : 'PARTNERHUBEN'}</span><h1>{view === 'overview' ? 'Klar for nye muligheter?' : navigation.find(n => n.id === view)?.label}</h1><p>{view === 'overview' ? 'Her er oversikten din. La oss gjøre det til en god dag.' : view === 'leads' ? 'De rette kontaktene. Alt du trenger før neste samtale.' : view === 'meetings' ? 'Fra en god samtale til et verdifullt møte.' : view === 'sales' ? 'Følg salgene og opptjeningen din, hele veien.' : 'Ett sted for alle partnerne du jobber med.'}</p></div><div className="heading-actions"><label className="project-picker"><BriefcaseBusiness size={16} /><select aria-label="Aktivt prosjekt" value={projectId} onChange={e => setProjectId(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{view !== 'projects' && <Button disabled={!projectId} onClick={() => setModal('lead')}><Plus />Nytt lead</Button>}</div></div>
        {loading ? <div className="empty-state"><Loader2 className="animate-spin" /><h3>Henter arbeidsdagen din…</h3></div> : !project ? <div className="empty-state"><BriefcaseBusiness /><h3>Ingen prosjekter ennå</h3><p>En administrator må tildele deg et prosjekt.</p></div> : <>
          {view === 'overview' && <>
            <div className="stat-grid">
              {[{ label: 'Leads i arbeidslisten', value: pending.length.toString(), icon: Target, sub: `${leads.filter(l => l.status === 'new').length} nye muligheter`, tone: 'green' }, { label: demo ? 'Samtaler i demoøkten' : 'Ring tilbake', value: demo ? demoLog.toString() : leads.filter(l => l.status === 'callback').length.toString(), icon: Phone, sub: demo ? 'Prøv en samtale i ringelisten' : 'Kontakter som venter på deg', tone: 'blue' }, { label: 'Bookede møter', value: meetings.length.toString(), icon: CalendarDays, sub: 'Neste steg mot et godt samarbeid', tone: 'purple' }, { label: 'Registrert salgsverdi', value: money(totalSales), icon: TrendingUp, sub: 'Eks. mva · gjeldende prosjekt', tone: 'orange' }].map(stat => <div className="stat-card" key={stat.label}><div className="stat-top"><span>{stat.label}</span><span className={`stat-icon ${stat.tone}`}><stat.icon size={18} /></span></div><strong>{stat.value}</strong><small>{stat.sub}</small></div>)}
            </div>
            <div className="overview-grid"><section className="focus-card"><div className="focus-copy"><span className="focus-kicker"><span /> DITT NESTE STEG</span><h2>En god samtale<br />kan starte noe stort.</h2><p>Leadene er samlet. Mulighetene venter.<br />Ta neste samtale når du er klar.</p><Button className="bg-white text-primary hover:bg-white/90" onClick={() => { setView('leads'); setFilter('available') }}>Åpne ringelisten <ArrowRight /></Button><span className="focus-foot"><ShieldCheck size={14} />Ringetillatelse kontrolleres før hvert anrop</span></div><div className="focus-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-card"><div className="art-avatar"><Phone size={25} /></div><span className="art-line" /><span className="art-line short" /><div className="art-bottom"><span /><span /><span /></div></div><span className="floating-check"><Check size={22} /></span><span className="floating-spark"><Sparkles size={20} /></span></div></section><section className="panel upcoming"><div className="panel-heading"><h2>Neste på agendaen</h2><CalendarDays size={18} /></div>{meetings.slice(0, 2).map(m => <div className="agenda-item" key={m.id}><div className="agenda-date"><strong>{new Date(m.starts_at).getDate()}</strong><span>{new Intl.DateTimeFormat('nb-NO', { month: 'short' }).format(new Date(m.starts_at))}</span></div><div><strong>{leads.find(l => l.id === m.lead_id)?.company || 'Kvalifiseringsmøte'}</strong><span>{dateLabel(m.starts_at)}</span><small>Kvalifiseringsmøte · 30 min</small></div></div>)}{meetings.length === 0 && <p className="muted p-5">Ingen møter booket ennå.</p>}<button className="text-link agenda-link" onClick={() => setView('meetings')}>Se alle møter <ArrowRight size={15} /></button></section></div>
          </>}
          {(view === 'overview' || view === 'leads') && <section className="panel leads-panel"><div className="panel-heading"><div><h2>{view === 'overview' ? 'Neste i ringelisten' : 'Alle leads'} <span className="count-pill">{filtered.length}</span></h2><p>{view === 'overview' ? 'Prioritert og klar for din neste samtale.' : project.description}</p></div>{view === 'overview' && <button className="text-link" onClick={() => setView('leads')}>Se hele listen <ArrowRight size={15} /></button>}</div><div className="table-toolbar"><div className="tabs"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Alle leads</button><button className={filter === 'available' ? 'selected' : ''} onClick={() => setFilter('available')}>Klar til samtale</button><button className={filter === 'callback' ? 'selected' : ''} onClick={() => setFilter('callback')}>Ring tilbake</button></div><label className="search-input"><Search size={16} /><input aria-label="Søk i leads" placeholder="Søk etter bedrift eller kontakt…" value={search} onChange={e => setSearch(e.target.value)} /></label></div><div className="lead-table"><div className="lead-row table-header"><span>BEDRIFT / KONTAKT</span><span>BRANSJE</span><span>STATUS</span><span>PRIORITET</span><span /></div>{filtered.slice(0, view === 'overview' ? 4 : 500).map((lead, index) => <button className="lead-row" key={lead.id} onClick={() => setSelected(lead)}><div className="company-cell"><div className={`company-avatar color-${index % 4}`}>{initials(lead.company)}</div><div><strong>{lead.company}</strong><small>{lead.contact || 'Ingen kontaktperson'}{lead.city ? ` · ${lead.city}` : ''}</small></div></div><span className="industry-cell">{lead.industry || 'Ikke beriket'}</span><span><Badge status={lead.blocked ? 'blocked' : lead.status} />{lead.blocked && <span className="sr-only">Sperret</span>}</span><span className="priority-cell"><span className={cn('priority-dot', lead.priority >= 90 && 'high')} />{lead.priority >= 90 ? 'Høy' : 'Normal'}</span><ChevronRight size={17} /></button>)}{filtered.length === 0 && <div className="empty-state"><Search /><h3>Ingen leads å vise</h3><p>Prøv et annet søk eller legg til ditt første lead.</p></div>}</div><div className="table-footer"><span>{view === 'overview' ? Math.min(filtered.length, 4) : filtered.length} av {leads.length} leads</span><span><ShieldCheck size={13} />Prosjektisolerte data</span></div></section>}
          {view === 'meetings' && <div className="meeting-grid">{meetings.map(m => <section className="panel meeting-card" key={m.id}><div className="panel-heading"><span className="stat-icon purple"><CalendarDays size={19} /></span><span className="badge badge-meeting">{m.outcome === 'booked' ? 'Booket' : m.outcome}</span></div><h2>{leads.find(l => l.id === m.lead_id)?.company || 'Kvalifiseringsmøte'}</h2><p><Clock3 size={15} />{dateLabel(m.starts_at)}</p><dl>{Object.entries(m.qualification).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || 'Ikke oppgitt'}</dd></div>)}</dl></section>)}{!meetings.length && <div className="empty-state panel"><CalendarDays /><h3>Plass til nye muligheter</h3><p>Åpne et lead og velg «Book møte».</p><Button onClick={() => setView('leads')}>Gå til ringelisten <ArrowRight /></Button></div>}</div>}
          {view === 'sales' && <><div className="sales-summary"><div><span className="eyebrow">REGISTRERT OPPTJENING</span><h2>{money(earnings)}</h2><p>Foreløpig provisjon. Godkjenning og vilkår avgjør utbetaling.</p></div><Button variant="outline" disabled={busy || !manager} onClick={exportSales}><ArrowDownToLine />Eksporter CSV</Button></div><section className="panel"><div className="panel-heading"><h2>Salg i prosjektet</h2><span className="count-pill">{sales.length}</span></div>{sales.map(s => <div className="sale-row" key={s.id}><div className="company-avatar color-0"><CheckCircle2 size={22} /></div><div><strong>{leads.find(l => l.id === s.lead_id)?.company || 'Salg'}</strong><small>{dateLabel(s.created_at)}</small></div><div><strong>{money(s.amount_ore)}</strong><small>Provisjon {money(s.allocation.seller)}</small></div><Badge status={s.status} />{manager && s.status === 'registered' && <Button variant="outline" size="sm" disabled={busy} onClick={() => action(async () => { if (demo) setSales(ss => ss.map(x => x.id === s.id ? { ...x, status: 'approved' } : x)); else await request(`${root}/sales/${s.id}/approve`, { method: 'POST' }); setNotice('Salget er godkjent'); await refresh() })}>Godkjenn</Button>}</div>)}{!sales.length && <div className="empty-state"><Wallet /><h3>Her vokser resultatene dine</h3><p>Registrer et salg fra leadkortet.</p></div>}</section></>}
          {view === 'projects' && <div className="project-grid">{projects.map((p, i) => <section className="panel project-card" key={p.id}><div className="panel-heading"><span className={`company-avatar color-${i}`}><BriefcaseBusiness size={23} /></span><span className="badge badge-new">{p.active ? 'Aktivt' : 'Pauset'}</span></div><h2>{p.name}</h2><p>{p.description}</p><div className="project-meta"><span>{p.kind.toUpperCase()}</span><span>Din rolle: {p.role}</span></div><Button variant={p.id === projectId ? 'outline' : 'default'} onClick={() => { setProjectId(p.id); setView('leads') }}>{p.id === projectId ? 'Åpne prosjekt' : 'Bytt til prosjekt'}<ArrowRight /></Button></section>)}</div>}
          <footer className="page-footer"><span>hub <strong>CRM</strong> <span className="footer-dot">·</span> Bygget for en bedre salgsdag.</span><span><ShieldCheck size={13} />Ett prosjekt. Riktig tilgang.</span></footer>
        </>}
      </main>
    </div>
    {notice && <div className="toast" role="status"><CheckCircle2 size={19} />{notice}<button onClick={() => setNotice('')} aria-label="Lukk varsel"><X size={16} /></button></div>}
    <Dialog open={!!selected && !modal} onOpenChange={open => { if (!open) setSelected(null) }} title={selected?.company || 'Lead'} description={`${selected?.contact || 'Ingen kontaktperson'} · ${selected?.city || project?.name || ''}`}>
      {selected && <div className="lead-detail"><div className="detail-tags"><Badge status={selected.status} /><span className="badge">{selected.kind.toUpperCase()}</span></div><div className="research-box"><span><Sparkles size={16} />Samtalegrunnlag {demo && '· eksempel'}</span><p>{selected.summary || 'Ingen oppsummering tilgjengelig ennå. Bekreft behov og beslutningstaker i samtalen.'}</p></div><div className={cn('eligibility-box', eligibility && !eligibility.allowed && 'blocked')}><ShieldCheck size={18} /><span>{eligibility?.reason || 'Kontrollerer ringetillatelse…'}</span></div>{call ? <div className="call-outcomes"><h3>Hvordan gikk samtalen?</h3><p>{demo ? 'Ingen ekte samtale er startet.' : 'Registrer utfallet når samtalen er ferdig.'}</p><div className="outcome-grid">{[['answered', 'Svar'], ['no_answer', 'Ikke svar'], ['meeting', 'Møte'], ['sale', 'Salg'], ['declined', 'Ikke aktuell']].map(([id, label]) => <Button key={id} variant="outline" disabled={busy} onClick={() => logCall(id)}>{label}</Button>)}</div><label className="form-label">Ring tilbake<input type="datetime-local" value={callbackTime} onChange={e => setCallbackTime(e.target.value)} /></label><Button variant="outline" disabled={busy || !callbackTime} onClick={() => logCall('callback')}>Lagre tilbakekalling</Button><p className="muted text-xs">Møte og salg må også registreres fra leadkortet.</p></div> : <><Button className="w-full" disabled={busy || !online || !eligibility?.allowed || ['sold', 'declined'].includes(selected.status)} onClick={startCall}><Phone />{demo ? 'Simuler samtale' : 'Ring kontakt'}</Button><div className="detail-actions"><Button variant="outline" disabled={busy || !online || ['sold', 'declined'].includes(selected.status)} onClick={() => setModal('meeting')}><CalendarDays />Book møte</Button><Button variant="outline" disabled={busy || !online || ['sold', 'declined'].includes(selected.status)} onClick={() => setModal('sale')}><Plus />Registrer salg</Button></div></>}</div>}
    </Dialog>
    <Dialog open={modal === 'lead'} onOpenChange={open => !open && setModal(null)} title="Nytt lead" description={demo ? 'Bruk kun fiktive opplysninger i demonstrasjonen.' : 'Leadet knyttes til det aktive prosjektet.'}><form className="form-stack" onSubmit={submitLead}><label>Bedrift / navn<input name="company" required maxLength={200} placeholder="Bedrift AS" /></label><label>Kontaktperson<input name="contact" maxLength={200} placeholder="Fornavn Etternavn" /></label><div className="form-columns"><label>Telefon<input name="phone" type="tel" required pattern="\+[1-9][0-9]{7,14}" placeholder="+47…" /></label><label>Type<select name="kind"><option value="b2b">Bedrift (B2B)</option><option value="b2c">Forbruker (B2C)</option></select></label></div><label>Organisasjonsnummer (valgfritt)<input name="org_number" inputMode="numeric" pattern="[0-9]{9}" placeholder="9 siffer" /></label><Button disabled={busy || !online}>{busy && <Loader2 className="animate-spin" />}Legg til lead</Button></form></Dialog>
    <Dialog open={modal === 'sale'} onOpenChange={open => !open && setModal(null)} title="Registrer salg" description={`${selected?.company || ''} · Fordelingen beregnes fra produktets gjeldende regel.`}><form className="form-stack" onSubmit={submitSale}><label>Produkt<select name="product" required>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {money(p.price_ore)}</option>)}</select></label><div className="research-box"><p>Salget sendes til godkjenning. For B2C kreves også dokumentert skriftlig aksept. Dette registrerer ikke en utbetaling.</p></div><Button disabled={busy || !online || !products.length}>Registrer og send til godkjenning</Button></form></Dialog>
    <Dialog open={modal === 'meeting'} onOpenChange={open => !open && setModal(null)} title="Book kvalifiseringsmøte" description={`${selected?.company || ''} · 30 minutter. Kalenderutsending er foreløpig ikke aktivert.`}><form className="form-stack" onSubmit={submitMeeting}><label>Tidspunkt<input name="starts" type="datetime-local" required /></label><label>Closer<select name="closer" required><option value="">Velg closer</option>{closers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Behov<input name="needs" required maxLength={1000} placeholder="Hva ønsker kunden å oppnå?" /></label><div className="form-columns"><label>Budsjett<input name="budget" required maxLength={200} /></label><label>Beslutningstaker<input name="decision" required maxLength={200} /></label></div><label>Tidslinje<input name="timeline" required maxLength={200} /></label><Button disabled={busy || !online}>Registrer møte <CalendarDays /></Button></form></Dialog>
    <Dialog open={modal === 'help'} onOpenChange={open => !open && setModal(null)} title="Velkommen til Hub CRM" description="Første implementering av den mobile arbeidsflaten."><div className="help-copy"><p>Velg prosjekt, åpne et lead og start en samtale. Ringetillatelse kontrolleres på serveren før et ekte anrop.</p><p>Demonstrasjonen har bare fiktive data. Den ringer ingen numre og sender ingen meldinger. Data nullstilles ved prosjektbytte eller oppdatering.</p><p>Integrasjoner, full lønnsmotor, kvitteringsvedlegg og B2C-bekreftelser er fortsatt under utvikling. Ingen produksjonsutbetalinger er aktivert.</p></div></Dialog>
  </div>
}
