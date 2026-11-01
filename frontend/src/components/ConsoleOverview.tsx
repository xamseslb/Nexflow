import { ArrowRight, ArrowUpRight, CalendarDays, CheckCheck, CircleCheck, ListTodo, Phone, Plus, ShieldCheck, Wallet } from 'lucide-react'
import { money } from '@/lib/utils'
import type { Lead, Meeting, Project, Sale } from '@/lib/api'

type Props = {
  project: Project
  leads: Lead[]
  meetings: Meeting[]
  sales: Sale[]
  demo: boolean
  calls: number
  operator: boolean
  onLeads: (filter?: string) => void
  onMeetings: () => void
  onSales: () => void
  onTasks: () => void
  onNewLead: () => void
}

export function ConsoleOverview({ project, leads, meetings, sales, demo, calls, operator, onLeads, onMeetings, onSales, onTasks, onNewLead }: Props) {
  const ready = leads.filter(lead => !lead.blocked && ['new', 'callback'].includes(lead.status)).length
  const callbacks = leads.filter(lead => lead.status === 'callback' && !lead.blocked).length
  const sold = leads.filter(lead => lead.status === 'sold').length
  const share = leads.length ? Math.round(sold / leads.length * 100) : 0
  const upcoming = meetings.filter(meeting => meeting.outcome === 'booked' && new Date(meeting.starts_at) >= new Date()).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const total = sales.reduce((sum, sale) => sum + sale.amount_ore, 0)
  const approved = sales.filter(sale => sale.status === 'approved').reduce((sum, sale) => sum + sale.amount_ore, 0)
  const stages = [
    { label: 'Nye leads', status: 'new', count: leads.filter(l => !l.blocked && l.status === 'new').length },
    { label: 'Ring tilbake', status: 'callback', count: callbacks },
    { label: 'Møte booket', status: 'meeting', count: leads.filter(l => !l.blocked && l.status === 'meeting').length },
    { label: 'Solgt', status: 'sold', count: sold },
  ]
  const max = Math.max(1, ...stages.map(stage => stage.count))

  return <div className="console-overview">
    <div className="console-rail">
      <div className="console-section-label"><span>Arbeidsdagen</span><span>01 / STATUS</span></div>
      <div className="console-metrics">
        <button className="console-card compact-metric" onClick={() => onLeads('available')}><CircleCheck size={19} className="status-green" /><strong>{ready}</strong><span>Klar til oppfølging</span><ArrowUpRight size={14} /></button>
        <button className="console-card compact-metric" onClick={() => onLeads('callback')}><Phone size={18} /><strong>{callbacks}</strong><span>Ring tilbake</span><ArrowUpRight size={14} /></button>
      </div>
      <section className="console-card progress-card">
        <div className="console-card-title"><h2>Fra lead til salg</h2><CheckCheck size={17} /></div>
        <div className="progress-value">{share}<span>%</span></div>
        <p>{sold} av {leads.length} leads har status solgt</p>
        <div className="console-progress" role="progressbar" aria-label="Andel leads med status solgt" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${share}%` }} /></div>
        <div className="progress-caption"><span>Nåværende prosjekt</span><span>{leads.length} leads</span></div>
      </section>
      <section className="console-card shortcuts-card">
        <div className="console-card-title"><h2>Hurtigvalg</h2><ArrowUpRight size={16} /></div>
        <div className="console-shortcuts">
          <button onClick={() => onLeads('available')}><Phone size={19} /><span>Ringeliste</span></button>
          <button onClick={onMeetings}><CalendarDays size={19} /><span>Møter</span></button>
          <button onClick={onSales}><Wallet size={19} /><span>Salg</span></button>
          {operator && <><button aria-label="Opprett nytt lead" onClick={onNewLead}><Plus size={19} /><span>Nytt lead</span></button><button onClick={onTasks}><ListTodo size={19} /><span>Oppfølging</span></button></>}
        </div>
      </section>
      <div className="console-rail-note"><ShieldCheck size={16} /><span>Tilgang styrt av rolle og prosjekt</span></div>
    </div>
    <div className="console-stage">
      <section className="console-card pipeline-workspace">
        <div className="console-card-title"><span className="console-section-label">02 / PROSJEKTSTATUS</span><span className="project-status"><i />{project.active ? 'Aktivt prosjekt' : 'Pauset prosjekt'}</span></div>
        <div className="pipeline-intro"><div><h2>{project.name}</h2><p>{project.description || 'Leads, møter og salg samlet på ett sted.'}</p></div><span className="project-kind">{project.kind.toUpperCase()}</span></div>
        <div className="console-pipeline" aria-label="Fordeling av leadstatus">
          {stages.map((stage, index) => <button key={stage.status} className={`pipeline-stage pipeline-stage-${stage.status}`} onClick={() => onLeads(stage.status)} aria-label={`${stage.label}: ${stage.count} leads. Vis i ringelisten`}>
            <span className="pipeline-step">0{index + 1}<ArrowUpRight size={15} /></span><strong>{stage.count}</strong><span className="pipeline-label">{stage.label}</span>
            <div className="pipeline-track" aria-hidden="true"><span style={{ height: `${stage.count / max * 100}%` }} /></div>
          </button>)}
        </div>
        <div className="pipeline-bottom"><span>Leadstatus akkurat nå · ingen periodefilter</span><button onClick={() => onLeads('available')}>Åpne ringelisten <ArrowRight size={16} /></button></div>
      </section>
      <div className="console-bottom-grid">
        <section className="console-card console-agenda">
          <div className="console-card-title"><h2>Neste på agendaen</h2><button aria-label="Vis alle møter" onClick={onMeetings}><ArrowUpRight size={18} /></button></div>
          {upcoming.slice(0, 2).map(meeting => <button className="console-meeting" key={meeting.id} onClick={onMeetings}><span className="console-date"><strong>{new Date(meeting.starts_at).getDate()}</strong><span>{new Intl.DateTimeFormat('nb-NO', { month: 'short' }).format(new Date(meeting.starts_at))}</span></span><span><strong>{leads.find(lead => lead.id === meeting.lead_id)?.company || 'Kvalifiseringsmøte'}</strong><small>{new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit' }).format(new Date(meeting.starts_at))} · Kvalifiseringsmøte</small></span><ArrowUpRight size={15} /></button>)}
          {!upcoming.length && <div className="console-empty"><CalendarDays size={22} /><p>Ingen kommende møter</p><span>Book et møte fra et lead i ringelisten.</span></div>}
          <div className="console-card-foot"><span>{upcoming.length} kommende møter</span><button onClick={onMeetings}>Se alle møter <ArrowRight size={14} /></button></div>
        </section>
        <section className="console-card console-finance">
          <div className="console-card-title"><h2>Registrert salgsverdi</h2><button aria-label="Vis salg og opptjening" onClick={onSales}><ArrowUpRight size={18} /></button></div>
          <strong className="console-money">{money(total)}</strong><p>Eks. mva · {sales.length} registrerte salg</p>
          <div className="finance-breakdown"><span>Godkjent salgsverdi</span><strong>{money(approved)}</strong></div>
          <div className="console-card-foot"><span>Salgsverdi, ikke utbetaling</span>{demo && <span>{calls} samtaler i demoøkten</span>}</div>
        </section>
      </div>
    </div>
  </div>
}
