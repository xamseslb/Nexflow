import { useEffect, useState, type FormEvent } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'
import { request } from '@/lib/api'
import { money } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import demoReport from '@/lib/demo-report.json'

type Summary = { min: number; q1: number; median: number; q3: number; max: number }
type Distribution = { count: number; available: boolean; unit: string; whisker_method: string; summary: Summary | null }
type Report = { period: { start: string; end: string; timezone: string }; currency: string;
  totals: Record<string, number>; series: { date: string; leads: number; calls: number; meetings: number; sales: number; revenue_ore: number }[];
  pipeline: { stage: string; count: number }[]; cohort: { leads: number; sold: number; conversion_percent: number | null };
  distributions: { sale_amount: Distribution; hours_to_sale: Distribution } }
type Metric = 'calls' | 'meetings' | 'sales' | 'revenue_ore' | 'leads'
const metricLabels: Record<Metric, string> = { calls: 'Fullførte samtalelogger', meetings: 'Møter registrert', sales: 'Salg registrert', revenue_ore: 'Registrert salgsverdi', leads: 'Nye leads' }
const labels: Record<string, string> = { new: 'Nye', callback: 'Ring tilbake', meeting: 'Møte booket', sold: 'Solgt', declined: 'Ikke aktuell' }

function BoxPlot({ title, data, currency = false }: { title: string; data: Distribution; currency?: boolean }) {
  const summary = data.summary
  const format = (value: number) => currency ? money(Math.round(value)) : `${value.toFixed(1)} t`
  return <section className="panel report-panel"><h2>{title}</h2><p>{data.count} registrerte salg · min/maks som endepunkter</p>
    {!summary ? <div className="empty-state"><BarChart3 /><p>Minst fem observasjoner kreves for å vise fordelingen.</p></div> : <>
      <svg viewBox="0 0 520 110" role="img" aria-label={`${title}: median ${format(summary.median)}, fra ${format(summary.min)} til ${format(summary.max)}`}>
        {(() => {
          const x = (n: number) => summary.max === summary.min ? 260 : 30 + (n - summary.min) / (summary.max - summary.min) * 460
          return <g><line x1={x(summary.min)} x2={x(summary.max)} y1="50" y2="50" stroke="#647766" strokeWidth="2" />
            {[summary.min, summary.max].map((n, i) => <line key={i} x1={x(n)} x2={x(n)} y1="30" y2="70" stroke="#647766" strokeWidth="2" />)}
            <rect x={x(summary.q1)} y="25" width={Math.max(2, x(summary.q3) - x(summary.q1))} height="50" fill="#dce8d7" stroke="#517550" />
            <line x1={x(summary.median)} x2={x(summary.median)} y1="25" y2="75" stroke="#244e36" strokeWidth="3" />
          </g>
        })()}
      </svg>
      <dl className="distribution-values">{Object.entries(summary).map(([key, value]) => <div key={key}><dt>{{ min: 'Min', q1: 'Nedre kvartil', median: 'Median', q3: 'Øvre kvartil', max: 'Maks' }[key]}</dt><dd>{format(value)}</dd></div>)}</dl>
    </>}
  </section>
}

export function Reports({ projectId, demo }: { projectId: string; demo: boolean }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('')
  const [metric, setMetric] = useState<Metric>('calls')
  useEffect(() => {
    let cancelled = false
    setLoading(true); setReport(null); setError('')
    if (demo) { setReport(demoReport); setLoading(false); return }
    request<Report>(`/projects/${projectId}/reports${range}`).then(data => !cancelled && setReport(data)).catch(e => !cancelled && setError(e.message)).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [projectId, demo, range])
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setRange(`?${new URLSearchParams({ start: String(data.get('start')), end: String(data.get('end')), timezone: 'Europe/Oslo' })}`)
  }
  if (loading) return <div className="empty-state"><Loader2 className="animate-spin" /><p>Henter rapport…</p></div>
  if (error) return <div className="panel empty-state" role="alert"><p>{error}</p><Button variant="outline" onClick={() => setRange(r => r ? '' : '?timezone=Europe/Oslo')}>Prøv igjen</Button></div>
  if (!report) return null
  const maxCalls = Math.max(1, ...report.series.map(day => day[metric]))
  const maxPipeline = Math.max(1, ...report.pipeline.map(stage => stage.count))
  return <div className="reports">
    {demo && <div className="report-notice">Illustrasjonsdata · fast eksempel fra oktober 2026. Tallene er uavhengige av demoens ringeliste.</div>}
    <form className="report-filters" onSubmit={filter}><label>Fra<input name="start" type="date" required defaultValue={report.period.start} disabled={demo} /></label><label>Til<input name="end" type="date" required defaultValue={report.period.end} disabled={demo} /></label><Button disabled={demo}>Vis periode</Button><span>Europe/Oslo · maksimalt 366 dager</span></form>
    <div className="stat-grid">{[['Fullførte samtalelogger', String(report.totals.calls)], ['Møter registrert', String(report.totals.meetings)], ['Salg registrert', String(report.totals.sales)], ['Registrert salgsverdi', money(report.totals.revenue_ore)]].map(([label, value]) => <div className="stat-card" key={label}><div className="stat-top">{label}</div><strong>{value}</strong><small>I valgt periode</small></div>)}</div>
    <div className="report-grid"><section className="panel report-panel"><div className="chart-heading"><h2>Utvikling over tid</h2><label>Måltall<select aria-label="Måltall i diagram" value={metric} onChange={e => setMetric(e.target.value as Metric)}>{Object.entries(metricLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><p>{metricLabels[metric]} per dag{metric === 'calls' ? ", inkludert «ikke svar»" : ""}.</p><svg viewBox="0 0 600 190" role="img" aria-label={`${metricLabels[metric]} per dag. Eksakte tall finnes i datatabellen nedenfor.`}>
      {[0, 1, 2].map(i => <line key={i} x1="25" x2="585" y1={20 + i * 70} y2={20 + i * 70} stroke="#e4e9e0" />)}
      <text x="25" y="12" fontSize="10" fill="#63705d">{metric === 'revenue_ore' ? money(maxCalls) : maxCalls.toLocaleString('nb-NO')}</text><polyline fill="none" stroke="#346649" strokeWidth="3" strokeLinejoin="round" points={report.series.map((day, i) => `${25 + i / Math.max(1, report.series.length - 1) * 560},${160 - day[metric] / maxCalls * 140}`).join(' ')} />
      <text x="25" y="185" fontSize="11" fill="#63705d">{report.period.start}</text><text x="585" y="185" textAnchor="end" fontSize="11" fill="#63705d">{report.period.end}</text>
    </svg></section><section className="panel report-panel"><h2>Pipeline akkurat nå</h2><p>Nåværende leadstatus. Dette er ikke en historisk salgstrakt.</p><div className="pipeline-bars">{report.pipeline.map(stage => <div key={stage.stage}><span>{labels[stage.stage]}</span><div><i style={{ width: `${stage.count / maxPipeline * 100}%` }} /></div><strong>{stage.count}</strong></div>)}</div></section></div>
    <section className="panel report-panel cohort-panel"><div><h2>Fra nytt lead til salg</h2><p>Av {report.cohort.leads} leads opprettet i perioden har {report.cohort.sold} minst ett registrert salg før periodens slutt. Direkte salg er inkludert.</p></div><strong>{report.cohort.conversion_percent === null ? '—' : `${report.cohort.conversion_percent.toLocaleString('nb-NO')} %`}</strong></section>
    <div className="report-grid"><BoxPlot title="Fordeling av salgsbeløp" data={report.distributions.sale_amount} currency /><BoxPlot title="Tid fra lead til registrert salg" data={report.distributions.hours_to_sale} /></div>
    <details className="panel report-panel"><summary>Se datagrunnlaget per dag</summary><div className="report-table-scroll"><table className="report-table"><caption>Daglige summer · {report.period.timezone} · NOK</caption><thead><tr>{['Dato', 'Nye leads', 'Samtalelogger', 'Møter registrert', 'Salg', 'Salgsverdi'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{report.series.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.leads}</td><td>{day.calls}</td><td>{day.meetings}</td><td>{day.sales}</td><td>{money(day.revenue_ore)}</td></tr>)}</tbody></table></div></details>
    <p className="report-footnote">Beløp er eks. mva. og inkluderer registrerte salg som venter godkjenning eller bekreftelse. Tallene er ikke utbetalt provisjon. Rapporter er kun tilgjengelige for ledere og administratorer.</p>
  </div>
}
