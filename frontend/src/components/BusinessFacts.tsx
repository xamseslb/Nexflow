import type { Lead } from '@/lib/api'
import './business-facts.css'
import { WebsitePhones, type WebsitePhone } from './WebsitePhones'

type Facts = Lead['enrichment']

function date(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return ''
  return new Date(value).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })
}

function text(info: Facts, key: string) {
  return typeof info[key] === 'string' ? info[key] as string : ''
}

function sectionNote(status: unknown, checked: unknown) {
  const last = date(checked)
  if (status === 'temporary_error') return last ? 'Viser siste tilgjengelige opplysninger fra ' + last : 'Kilden svarte ikke. Nytt forsøk er planlagt.'
  return last ? 'Sjekket ' + last : ''
}

function sourceLink(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url : null
  } catch { return null }
}

export function BusinessFacts({ info, compact = false }: { info: Facts; compact?: boolean }) {
  const number = text(info, 'organization_number')
  const registry = /^\d{9}$/.test(number) ? 'https://virksomhet.brreg.no/nb/oppslag/enheter/' + number : ''
  const site = sourceLink(text(info, 'website_url'))
  const currency = text(info, 'currency')
  const money = (amount: unknown) => typeof amount === 'number' && Number.isFinite(amount)
    ? amount.toLocaleString('nb-NO', { maximumFractionDigits: 2 }) + (currency ? ' ' + currency : '') : 'Ikke oppgitt'
  const labels: [string, string][] = [['Registrert navn', text(info, 'name')], ['Bransje', text(info, 'industry')],
    ['Poststed', text(info, 'city')], ['Ansatte', typeof info.employees === 'number' ? info.employees.toLocaleString('nb-NO') : ''],
    ['Daglig leder', text(info, 'chief_executive')], ['Styreleder', text(info, 'board_chair')]]
  const summary = text(info, 'website_summary')
  const content = <>
    {info.lookup_status === 'temporary_error' && <p role="status">Registeret svarte ikke. Nytt oppslag er planlagt.</p>}
    {info.lookup_status === 'no_unique_match' && <p>Fant ingen entydig bedrift med dette navnet i Enhetsregisteret.</p>}
    {info.lookup_status === 'not_found' && <p>Organisasjonsnummeret finnes ikke i Enhetsregisteret.</p>}
    {!Object.keys(info).length && <p>Ingen bedriftsopplysninger tilgjengelig ennå.</p>}
    {Boolean(info.website_status) && <section><h4>Fra bedriftens nettside</h4>
      <p>{summary || (info.website_status === 'missing' ? 'Ingen nettside registrert hos Brønnøysundregistrene.' : 'Ingen tilgjengelig oppsummering fra nettsiden.')}</p>
      <small>{site && <a href={site.href} target="_blank" rel="noreferrer">{site.hostname}</a>} {sectionNote(info.website_status, info.website_checked_at)}</small>
    </section>}
    <WebsitePhones phones={info.website_phones as WebsitePhone[] | undefined} status={text(info,'website_phone_status')} checked={text(info,'website_checked_at')}/>
    {labels.some(([,value]) => value) && <dl>{labels.filter(([,value]) => value).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    {Boolean(info.roles_status) && <small>{info.roles_status === 'missing' && 'Ingen daglig leder eller styreleder oppgitt. '}{'Roller · '}{sectionNote(info.roles_status, info.roles_checked_at)}</small>}
    {Boolean(info.accounts_status) && <section><h4>Årsregnskap {text(info, 'period_end').slice(0,4)}</h4>
      {Boolean(info.period_end) ? <dl>{[['Omsetning',info.revenue],['Driftsresultat',info.operating_profit],['Egenkapital',info.equity]].map(([label, amount]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{money(amount)}</dd></div>)}</dl>
        : <p>Ingen tilgjengelige regnskapstall.</p>}
      <small>{sectionNote(info.accounts_status, info.accounts_checked_at)}</small>
    </section>}
    {Boolean(registry || info.source) && <small>{registry ? <a href={registry} target="_blank" rel="noreferrer">Brønnøysundregistrene · {number}</a> : text(info,'source')} {date(info.fetched_at)}</small>}
  </>
  if (compact) return <details className="business-facts"><summary>Bedriftsopplysninger</summary>{content}</details>
  return <section className="business-facts" aria-label="Bedriftsopplysninger"><h3>Bedriftsopplysninger</h3>{content}</section>
}
