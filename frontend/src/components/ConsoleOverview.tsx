import { ArrowRight, CalendarDays, ChevronRight, Phone, PhoneCall, TrendingUp, Wallet } from 'lucide-react'
import { money } from '@/lib/utils'
import type { Lead, Meeting, Sale } from '@/lib/api'

type Props = {
  leads: Lead[]
  meetings: Meeting[]
  sales: Sale[]
  onLeads: (filter?: string) => void
  onMeetings: (id?: string) => void
  onSales: () => void
}

const day = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' })
const hour = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit' })

export function ConsoleOverview({ leads, meetings, sales, onLeads, onMeetings, onSales }: Props) {
  const upcoming = meetings.filter(m => m.outcome === 'booked' && Date.parse(m.starts_at) >= Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const count = (status: string) => leads.filter(l => !l.blocked && l.status === status).length
  const sold = count('sold')
  const stages = [
    { status: 'new', label: 'Nye leads', count: count('new') },
    { status: 'callback', label: 'Ring tilbake', count: count('callback') },
    { status: 'meeting', label: 'Møte booket', count: count('meeting') },
    { status: 'sold', label: 'Solgt', count: sold },
  ]
  const max = Math.max(1, ...stages.map(s => s.count))
  const approved = sales.filter(s => s.status === 'approved').reduce((sum, s) => sum + s.amount_ore, 0)
  const metrics = [
    { label: 'Klar til oppfølging', value: count('new') + count('callback'), icon: Phone, action: () => onLeads('available') },
    { label: 'Ring tilbake', value: count('callback'), icon: PhoneCall, action: () => onLeads('callback') },
    { label: 'Kommende møter', value: upcoming.length, icon: CalendarDays, action: () => onMeetings() },
    { label: 'Registrert salgsverdi', value: money(sales.reduce((sum, s) => sum + s.amount_ore, 0)), icon: Wallet, action: onSales },
  ]

  return <div className="daybook">
    <div className="day-metrics">{metrics.map(({ label, value, icon: Icon, action }) =>
      <button key={label} onClick={action}><span><Icon size={16} />{label}</span><strong>{value}</strong><ChevronRight size={16} /></button>
    )}</div>
    <div className="day-panels">
      <section className="day-panel"><header><h2>Leadstatus</h2><button onClick={() => onLeads()}>Åpne ringelisten <ArrowRight size={15} /></button></header>
        <div className="console-pipeline">{stages.map(stage =>
          <button key={stage.status} className={'pipeline-stage pipeline-stage-' + stage.status} onClick={() => onLeads(stage.status)}
            aria-label={stage.label + ': ' + stage.count + ' leads. Vis i ringelisten'}>
            <span className="pipeline-label">{stage.label}</span><span className="stage-track" aria-hidden="true"><span style={{ width: stage.count / max * 100 + '%' }} /></span><strong>{stage.count}</strong>
          </button>
        )}</div>
        <footer><TrendingUp size={16} />{sold} av {leads.length} leads har status solgt · {leads.length ? Math.round(sold / leads.length * 100) : 0} %</footer>
      </section>
      <section className="day-panel"><header><h2>Neste møter</h2><button onClick={() => onMeetings()}>Se alle møter <ArrowRight size={15}/></button></header>
        {upcoming.slice(0, 2).map(m => <button type="button" key={m.id} className="day-appointment" onClick={() => onMeetings(m.id)}><time dateTime={m.starts_at}>{hour.format(new Date(m.starts_at))}<small>{day.format(new Date(m.starts_at))}</small></time>
          <div><strong>{leads.find(l => l.id === m.lead_id)?.company || 'Kvalifiseringsmøte'}</strong><small>Kvalifiseringsmøte</small></div><ChevronRight size={16} /></button>)}
        {!upcoming.length && <p className="day-empty">Ingen kommende møter. Du kan booke et møte fra kundens leadkort.</p>}
        <footer><Wallet size={16} />Godkjent salgsverdi <strong>{money(approved)}</strong></footer>
      </section>
    </div>
  </div>
}
