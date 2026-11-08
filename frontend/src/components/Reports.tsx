import { useEffect, useState, type FormEvent } from 'react'
import { ArrowUpRight, ChevronRight, Loader2 } from 'lucide-react'
import { Dialog } from './ui/dialog'
import { PortfolioActivity } from './PortfolioActivity'
import { request, type Lead } from '@/lib/api'
import { money } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import demoReport from '@/lib/demo-report.json'

type Summary = { min: number; q1: number; median: number; q3: number; max: number }
type Distribution = { count: number; summary: Summary | null }
type Report = { period: { start: string; end: string; timezone: string }; currency: string;
  totals: Record<string, number>; series: { date: string; leads: number; calls: number; meetings: number; sales: number; revenue_ore: number }[];
  pipeline: { stage: string; count: number }[]; cohort: { leads: number; sold: number; conversion_percent: number | null };
  distributions: { sale_amount: Distribution; hours_to_sale: Distribution } }
type Metric = 'calls' | 'meetings' | 'sales' | 'revenue_ore' | 'leads'
const metricLabels: Record<Metric, string> = { calls: 'Fullførte samtalelogger', meetings: 'Møter registrert', sales: 'Salg registrert', revenue_ore: 'Registrert salgsverdi', leads: 'Nye leads' }
const metricDefinitions: Record<Metric, string> = {
  calls: 'Fullførte samtalelogger per dag, inkludert «ikke svar».',
  meetings: 'Møter etter registreringsdato.',
  sales: 'Salg etter registreringsdato, inkludert salg til godkjenning.',
  revenue_ore: 'Registrert salgsverdi per dag i kroner eks. mva.',
  leads: 'Nye leads etter opprettelsesdato.',
}
const labels: Record<string, string> = { new: 'Nye', callback: 'Ring tilbake', meeting: 'Møte booket', sold: 'Solgt', declined: 'Ikke aktuell' }

const formatDay = (date: string) => new Intl.DateTimeFormat('nb-NO', {
  day: 'numeric', month: 'short', timeZone: 'UTC',
}).format(new Date(date + 'T12:00:00Z'))

function ActivityChart({ series, metric, onDay }: { series: Report['series']; metric: Metric; onDay: (date: string) => void }) {
  const [position, setPosition] = useState<number | null>(null)
  if (!series.length) return <p className="pf-empty">Ingen dager i valgt periode.</p>
  const format = (n: number) => metric === 'revenue_ore' ? money(n) : n.toLocaleString('nb-NO')
  const peak = Math.max(1, ...series.map(day => day[metric]))
  const unit = Math.pow(10, Math.floor(Math.log10(peak / 4)))
  const step = Math.max(metric === 'revenue_ore' ? 100 : 1, ([1,2,2.5,5,10].find(n => n * unit >= peak / 4) || 10) * unit)
  const ceiling = step * 4
  const index = Math.min(position ?? series.length - 1, series.length - 1)
  const current = series[index]
  const col = 1000 / series.length
  const x = (i: number) => (i + .5) * col
  const y = (n: number) => 200 - 200 * n / ceiling
  const line = metric === 'revenue_ore' || series.length > 60
  const path = series.map((day,i) => (i ? 'L' : 'M') + x(i) + ',' + y(day[metric])).join(' ')
  const ticks = Array.from(new Set([0, Math.round((series.length-1)/3), Math.round(2*(series.length-1)/3), series.length-1]))
  function indexAt(event: React.PointerEvent<HTMLInputElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.min(series.length - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * series.length)))
  }
  return <div className="trend">
    <p className="trend-definition">{metricDefinitions[metric]}</p>
    <div className="trend-readout"><span>{formatDay(current.date)}</span><strong>{format(current[metric])}</strong>
      <button onClick={() => onDay(current.date)}>Åpne dagsrapport <ArrowUpRight size={14}/></button></div>
    <div className="trend-frame"><div className="trend-axis" aria-hidden="true">{[4,3,2,1,0].map(n => <span key={n}>{format(n * step)}</span>)}</div>
      <div className="trend-plot">
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" role="img" aria-label={metricLabels[metric] + ' per dag'}>
          {[0,50,100,150,200].map(v => <line key={v} x1="0" x2="1000" y1={v} y2={v} stroke="#dce3e3" strokeDasharray={v === 200 ? undefined : '3 4'} vectorEffect="non-scaling-stroke" />)}
          {line ? <><path d={path + ' L'+x(series.length-1)+',200 L'+x(0)+',200 Z'} fill="#e5f2ee"/>
            <path d={path} fill="none" stroke="#137763" strokeWidth="2.6" vectorEffect="non-scaling-stroke"/></>
            : series.map((day,i) => <rect key={day.date} x={x(i)-col*.33} width={col*.66} y={y(day[metric])} height={200-y(day[metric])} rx="2" fill={i === index ? '#0a594b' : '#69a998'}/>)}
          <line x1={x(index)} x2={x(index)} y1="0" y2="200" stroke="#445f58" strokeDasharray="3 4" vectorEffect="non-scaling-stroke"/>
        </svg>
        {line && <i className="trend-point" style={{left:x(index)/10+'%',top:y(current[metric])/2+'%'}}/>}
        <input type="range" aria-label="Dato i diagram" min={0} max={series.length-1} value={index}
          aria-valuetext={formatDay(current.date)+', '+format(current[metric])} onPointerMove={e => setPosition(indexAt(e))}
          onChange={e => setPosition(Number(e.target.value))} onKeyDown={e => { if (e.key === 'Enter') onDay(current.date) }}/>
      </div>
      <div className="trend-ticks">{ticks.map(i => <span key={i}>{formatDay(series[i].date)}</span>)}</div>
    </div>
  </div>
}

export function Reports({ projectId, demo, active, leads, onCustomer }: { projectId: string; demo: boolean; active: boolean; leads: Lead[]; onCustomer: (project: string, lead: string, sales?: boolean) => void }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [filterError, setFilterError] = useState('')
  const [stage, setStage] = useState('')
  const [dayDate, setDayDate] = useState('')
  const [metric, setMetric] = useState<Metric>('calls')
  useEffect(() => {
    let cancelled = false
    setLoading(true); setReport(null); setError('')
    if (demo) {
      const params = new URLSearchParams(range)
      const start = params.get('start') || demoReport.period.start
      const end = params.get('end') || demoReport.period.end
      const series = demoReport.series.filter(row => row.date >= start && row.date <= end).map(row => projectId === 'demo-1' ? row : { date:row.date, leads:0, calls:0, meetings:0, sales:0, revenue_ore:0 })
      const totals = Object.fromEntries(Object.keys(metricLabels).map(key =>
        [key, series.reduce((sum, row) => sum + row[key as Metric], 0)]))
      setReport({ ...demoReport, period: { ...demoReport.period, start, end }, totals, series })
      setLoading(false); return
    }
    request<Report>(`/projects/${projectId}/reports${range}`).then(data => !cancelled && setReport(data)).catch(e => !cancelled && setError(e.message)).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [projectId, demo, range, attempt])
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const start = String(data.get('start')), end = String(data.get('end'))
    if (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 >= 366) {
      setFilterError('Velg en periode på 1 til 366 dager.'); return
    }
    setFilterError('')
    setRange(`?${new URLSearchParams({ start: String(data.get('start')), end: String(data.get('end')), timezone: 'Europe/Oslo' })}`)
  }
  if (loading) return <div className="empty-state"><Loader2 className="animate-spin" /><p>Henter rapport…</p></div>
  if (error) return <div className="panel empty-state" role="alert"><p>{error}</p><Button variant="outline" onClick={() => setAttempt(n => n + 1)}>Prøv igjen</Button></div>
  if (!report) return null
  const fullStatistics = !demo || (projectId === 'demo-1' && report.period.start === demoReport.period.start && report.period.end === demoReport.period.end)
  const pipeline = demo ? report.pipeline.map(s => ({...s, count:leads.filter(l => l.status === s.stage).length})) : report.pipeline
  const pipelineTotal = pipeline.reduce((sum, stage) => sum + stage.count, 0)
  const day = report.series.find(row => row.date === dayDate)
  const metricOrder: Metric[] = ['calls','meetings','sales','revenue_ore','leads']
  const formatValue = (key: Metric, value: number) => key === 'revenue_ore' ? money(value) : value.toLocaleString('nb-NO')
  const typical = report.distributions.sale_amount.summary
  const duration = report.distributions.hours_to_sale.summary
  return <div className="reports analytics">
    <header className="analysis-heading"><div><h2>Prosjektanalyse</h2><p>{demo ? (projectId === 'demo-1' ? 'Illustrasjonsdata · oktober 2026. Leadstatus viser dagens demoprosjekt.' : 'Dette demoprosjektet har ingen historiske aktivitetstall. Leadstatus viser dagens kontakter.') : 'Aktivitet og salgsresultater i det valgte prosjektet.'}</p></div>
    <form className="report-filters" onSubmit={filter}><label>Fra<input name="start" type="date" required min={demo ? demoReport.period.start : undefined} max={demo ? demoReport.period.end : undefined} defaultValue={report.period.start}/></label>
    <label>Til<input name="end" type="date" required min={demo ? demoReport.period.start : undefined} max={demo ? demoReport.period.end : undefined} defaultValue={report.period.end}/></label><Button variant="outline">Vis periode</Button></form></header>
    {filterError && <p className="form-error" role="alert">{filterError}</p>}
    <div className="analysis-grid">
      <section className="analysis-panel trend-panel"><h2>Utvikling over tid</h2>
        <div className="metric-strip" role="group" aria-label="Måltall i diagram">{metricOrder.map(key => <button key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>
          <span>{metricLabels[key]}</span><strong>{formatValue(key, report.totals[key])}</strong></button>)}</div>
        <ActivityChart key={report.period.start+report.period.end} series={report.series} metric={metric} onDay={setDayDate}/>
      </section>
      <section className="analysis-panel status-panel"><h2>Pipeline akkurat nå</h2><p>Leads i prosjektet fordelt på status</p>
        <strong className="pipeline-total">{pipelineTotal.toLocaleString('nb-NO')} <small>leads</small></strong>
        <div className="status-band" aria-hidden="true">{pipeline.map(s => s.count > 0 && <i key={s.stage} data-stage={s.stage} style={{flexGrow:s.count}}/>)}</div>
        <div className="status-list">{pipeline.map(s => <button key={s.stage} onClick={() => setStage(s.stage)} aria-label={'Vis leads: '+labels[s.stage]}>
          <i data-stage={s.stage}/><span>{labels[s.stage]}</span><small>{Math.round(100*s.count/(pipelineTotal || 1))} %</small><strong>{s.count}</strong><ChevronRight size={14}/></button>)}</div>
      </section>
    </div>
    {fullStatistics && <section className="analysis-panel sales-insight"><div><h2>Fra nytt lead til salg</h2><strong>{report.cohort.conversion_percent === null ? '—' : report.cohort.conversion_percent.toLocaleString('nb-NO')+' %'}</strong><p>{report.cohort.sold} av {report.cohort.leads} nye leads kjøpte innen periodens slutt.</p></div>
      <div><h2>Typisk salgsbeløp</h2><strong>{typical ? money(typical.median) : '—'}</strong><p>{typical ? `Median for ${report.distributions.sale_amount.count} registrerte salg, eks. mva.` : 'Krever minst fem salg i perioden.'}</p></div>
      <div><h2>Tid til salg</h2><strong>{duration ? duration.median.toLocaleString('nb-NO', {maximumFractionDigits:1})+' t' : '—'}</strong><p>{duration ? 'Median fra leadet ble opprettet til salget ble registrert.' : 'Krever minst fem observasjoner i perioden.'}</p></div></section>}
    <details className="panel report-panel"><summary>Se datagrunnlaget per dag</summary><div className="report-table-scroll"><table className="report-table"><caption>Daglige summer · {report.period.timezone} · NOK</caption><thead><tr>{['Dato','Nye leads','Samtalelogger','Møter','Salg','Salgsverdi'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{report.series.map(row => <tr key={row.date}><th scope="row"><button className="record-name" onClick={() => setDayDate(row.date)}>{row.date}</button></th><td>{row.leads}</td><td>{row.calls}</td><td>{row.meetings}</td><td>{row.sales}</td><td>{money(row.revenue_ore)}</td></tr>)}</tbody></table></div></details>
    {stage && active && <PortfolioActivity metric="leads" title={'Leads · '+labels[stage]} query={new URLSearchParams({ project_id:projectId, stage }).toString()}
      demoRows={demo ? leads.filter(l => l.status === stage).map(l => ({id:l.id,lead_id:l.id,project_id:projectId,company:l.company,project:'',detail:l.contact})) : undefined}
      onClose={() => setStage('')} onCustomer={onCustomer}/>}
    <Dialog open={Boolean(day) && active} title={day ? 'Dagsrapport · '+formatDay(day.date) : 'Dagsrapport'} description={report.period.timezone} onOpenChange={open => {if (!open) setDayDate('')}}>
      {day && <dl className="portfolio-details">{metricOrder.map(key => <div key={key}><dt>{metricLabels[key]}</dt><dd>{formatValue(key,day[key])}</dd></div>)}</dl>}
    </Dialog>
  </div>
}
