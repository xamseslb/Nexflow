import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowRight, CalendarDays, CheckCircle2, ChevronRight, CircleHelp, Clock3, LayoutDashboard, Loader2, LogOut, Menu, Phone, Plus, Search, ShieldCheck, Sparkles, Wallet, X, BriefcaseBusiness, BarChart3, ListTodo, RefreshCw } from 'lucide-react'
import { CallQueues } from '@/components/CallQueues'
import { CustomerWorkspace } from '@/components/CustomerWorkspace'
import { SalesPortfolio } from '@/components/SalesPortfolio'
import { SaleDocuments } from '@/components/SaleDocuments'
import { ProjectSettings } from '@/components/ProjectSettings'
import { ProjectAccess } from '@/components/ProjectAccess'
import { CallHistory, type CallEntry } from '@/components/CallHistory'
import { ConsoleOverview } from '@/components/ConsoleOverview'
import { Reports } from '@/components/Reports'
import { FollowUps, LeadActivity, type FollowUpTask } from '@/components/FollowUps'
import { MeetingActions, meetingOutcomeLabel } from '@/components/MeetingActions'
import { Login } from '@/components/Login'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { money, cn } from '@/lib/utils'
import { apiUrl, request, supabase, demoProjects, demoLeads, demoProducts, demoSales, initialMeetings, type Project, type Lead, type Sale, type Product, type Meeting } from '@/lib/api'

type View = 'overview' | 'leads' | 'meetings' | 'sales' | 'projects' | 'reports' | 'tasks' | 'queues' | 'customers'
const labels: Record<string, string> = { new: 'Ny', callback: 'Ring tilbake', meeting: 'Møte booket', sold: 'Salg', declined: 'Ikke aktuell', blocked: 'Sperret', registered: 'Til godkjenning', approved: 'Godkjent', awaiting_confirmation: 'Venter på bekreftelse' }
const navigation: { id: View; label: string; icon: typeof Phone }[] = [
  { id: 'overview', label: 'Oversikt', icon: LayoutDashboard }, { id: 'leads', label: 'Ringeliste', icon: Phone },
  { id: 'queues', label: 'Ringekøer', icon: Phone }, { id: 'customers', label: 'Kunder', icon: BriefcaseBusiness },
  { id: 'meetings', label: 'Møter', icon: CalendarDays }, { id: 'sales', label: 'Salg og opptjening', icon: Wallet }, { id: 'projects', label: 'Prosjekter', icon: BriefcaseBusiness }, { id: 'tasks', label: 'Oppfølging', icon: ListTodo }, { id: 'reports', label: 'Rapporter', icon: BarChart3 }
]

function Badge({ status }: { status: string }) { return <span className={cn('badge', `badge-${status}`)}>{labels[status] || status}</span> }
function initials(name: string) { return name.split(' ').slice(0, 2).map(x => x[0]).join('') }
function dateLabel(value: string) { return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }

export default function App() {
  const [demo, setDemo] = useState(import.meta.env.VITE_DEMO_MODE === 'true')
  const [authenticated, setAuthenticated] = useState(false)
  const [restoringSession, setRestoringSession] = useState(Boolean(supabase))
  const navRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<View>('overview')
  const [demoTasks, setDemoTasks] = useState<FollowUpTask[]>([])
  const [openedWorkspaces, setOpenedWorkspaces] = useState({ queues: '', customers: '' })
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const activeProject = useRef(projectId)
  activeProject.current = projectId
  const [leads, setLeads] = useState<Lead[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [closers, setClosers] = useState<{ id: string; name: string }[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  function openLeadList(nextFilter = 'all') {
    setSearch('')
    setFilter(nextFilter)
    setView('leads')
  }
  useEffect(() => { window.scrollTo(0, 0) }, [view])
  const [leadLayout, setLeadLayout] = useState<'board' | 'list'>('board')
  const [selected, setSelected] = useState<Lead | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)
  const [projectAttempt, setProjectAttempt] = useState(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const returnToLead = useRef(true)
  const [pickQuery, setPickQuery] = useState('')
  const [modal, setModal] = useState<'lead' | 'sale' | 'meeting' | 'help' | 'pick-meeting' | 'pick-sale' | null>(null)
  const [call, setCall] = useState<{ id: string; phone: string } | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [eligibility, setEligibility] = useState<{ allowed: boolean; reason: string } | null>(null)
  const [callNote, setCallNote] = useState('')
  const [demoHistory, setDemoHistory] = useState<Record<string, CallEntry[]>>({})
  const [callbackTime, setCallbackTime] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      setAuthenticated(Boolean(data.session))
      if (error) setError('Kunne ikke hente innloggingen. Prøv å logge inn på nytt.')
    }).catch(() => active && setError('Kunne ikke hente innloggingen. Prøv igjen.')).finally(() => active && setRestoringSession(false))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setAuthenticated(Boolean(session)))
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    if (!authenticated && !demo) {
      setProjectId(''); setProjects([]); setLeads([]); setSales([])
      setMeetings([]); setProducts([]); setSelected(null); setModal(null)
    }
  }, [authenticated, demo])
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
  }, [demo, authenticated, projectAttempt])

  useEffect(() => {
    if (!sidebar) return
    const nav = navRef.current
    nav?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus()
    const media = window.matchMedia('(min-width:1121px)')
    const resize = () => { if (media.matches) setSidebar(false) }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebar(false)
      if (event.key !== 'Tab' || !nav) return
      const buttons = nav.querySelectorAll<HTMLButtonElement>('button')
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handleKey)
    media.addEventListener('change', resize)
    return () => {
      document.removeEventListener('keydown', handleKey); media.removeEventListener('change', resize)
      menuRef.current?.focus({preventScroll: true})
    }
  }, [sidebar])

  async function loadProject(id: string) {
    const root = `/projects/${id}`
    const [l, s, p, m] = await Promise.all([request<Lead[]>(`${root}/leads`), request<Sale[]>(`${root}/sales`), request<Product[]>(`${root}/products`), request<Meeting[]>(`${root}/meetings`)])
    return { l, s, p, m }
  }
  useEffect(() => {
    let cancelled = false
    setOpenedWorkspaces({ queues: '', customers: '' }); setDemoHistory({}); setDemoTasks([])
    setSelected(null); setCall(null); setSearch(''); setFilter('all'); setError(''); setModal(null); setPickQuery('')
    if (!projectId) return
    setLeads([]); setSales([]); setMeetings([]); setProducts([])
    if (demo) { setLeads(projectId === 'demo-1' ? structuredClone(demoLeads) : []); setSales(projectId === 'demo-1' ? structuredClone(demoSales) : []); setProducts(demoProducts); setMeetings(projectId === 'demo-1' ? initialMeetings() : []); return }
    setLoading(true)
    loadProject(projectId).then(({ l, s, p, m }) => { if (!cancelled) { setLeads(l); setSales(s); setProducts(p); setMeetings(m) } }).catch(e => !cancelled && setError(e.message)).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [projectId, demo])
  useEffect(() => {
    let cancelled = false
    setEligibility(null); setCall(null); setCallNote(''); setCallbackTime('')
    if (!selected || projects.find(p => p.id === projectId)?.role === 'partner') return
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

  useEffect(() => {
    const role = projects.find(p => p.id === projectId)?.role
    if (!role) return
    setView(current => (current === 'reports' && !['leader', 'admin'].includes(role)) || (['tasks', 'queues', 'customers'].includes(current) && role === 'partner') ? 'overview' : current)
  }, [projectId, projects])

  const project = projects.find(p => p.id === projectId)
  const filtered = useMemo(() => leads.filter(l => (filter === 'all' || (filter === 'available' ? !l.blocked && ['new', 'callback'].includes(l.status) : !l.blocked && l.status === filter)) && `${l.company} ${l.contact} ${l.city}`.toLowerCase().includes(search.toLowerCase())), [leads, filter, search])
  const candidates = leads.filter(l => !['sold','declined'].includes(l.status) && (l.company + ' ' + l.contact).toLowerCase().includes(pickQuery.trim().toLowerCase()))
  const earnings = sales.reduce((s, x) => s + x.allocation.seller, 0)
  const root = `/projects/${projectId}`
  const manager = project && ['leader', 'admin'].includes(project.role)
  const operator = Boolean(project && ['seller', 'booker', 'closer', 'leader', 'admin'].includes(project.role))
  const canSell = Boolean(project && ['seller', 'closer', 'leader', 'admin'].includes(project.role))

  useEffect(() => { setError('') }, [modal, selected?.id])
  async function action(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Noe gikk galt') } finally { setBusy(false) }
  }
  async function refresh() {
    if (demo) return
    const { l, s, p, m } = await loadProject(projectId)
    if (activeProject.current === projectId) { setLeads(l); setSales(s); setProducts(p); setMeetings(m) }
  }
  async function login(email: string, password: string) {
    await action(async () => {
      if (!supabase) throw new Error('Innlogging er ikke konfigurert ennå.')
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        if (error.code === 'invalid_credentials') throw new Error('E-postadressen eller passordet er feil. Prøv igjen.')
        if (error.status === 429) throw new Error('For mange forsøk. Vent litt før du prøver igjen.')
        throw new Error('Kunne ikke logge inn. Kontroller forbindelsen og prøv igjen.')
      }
    })
  }
  async function logout() {
    await action(async () => {
      if (authenticated && supabase) {
        const { error } = await supabase.auth.signOut()
        if (error) throw new Error('Kunne ikke logge ut. Prøv igjen.')
      }
      setAuthenticated(false); setDemo(false); setProjectId(''); setProjects([])
      setLeads([]); setSales([]); setMeetings([]); setProducts([]); setSelected(null)
      setModal(null); setView('overview'); setNotice('')
    })
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
      if (outcome === 'callback' && new Date(callbackTime) <= new Date()) throw new Error('Velg et fremtidig tidspunkt')
      if (demo) {
        const entry = { id: crypto.randomUUID(), completed_at: new Date().toISOString(), outcome, note: callNote.trim() }
        setDemoHistory(history => ({ ...history, [selected.id]: [entry, ...(history[selected.id] || [])] }))
        setLeads(ls => ls.map(l => l.id === selected.id && ['callback', 'declined'].includes(outcome) ? { ...l, status: outcome, callback_at: outcome === 'callback' ? new Date(callbackTime).toISOString() : null } : l)) }
      else await request(`${root}/calls/${call.id}`, { method: 'PATCH', body: JSON.stringify({ outcome, note: callNote.trim(), callback_at: outcome === 'callback' ? new Date(callbackTime).toISOString() : null }) })
      setCall(null)
      if (outcome === 'meeting' || (outcome === 'sale' && canSell)) { returnToLead.current = true; setModal(outcome) }
      else setSelected(null)
      setNotice('Samtaleutfallet er registrert'); await refresh()
    })
  }
  function closeRegistration() {
    setModal(null)
    if (!returnToLead.current) setSelected(null)
    returnToLead.current = true
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

  if (!demo && (!authenticated || restoringSession)) return <Login configured={Boolean(supabase)} restoring={restoringSession} busy={busy} error={error} onLogin={login} onDemo={() => { setDemo(true); setError(''); setView('overview') }} />

  return <div className="app-shell">
    {sidebar && <button className="sidebar-overlay" aria-label="Lukk meny" onClick={() => setSidebar(false)} />}
    <header className="console-header">
      <a href="#" className="brand" onClick={e => { e.preventDefault(); setView('overview'); setSidebar(false) }}><span className="brand-icon">n</span>Nexflow<span className="brand-sub">CRM</span></a>
      <nav ref={navRef} id="workspace-menu" aria-label="Hovedmeny" className={cn('console-nav', sidebar && 'console-nav-open')}>
        <div className="mobile-nav-title"><span>Arbeidsområde</span><button aria-label="Lukk navigasjon" onClick={() => setSidebar(false)}><X size={20} /></button></div>
        {navigation.filter(item => (item.id !== 'reports' || manager) && (!['tasks', 'queues', 'customers'].includes(item.id) || operator)).map(item => <button key={item.id} className={cn('nav-item', view === item.id && 'active')} aria-current={view === item.id ? 'page' : undefined} onClick={() => { setView(item.id); if (item.id === 'queues' || item.id === 'customers') setOpenedWorkspaces(prev => ({ ...prev, [item.id]: projectId })); setSearch(''); setFilter('all'); setSelected(null); setSidebar(false) }}><item.icon size={17} /><span>{item.label}</span>{item.id === 'meetings' && meetings.length > 0 && <span className="nav-count">{meetings.length}</span>}</button>)}
      </nav>
      <div className="console-header-tools">
        {!demo && <button className="console-tool refresh-tool" aria-label="Oppdater prosjekt" disabled={busy || loading || !projectId} onClick={() => action(async () => { await refresh(); setRefreshCount(n => n + 1); setNotice('Prosjektet er oppdatert.') })}><RefreshCw size={18} /></button>}
        <button className="console-tool" aria-label="Vis informasjon" onClick={() => setModal('help')}><CircleHelp size={19} /></button>
        <div className="console-identity"><span>PARTNERHUBEN</span><strong>{demo ? 'Demonstrasjon' : project?.role || 'Innlogget'}</strong></div>
        <button className="console-user" aria-label="Logg ut" title="Logg ut" disabled={busy} onClick={logout}><span>{demo ? 'DE' : 'DU'}</span><LogOut size={14} /></button>
        <button ref={menuRef} aria-controls="workspace-menu" className="mobile-menu" aria-label="Åpne meny" aria-expanded={sidebar} onClick={() => setSidebar(true)}><Menu size={22} /></button>
      </div>
    </header>
    <div className="main-shell" inert={sidebar}>
      {demo && <div className="demo-banner"><span><span className="demo-dot" />Demo · Fiktive data i denne økten</span><button disabled={busy} onClick={logout}>Avslutt demo <X size={13} /></button></div>}
      {!online && <div className="error-banner">Du er frakoblet. Ringing og registrering krever nettilgang.</div>}
      {error && !modal && !selected && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="Lukk feilmelding"><X size={16} /></button></div>}
      <main className="content">
        <div className="page-heading"><div><h1>{view === 'overview' ? 'Oversikt' : navigation.find(n => n.id === view)?.label}</h1><p>{view === 'overview' ? 'Aktivitet og neste steg i prosjektet.' : view === 'leads' ? 'Søk, prioriter og følg opp kontaktene i prosjektet.' : view === 'queues' ? 'Velg en ringeliste og arbeid gjennom kontaktene i rekkefølge.' : view === 'customers' ? 'Kontaktinformasjon, salgsfremdrift og historikk.' : view === 'meetings' ? 'Bookede møter og kvalifisering for gjeldende prosjekt.' : view === 'sales' ? 'Følg salgene og opptjeningen din, hele veien.' : view === 'reports' ? 'Aktivitet, salgsutvikling og fordeling i prosjektet.' : view === 'tasks' ? 'Planlegg neste steg og følg opp kontaktene i tide.' : 'Velg prosjekt og se hvilke arbeidsområder du har tilgang til.'}</p></div><div className="heading-actions"><span className={cn('connection', !online && 'offline')}><i />{online ? 'På nett' : 'Frakoblet'}</span><label className="project-picker"><BriefcaseBusiness size={16} /><select aria-label="Aktivt prosjekt" disabled={busy} value={projectId} onChange={e => setProjectId(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{['overview', 'leads', 'customers'].includes(view) && operator && <Button disabled={!project?.active || !online} onClick={() => setModal('lead')}><Plus />Nytt lead</Button>}
          {((view === 'meetings' && operator) || (view === 'sales' && canSell)) && <Button disabled={!project?.active || !online} onClick={() => { setPickQuery(''); setModal(view === 'meetings' ? 'pick-meeting' : 'pick-sale') }}><Plus />{view === 'meetings' ? 'Book møte' : 'Registrer salg'}</Button>}</div></div>
        {loading ? <div className="empty-state"><Loader2 className="animate-spin" /><h3>Henter arbeidsdagen din…</h3></div> : !project ? <div className="empty-state"><BriefcaseBusiness /><h3>Ingen tilgjengelige prosjekter</h3><p>{error ? 'Prosjektlisten kunne ikke hentes.' : 'En administrator må tildele deg et prosjekt.'}</p><Button variant="outline" onClick={() => { setError(''); setProjectAttempt(n => n + 1) }}>Hent prosjekter på nytt</Button></div> : <>
          {operator && (view === 'queues' || (demo && openedWorkspaces.queues === projectId)) && <div hidden={view !== 'queues'}>
            <CallQueues key={projectId + ':' + refreshCount} project={project} leads={leads} demo={demo} onRefresh={refresh} demoHistory={demoHistory}
              dispositionOpen={Boolean(selected || modal)} onDisposition={(lead, kind) => { returnToLead.current = false; setSelected(lead); setModal(kind) }}
              onDemoCall={(leadId, entry, callbackAt) => {
                setDemoHistory(h => ({ ...h, [leadId]: [entry, ...(h[leadId] || [])] }))
                if (['callback', 'declined'].includes(entry.outcome)) setLeads(ls => ls.map(l => l.id === leadId ? { ...l, status: entry.outcome, callback_at: callbackAt } : l))
              }} />
          </div>}
          {operator && (view === 'customers' || (demo && openedWorkspaces.customers === projectId)) && <div hidden={view !== 'customers'}>
            <CustomerWorkspace demoTasks={demoTasks} key={projectId + ':' + refreshCount} projectId={projectId} demo={demo} role={project.role} leads={leads} onLead={setSelected} sales={sales} meetings={meetings} demoCalls={demoHistory} />
          </div>}
          {view === 'overview' && <ConsoleOverview leads={leads} meetings={meetings} sales={sales} onLeads={openLeadList} onMeetings={() => setView('meetings')} onSales={() => setView('sales')} />}
          {(view === 'overview' || view === 'leads') && <section className="panel leads-panel"><div className="panel-heading"><div><h2>{view === 'overview' ? 'Neste i ringelisten' : 'Alle leads'} <span className="count-pill">{filtered.length}</span></h2><p>{view === 'overview' ? 'Prioritert og klar for din neste samtale.' : project.description}</p></div>{view === 'overview' && <button className="text-link" onClick={() => openLeadList()}>Se hele listen <ArrowRight size={15} /></button>}</div><div className="table-toolbar"><div className="tabs">{!['all', 'available', 'callback'].includes(filter) && <button className="selected" onClick={() => setFilter('all')}>{labels[filter] || filter} <X size={12} /></button>}<button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Alle leads</button><button className={filter === 'available' ? 'selected' : ''} onClick={() => setFilter('available')}>Klar til samtale</button><button className={filter === 'callback' ? 'selected' : ''} onClick={() => setFilter('callback')}>Ring tilbake</button></div><label className="search-input"><Search size={16} /><input aria-label="Søk i leads" placeholder="Søk etter bedrift eller kontakt…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>{view === 'leads' && <div className="view-switch" aria-label="Visning av leads"><button type="button" aria-pressed={leadLayout === 'board'} onClick={() => setLeadLayout('board')}>Tavle</button><button type="button" aria-pressed={leadLayout === 'list'} onClick={() => setLeadLayout('list')}>Liste</button>{leadLayout === 'board' && <span className="board-hint">Bla sidelengs for flere statuser</span>}</div>}{view === 'leads' && leadLayout === 'board' ? <div className="board-scroll"><div className="lead-board">{[['new', 'Nye'], ['callback', 'Ring tilbake'], ['meeting', 'Møte booket'], ['sold', 'Solgt'], ['declined', 'Ikke aktuell'], ['blocked', 'Sperret'], ['other', 'Andre']].map(([status, title]) => { const items = filtered.slice(0, 500).filter(lead => status === 'blocked' ? lead.blocked : !lead.blocked && (status === 'other' ? !['new', 'callback', 'meeting', 'sold', 'declined'].includes(lead.status) : lead.status === status)); return <section className={`board-column board-${status}`} key={status} aria-label={title}><div className="board-heading"><h3>{title}</h3><span>{items.length}</span></div><div className="board-items">{items.map(lead => <button className="board-card" key={lead.id} onClick={() => setSelected(lead)}><span className="board-card-top"><span className="board-card-name">{lead.company}</span><ChevronRight size={15} /></span><span className="board-contact">{lead.contact || 'Ingen kontaktperson'}</span><span className="board-company">{lead.industry || 'Ikke beriket'}{lead.city ? ` · ${lead.city}` : ''}</span><span className="board-card-footer"><span className="board-avatar">{initials(lead.company)}</span><span>{lead.kind.toUpperCase()}</span><Badge status={lead.blocked ? 'blocked' : lead.status} /></span></button>)}{items.length === 0 && <p className="board-empty">Ingen leads</p>}</div></section>})}</div></div> : <div className="lead-table"><div className="lead-row table-header"><span>BEDRIFT / KONTAKT</span><span>BRANSJE</span><span>STATUS</span><span>PRIORITET</span><span /></div>{filtered.slice(0, view === 'overview' ? 4 : 500).map((lead, index) => <button className="lead-row" key={lead.id} onClick={() => setSelected(lead)}><div className="company-cell"><div className={`company-avatar color-${index % 4}`}>{initials(lead.company)}</div><div><strong>{lead.company}</strong><small>{lead.contact || 'Ingen kontaktperson'}{lead.city ? ` · ${lead.city}` : ''}</small></div></div><span className="industry-cell">{lead.industry || 'Ikke beriket'}</span><span><Badge status={lead.blocked ? 'blocked' : lead.status} />{lead.blocked && <span className="sr-only">Sperret</span>}</span><span className="priority-cell"><span className={cn('priority-dot', lead.priority >= 90 && 'high')} />{lead.priority >= 90 ? 'Høy' : 'Normal'}</span><ChevronRight size={17} /></button>)}{filtered.length === 0 && <div className="empty-state"><Search /><h3>Ingen leads å vise</h3><p>Prøv et annet søk eller legg til ditt første lead.</p></div>}</div>}<div className="table-footer"><span>{view === 'overview' ? Math.min(filtered.length, 4) : filtered.length} av {leads.length} leads</span><span><ShieldCheck size={13} />Prosjektisolerte data</span></div></section>}
          {view === 'meetings' && <div className="meeting-grid">{meetings.map(m => <section className="panel meeting-card" key={m.id}><div className="panel-heading"><span className="stat-icon purple"><CalendarDays size={19} /></span><span className="badge badge-meeting">{meetingOutcomeLabel(m.outcome)}</span></div><h2>{leads.find(l => l.id === m.lead_id)?.company || 'Kvalifiseringsmøte'}</h2><p><Clock3 size={15} />{dateLabel(m.starts_at)}</p><dl>{Object.entries(m.qualification).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || 'Ikke oppgitt'}</dd></div>)}</dl><MeetingActions meeting={m} projectId={projectId} company={leads.find(l => l.id === m.lead_id)?.company || 'Kvalifiseringsmøte'} demo={demo} role={project.role} sold={leads.some(l => l.id === m.lead_id && l.status === 'sold')} onChange={outcome => setMeetings(rows => rows.map(row => row.id === m.id ? { ...row, outcome } : row))} /></section>)}{!meetings.length && <div className="empty-state panel"><CalendarDays /><h3>Plass til nye muligheter</h3><p>Åpne et lead og velg «Book møte».</p><Button onClick={() => openLeadList()}>Gå til ringelisten <ArrowRight /></Button></div>}</div>}
          {view === 'sales' && <><div className="sales-summary"><div><span className="eyebrow">REGISTRERT OPPTJENING</span><h2>{money(earnings)}</h2><p>Foreløpig provisjon. Godkjenning og vilkår avgjør utbetaling.</p></div><Button variant="outline" disabled={busy || !manager || (!demo && !online)} onClick={exportSales}><ArrowDownToLine />Eksporter CSV</Button></div><section className="panel"><div className="panel-heading"><h2>Salg i prosjektet</h2><span className="count-pill">{sales.length}</span></div>{sales.map(s => <div className="sale-row" key={s.id}><div className="company-avatar color-0"><CheckCircle2 size={22} /></div><div><strong>{leads.find(l => l.id === s.lead_id)?.company || 'Salg'}</strong><small>{dateLabel(s.created_at)}</small></div><div><strong>{money(s.amount_ore)}</strong><small>Provisjon {money(s.allocation.seller)}</small></div><Badge status={s.status} />{(manager || s.can_manage_documents) && <SaleDocuments key={s.id} project={project} sale={s} demo={demo} />}{manager && s.status === 'registered' && <Button variant="outline" size="sm" disabled={busy} onClick={() => action(async () => { if (demo) setSales(ss => ss.map(x => x.id === s.id ? { ...x, status: 'approved' } : x)); else await request(`${root}/sales/${s.id}/approve`, { method: 'POST' }); setNotice('Salget er godkjent'); await refresh() })}>Godkjenn</Button>}</div>)}{!sales.length && <div className="empty-state"><Wallet /><h3>Her vokser resultatene dine</h3><p>Registrer et salg fra leadkortet.</p></div>}</section></>}
          {view === 'projects' ? <section key="projects" aria-label="Prosjektadministrasjon">
            <div className="project-grid">{projects.map((p, i) => <section className="panel project-card" key={p.id}><div className="panel-heading"><span className={`company-avatar color-${i}`}><BriefcaseBusiness size={23} /></span><span className="badge badge-new">{p.active ? 'Aktivt' : 'Pauset'}</span></div><h2>{p.name}</h2><p>{p.description}</p><div className="project-meta"><span>{p.kind.toUpperCase()}</span><span>Din rolle: {p.role}</span></div><ProjectSettings project={p} demo={demo} onSaved={value => setProjects(rows => rows.map(row => row.id === p.id ? { ...row, project_type: value } : row))} /><Button variant={p.id === projectId ? 'outline' : 'default'} onClick={() => { setProjectId(p.id); setView('leads') }}>{p.id === projectId ? 'Åpne prosjekt' : 'Bytt til prosjekt'}<ArrowRight /></Button></section>)}</div>
            {manager && !demo && <ProjectAccess key={'ProjectAccess:' + projectId + ':' + refreshCount} projectId={projectId} admin={project.role === 'admin'} projects={projects} />}
          </section> : view === 'reports' && manager ? <section key="reports" aria-label="Prosjektrapporter">
            <SalesPortfolio key={'SalesPortfolio:' + projectId + ':' + refreshCount} projects={projects} currentProject={projectId} demo={demo} demoSales={sales} demoLeads={leads} demoHistory={demoHistory} demoMeetings={meetings} />
            <Reports key={'Reports:' + projectId + ':' + refreshCount} projectId={projectId} demo={demo} />
          </section> : view === 'tasks' && operator ? <section key="tasks" aria-label="Oppfølgingsoppgaver">
            <FollowUps demoTasks={demoTasks} setDemoTasks={setDemoTasks} key={'tasks:' + projectId + ':' + refreshCount} projectId={projectId} demo={demo} manager={Boolean(manager)} leads={leads} onLead={setSelected} />
          </section> : null}

        </>}
      </main>
    </div>
    {notice && <div className="toast" role="status"><CheckCircle2 size={19} />{notice}<button onClick={() => setNotice('')} aria-label="Lukk varsel"><X size={16} /></button></div>}
    <Dialog open={!!selected && !modal} onOpenChange={open => { if (!open) setSelected(null) }} title={selected?.company || 'Lead'} description={`${selected?.contact || 'Ingen kontaktperson'} · ${selected?.city || project?.name || ''}`}>
      {selected && <div className="lead-detail">{error && <p role="alert" className="form-error">{error}</p>}<div className="detail-tags"><Badge status={selected.status} /><span className="badge">{selected.kind.toUpperCase()}</span></div><div className="research-box"><span><Sparkles size={16} />Samtalegrunnlag {demo && '· eksempel'}</span><p>{selected.summary || 'Ingen oppsummering tilgjengelig ennå. Bekreft behov og beslutningstaker i samtalen.'}</p></div>{operator && <CallHistory key={`${projectId}:${selected.id}`} projectId={projectId} leadId={selected.id} demoEntries={demo ? demoHistory[selected.id] || [] : undefined} manager={Boolean(manager)} />}<div className={cn('eligibility-box', eligibility && !eligibility.allowed && 'blocked')}><ShieldCheck size={18} /><span>{eligibility?.reason || (operator ? 'Kontrollerer ringetillatelse…' : 'Din rolle gir lesetilgang til kontakten.')}</span></div>{call ? <div className="call-outcomes"><h3>Hvordan gikk samtalen?</h3><p>{demo ? 'Ingen ekte samtale er startet.' : 'Registrer utfallet når samtalen er ferdig.'}</p><label className="form-label">Samtalenotat<textarea rows={3} maxLength={4000} value={callNote} onChange={e => setCallNote(e.target.value)} placeholder="Kundens behov, innvendinger og avtalt neste steg" /></label><div className="outcome-grid">{[['answered', 'Svar'], ['no_answer', 'Ikke svar'], ['meeting', 'Møte'], ['sale', 'Salg'], ['declined', 'Ikke aktuell']].map(([id, label]) => <Button key={id} variant="outline" disabled={busy} onClick={() => logCall(id)}>{label}</Button>)}</div><label className="form-label">Ring tilbake<input type="datetime-local" value={callbackTime} onChange={e => setCallbackTime(e.target.value)} /></label><Button variant="outline" disabled={busy || !callbackTime} onClick={() => logCall('callback')}>Lagre tilbakekalling</Button><p className="muted text-xs">Ved møte eller salg åpnes registreringen etter lagring når rollen din tillater det.</p></div> : <><Button className="w-full" disabled={busy || !operator || !online || !eligibility?.allowed || ['sold', 'declined'].includes(selected.status)} onClick={startCall}><Phone />{demo ? 'Simuler samtale' : 'Ring kontakt'}</Button><div className="detail-actions"><Button variant="outline" disabled={busy || !operator || !online || ['sold', 'declined'].includes(selected.status)} onClick={() => { returnToLead.current = true; setModal('meeting') }}><CalendarDays />Book møte</Button><Button variant="outline" disabled={busy || !canSell || !online || ['sold', 'declined'].includes(selected.status)} onClick={() => { returnToLead.current = true; setModal('sale') }}><Plus />Registrer salg</Button></div></>}{operator && <LeadActivity key={`${projectId}:${selected.id}`} projectId={projectId} leadId={selected.id} demo={demo} />}</div>}
    </Dialog>
    <Dialog open={modal === 'pick-sale' || modal === 'pick-meeting'} onOpenChange={open => !open && setModal(null)} title="Velg kontakt" description={modal === 'pick-sale' ? 'Velg kunden du skal registrere salget på.' : 'Velg kunden du skal booke møtet med.'}>
      <div className="contact-picker"><label className="search-input"><Search size={16}/><input aria-label="Finn kontakt" value={pickQuery} placeholder="Bedrift eller kontaktperson" onChange={e => setPickQuery(e.target.value)}/></label>
        {candidates.map(l => <button key={l.id} onClick={() => { returnToLead.current = false; setSelected(l); setModal(modal === 'pick-sale' ? 'sale' : 'meeting') }}><span><strong>{l.company}</strong><small>{l.contact}</small></span><ChevronRight size={16}/></button>)}
        {!candidates.length && <p>Ingen åpne leads samsvarer med søket.</p>}
      </div>
    </Dialog>
    <Dialog open={modal === 'lead'} onOpenChange={open => !open && setModal(null)} title="Nytt lead" description={demo ? 'Bruk kun fiktive opplysninger i demonstrasjonen.' : 'Leadet knyttes til det aktive prosjektet.'}><form className="form-stack" onSubmit={submitLead}>{error && <p role="alert" className="form-error">{error}</p>}<label>Bedrift / navn<input name="company" required maxLength={200} placeholder="Bedrift AS" /></label><label>Kontaktperson<input name="contact" maxLength={200} placeholder="Fornavn Etternavn" /></label><div className="form-columns"><label>Telefon<input name="phone" type="tel" required pattern="\+[1-9][0-9]{7,14}" placeholder="+47…" /></label><label>Type<select name="kind"><option value="b2b">Bedrift (B2B)</option><option value="b2c">Forbruker (B2C)</option></select></label></div><label>Organisasjonsnummer (valgfritt)<input name="org_number" inputMode="numeric" pattern="[0-9]{9}" placeholder="9 siffer" /></label><Button disabled={busy || !online}>{busy && <Loader2 className="animate-spin" />}Legg til lead</Button></form></Dialog>
    <Dialog open={modal === 'sale'} onOpenChange={open => !open && closeRegistration()} title="Registrer salg" description={`${selected?.company || ''} · Fordelingen beregnes fra produktets gjeldende regel.`}><form className="form-stack" onSubmit={submitSale}>{error && <p role="alert" className="form-error">{error}</p>}<label>Produkt<select name="product" required>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {money(p.price_ore)}</option>)}</select></label><div className="research-box"><p>Salget sendes til godkjenning. For B2C kreves også dokumentert skriftlig aksept. Dette registrerer ikke en utbetaling.</p></div><Button disabled={busy || !online || !products.length}>Registrer og send til godkjenning</Button></form></Dialog>
    <Dialog open={modal === 'meeting'} onOpenChange={open => !open && closeRegistration()} title="Book kvalifiseringsmøte" description={`${selected?.company || ''} · 30 minutter. Kalenderutsending er foreløpig ikke aktivert.`}><form className="form-stack" onSubmit={submitMeeting}>{error && <p role="alert" className="form-error">{error}</p>}<label>Tidspunkt<input name="starts" type="datetime-local" required /></label><label>Closer<select name="closer" required><option value="">Velg closer</option>{closers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Behov<input name="needs" required maxLength={1000} placeholder="Hva ønsker kunden å oppnå?" /></label><div className="form-columns"><label>Budsjett<input name="budget" required maxLength={200} /></label><label>Beslutningstaker<input name="decision" required maxLength={200} /></label></div><label>Tidslinje<input name="timeline" required maxLength={200} /></label><Button disabled={busy || !online}>Registrer møte <CalendarDays /></Button></form></Dialog>
    <Dialog open={modal === 'help'} onOpenChange={open => !open && setModal(null)} title="Slik bruker du Nexflow" description="Ringelister, prosjekttilgang og demoløsningen."><div className="help-copy"><p>Velg prosjekt, åpne et lead og start en samtale. Ringetillatelse kontrolleres på serveren før et ekte anrop.</p><p>Demonstrasjonen har bare fiktive data. Den ringer ingen numre og sender ingen meldinger. Data nullstilles ved prosjektbytte eller oppdatering.</p><p>Eksterne integrasjoner, full lønnsmotor og B2C-bekreftelser er fortsatt under utvikling. Ingen produksjonsutbetalinger er aktivert.</p></div></Dialog>
  </div>
}
