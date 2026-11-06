import { useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, CalendarDays, ChevronRight, HandCoins, PhoneOutgoing, SlidersHorizontal, UsersRound } from 'lucide-react'
import { request, demoLeads as initialLeads, demoSales as initialSales, initialMeetings, type Lead, type Project, type Sale, type Meeting } from '@/lib/api'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import type { CallEntry } from './CallHistory'
import { PortfolioActivity, metricTitles, type ActivityRow, type Metric } from './PortfolioActivity'
import './salesPortfolio.css'

type Item = Sale & { project: string; project_id: string; company: string; product: string; seller_id: string; seller_name?: string; team: string | null }
type ProjectTotal = { project_id: string; project: string; count: number; total_ore: number }
type Result = { items: Item[]; teams: string[]; project_types: string[]; activity: { leads: number; calls: number; meetings: number; buyers: number }; per_project?: ProjectTotal[]; count: number; total_ore: number }
type Props = { projects: Project[]; currentProject: string; demo: boolean; demoSales: Sale[]; demoLeads: Lead[]; demoHistory: Record<string, CallEntry[]>; demoMeetings: Meeting[] }
type Filters = { project_id: string; project_type: string; kind: string; team: string }
const all: Filters = { project_id: '', project_type: '', kind: '', team: '' }
const formatMoney = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 2 })
const amount = (ore: number) => formatMoney.format(ore / 100)
const date = (value: string) => new Date(value).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo' })
const statusNames: Record<string, string> = { approved: 'Godkjent', registered: 'Til godkjenning', awaiting_confirmation: 'Venter på bekreftelse' }

function demoPortfolio(props: Props, filters: Filters, offset: number) {
  const managed = props.projects.filter(project => ['admin', 'leader'].includes(project.role))
  const typeOf = (project: Project) => project.project_type || ''
  const scoped = managed.filter(p => (!filters.project_id || p.id === filters.project_id) &&
    (!filters.kind || filters.kind === p.kind) && (!filters.project_type || typeOf(p) === filters.project_type))
  const rows: Item[] = [], perProject: ProjectTotal[] = []
  const details: Record<Metric, ActivityRow[]> = { leads: [], calls: [], meetings: [], buyers: [] }
  const teamOf = (id: string) => ['2', '5'].includes(id) ? 'Møtebooking' : 'Demoteam'
  const matchesTeam = (id: string) => !filters.team || teamOf(id) === filters.team
  const teams = new Set<string>()
  for (const project of scoped) {
    const selected = project.id === props.currentProject
    const leads = selected ? props.demoLeads : initialLeads.filter(l => l.project_id === project.id)
    const sales = (selected ? props.demoSales : project.id === 'demo-1' ? initialSales : []).filter(s => matchesTeam(s.lead_id))
    const meetings = selected ? props.demoMeetings : project.id === 'demo-1' ? initialMeetings() : []
    const saleCounts = new Map<string, number>()
    for (const sale of sales) saleCounts.set(sale.lead_id, (saleCounts.get(sale.lead_id) || 0) + 1)
    for (const lead of leads) {
      teams.add(teamOf(lead.id))
      if (!matchesTeam(lead.id)) continue
      const row = { id: lead.id, company: lead.company, project: project.name }
      details.leads.push({ ...row, detail: lead.contact })
      if (saleCounts.has(lead.id)) details.buyers.push({ ...row, sales: saleCounts.get(lead.id) })
      if (selected) for (const call of props.demoHistory[lead.id] || []) {
        details.calls.push({ ...row, id: call.id, detail: call.outcome, date: call.completed_at })
      }
    }
    for (const meeting of meetings.filter(m => matchesTeam(m.lead_id))) {
      details.meetings.push({ id: meeting.id, company: leads.find(l => l.id === meeting.lead_id)?.company || 'Demokunde',
        project: project.name, detail: meeting.outcome, date: meeting.starts_at })
    }
    if (sales.length) perProject.push({ project_id: project.id, project: project.name, count: sales.length, total_ore: sales.reduce((sum,sale) => sum + sale.amount_ore, 0) })
    for (const sale of sales) rows.push({ ...sale, project_id: project.id, project: project.name, seller_id: 'Demoselger', product: 'Produkt i demonstrasjonen', team: teamOf(sale.lead_id),
      company: leads.find(lead => lead.id === sale.lead_id)?.company || 'Demokunde' })
  }
  rows.sort((a,b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
  const activity = { leads: details.leads.length, calls: details.calls.length, meetings: details.meetings.length, buyers: details.buyers.length }
  return { details, teams: [...teams], project_types: [...new Set(managed.map(typeOf).filter(Boolean))].sort(), count: rows.length, items: rows.slice(offset, offset + 25), activity,
    per_project: perProject.sort((a,b) => b.total_ore - a.total_ore), total_ore: rows.reduce((sum, sale) => sum + sale.amount_ore, 0) }
}

export function SalesPortfolio(props: Props) {
  const { projects, currentProject, demo, demoSales, demoLeads, demoHistory, demoMeetings } = props
  const [filters, setFilters] = useState<Filters>(all)
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [metric, setMetric] = useState<Metric | null>(null)
  const [detail, setDetail] = useState<Item | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const demoData = useMemo(() => demo ? demoPortfolio({ projects, currentProject, demo, demoSales, demoLeads, demoHistory, demoMeetings }, filters, offset) : null,
    [projects, currentProject, demo, demoSales, demoLeads, demoHistory, demoMeetings, filters, offset])
  useEffect(() => {
    if (demo) return
    const controller = new AbortController()
    const params = new URLSearchParams({ offset: String(offset) })
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value) })
    setLoading(true); setError('')
    request<Result>(`/portfolio/sales?${params}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult(data) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [demo, offset, filters, version])
  function apply(key: keyof Filters, value: string) {
    setFilters(previous => ({ ...previous, [key]: value }))
    setOffset(0); setDetail(null)
  }
  const report = demo ? demoData : result
  const pending = !demo && loading
  const projectScope = projects.filter(p => ['admin','leader'].includes(p.role))
  const metrics = report && [
    { key: 'leads', value: report.activity.leads, icon: UsersRound },
    { key: 'calls', value: report.activity.calls, icon: PhoneOutgoing },
    { key: 'meetings', value: report.activity.meetings, icon: CalendarDays },
    { key: 'buyers', value: report.activity.buyers, icon: HandCoins }
  ] as const
  return <section className="pf-panel" aria-label="Lederoversikt">
    <header className="pf-head"><div><h2>Lederoversikt</h2><p>Aktivitet og salg i prosjektene du leder.</p></div><span>Hele perioden</span></header>
    <div className="pf-filters"><SlidersHorizontal aria-hidden="true" size={18} /><label>Prosjekt<select aria-label="Prosjekt" value={filters.project_id} onChange={e => apply('project_id', e.target.value)}>
      <option value="">Alle prosjekter</option>{projectScope.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Prosjekttype<select aria-label="Prosjekttype" value={filters.project_type} onChange={e => apply('project_type', e.target.value)}><option value="">Alle typer</option>
        {[...new Set([...(report?.project_types || []), ...(filters.project_type ? [filters.project_type] : [])])].map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Kundesegment<select aria-label="Kundesegment" value={filters.kind} onChange={e => apply('kind', e.target.value)}><option value="">Alle segmenter</option><option value="b2b">B2B</option><option value="b2c">B2C</option><option value="both">Blandet</option></select></label>
      <label>Team<select aria-label="Team" value={filters.team} onChange={e => apply('team', e.target.value)}><option value="">Alle team</option>
        {[...new Set([...(report?.teams || []), ...(filters.team ? [filters.team] : [])])].map(name => <option key={name}>{name}</option>)}</select></label>
    </div>
    {Object.values(filters).some(Boolean) && <div className="pf-selection"><span role="status">{[projectScope.find(p => p.id === filters.project_id)?.name, filters.project_type, filters.kind === 'both' ? 'Blandet' : filters.kind.toUpperCase(), filters.team].filter(Boolean).join(' · ')}</span><Button size="sm" variant="outline" onClick={() => { setFilters(all); setOffset(0) }}>Nullstill filtre</Button></div>}
    <div className="pf-body" aria-busy={pending}>{error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => setVersion(n => n+1)}>Prøv igjen</Button></div> :
      pending || !report ? <p>Henter lederoversikten…</p> : <>
        <div className="pf-activity"><div className="pf-total"><span>Salgsverdi eks. mva.</span><strong>{amount(report.total_ore)}</strong><small>{report.count} {report.count === 1 ? 'registrert salg' : 'registrerte salg'}</small></div>
          <div className="pf-metrics">{metrics?.map(({ key, value, icon: Icon }) =>
            <button type="button" key={key} aria-haspopup="dialog" onClick={() => setMetric(key)}>
              <span><Icon size={16} aria-hidden="true" />{metricTitles[key]}</span>
              <strong>{value.toLocaleString('nb-NO')}<ChevronRight size={16} aria-hidden="true" /></strong>
            </button>)}</div></div>
        {!!report.per_project?.length && !filters.project_id && <div className="pf-projects"><h3>Salgsverdi per prosjekt</h3>
          {report.per_project.map(row => <button type="button" key={row.project_id} onClick={() => apply('project_id', row.project_id)} aria-label={`Vis ${row.project}, ${row.count} salg, ${amount(row.total_ore)}`}>
            <span>{row.project}</span><span className="pf-track" aria-hidden="true"><i style={{width:`${100 * row.total_ore / Math.max(report.total_ore, 1)}%`}} /></span><strong>{amount(row.total_ore)}</strong><ChevronRight size={15}/></button>)}</div>}
        <div className="pf-sales"><h3>Registrerte salg</h3><p>Åpne et salg for å se beløp, status og fordeling.</p>
          {report.items.map(item => <button type="button" aria-haspopup="dialog" className="pf-sale" key={item.id} onClick={() => setDetail(item)}><BriefcaseBusiness size={18} /><span className="pf-party"><strong>{item.company}</strong><small>{item.project}</small></span><time dateTime={item.created_at}>{date(item.created_at)}</time>
            <span className={`pf-state ${item.status === 'approved' ? 'pf-approved' : ''}`}>{statusNames[item.status] || item.status}</span><strong>{amount(item.amount_ore)}</strong><ChevronRight size={16}/></button>)}
          {!report.items.length && <p className="pf-empty">Ingen registrerte salg i dette utvalget.</p>}
          {report.count > 25 && <div className="pf-paging"><small>{offset + 1}–{Math.min(offset + 25, report.count)} av {report.count}</small><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(n => n - 25)}>Forrige</Button><Button size="sm" variant="outline" disabled={offset + 25 >= report.count} onClick={() => setOffset(n => n + 25)}>Neste</Button></div>}
        </div>
        <details className="pf-source"><summary>Hvordan telles resultatene?</summary>
          <p>En kjøpende kunde er et lead med minst ett registrert salg i prosjektet. Salgsverdi inkluderer salg som venter på godkjenning.</p>
          <p>Teamfilteret bruker teamet ved registrering for salg og kjøpende kunder. For leads, fullførte samtaler og møter brukes dagens team for henholdsvis tildelt selger, den som ringte og møtebookeren.</p>
          {demo && <p>Eksempelkontaktene er fordelt på Demoteam og Møtebooking. Endringer i det aktive prosjektet inngår i tallene.</p>}</details>
      </>}</div>
    {metric && <PortfolioActivity metric={metric} query={new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString()} demoRows={demoData?.details[metric]} onClose={() => setMetric(null)} />}
    <Dialog open={!!detail} onOpenChange={v => !v && setDetail(null)} title={detail?.company || 'Salgsdetaljer'} description={detail?.project || ''}>
      {detail && <dl className="portfolio-details">{Object.entries({ Produkt: detail.product, Selger: detail.seller_name || detail.seller_id, 'Team ved salg': detail.team || 'Ikke registrert', Status: statusNames[detail.status] || detail.status,
        Dato: date(detail.created_at), 'Beløp eks. mva.': amount(detail.amount_ore), Selgerandel: amount(detail.allocation.seller), Partnerandel: amount(detail.allocation.partner), Hubandel: amount(detail.allocation.hub) }).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    </Dialog>
  </section>
}
