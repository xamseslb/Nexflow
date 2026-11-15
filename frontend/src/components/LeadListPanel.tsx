import { useMemo } from 'react'
import { ArrowRight, ChevronRight, Search, ShieldCheck, X } from 'lucide-react'
import { Badge, labels } from './StatusBadge'
import type { Lead } from '@/lib/crmTypes'
import { cn } from '@/lib/utils'

type Layout = 'board' | 'list'
type Props = {
  view: 'overview' | 'leads'
  projectDescription: string
  leads: Lead[]
  filter: string
  setFilter: (filter: string) => void
  search: string
  setSearch: (value: string) => void
  leadLayout: Layout
  setLeadLayout: (value: Layout) => void
  openLeadList: () => void
  onSelect: (lead: Lead) => void
}

const boardLabels: Record<string, string> = {
  new: 'Nye',
  callback: 'Ring tilbake',
  meeting: 'Møte booket',
  sold: 'Solgt',
  declined: 'Ikke aktuell',
  blocked: 'Sperret',
  other: 'Andre',
}

function boardColumn(lead: Lead) {
  // Blocking takes precedence over the stored sales status on the board.
  if (lead.blocked) return 'blocked'
  return ['new', 'callback', 'meeting', 'sold', 'declined'].includes(lead.status)
    ? lead.status
    : 'other'
}

function badgeStatus(lead: Lead) {
  if (lead.blocked) return 'blocked'
  return lead.review_required ? 'review' : lead.status
}

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
}

export function LeadListPanel({
  view,
  projectDescription,
  leads,
  filter,
  setFilter,
  search,
  setSearch,
  leadLayout,
  setLeadLayout,
  openLeadList,
  onSelect,
}: Props) {
  // This filter is a convenience for browsing. The server rechecks eligibility before a call.
  const filtered = useMemo(() => {
    const query = search.toLowerCase()
    return leads.filter((lead) => {
      const available =
        !lead.blocked &&
        !lead.review_required &&
        Boolean(lead.phone) &&
        ['new', 'callback'].includes(lead.status)
      const matchesStatus =
        filter === 'all' ||
        (filter === 'available' ? available : !lead.blocked && lead.status === filter)
      return (
        matchesStatus &&
        [lead.company, lead.contact, lead.city].join(' ').toLowerCase().includes(query)
      )
    })
  }, [leads, filter, search])

  return (
    <section className="panel leads-panel">
      <div className="panel-heading">
        <div>
          <h2>
            {view === 'overview' ? 'Neste i ringelisten' : 'Alle leads'}{' '}
            <span className="count-pill">{filtered.length}</span>
          </h2>
          <p>
            {view === 'overview' ? 'Prioritert og klar for din neste samtale.' : projectDescription}
          </p>
        </div>
        {view === 'overview' && (
          <button className="text-link" onClick={() => openLeadList()}>
            Se hele listen <ArrowRight size={15} />
          </button>
        )}
      </div>
      <div className="table-toolbar">
        <div className="tabs">
          {!['all', 'available', 'callback'].includes(filter) && (
            <button className="selected" onClick={() => setFilter('all')}>
              {labels[filter] || filter} <X size={12} />
            </button>
          )}
          <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>
            Alle leads
          </button>
          <button
            className={filter === 'available' ? 'selected' : ''}
            onClick={() => setFilter('available')}
          >
            Klar til samtale
          </button>
          <button
            className={filter === 'callback' ? 'selected' : ''}
            onClick={() => setFilter('callback')}
          >
            Ring tilbake
          </button>
        </div>
        <label className="search-input">
          <Search size={16} />
          <input
            aria-label="Søk i leads"
            placeholder="Søk etter bedrift eller kontakt…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {view === 'leads' && (
        <div className="view-switch" aria-label="Visning av leads">
          <button
            type="button"
            aria-pressed={leadLayout === 'board'}
            onClick={() => setLeadLayout('board')}
          >
            Tavle
          </button>
          <button
            type="button"
            aria-pressed={leadLayout === 'list'}
            onClick={() => setLeadLayout('list')}
          >
            Liste
          </button>
          {leadLayout === 'board' && (
            <span className="board-hint">Bla sidelengs for flere statuser</span>
          )}
        </div>
      )}
      {view === 'leads' && leadLayout === 'board' ? (
        <div className="board-scroll">
          <div className="lead-board">
            {Object.entries(boardLabels).map(([status, title]) => {
              const items = filtered.slice(0, 500).filter((lead) => boardColumn(lead) === status)
              return (
                <section className={`board-column board-${status}`} key={status} aria-label={title}>
                  <div className="board-heading">
                    <h3>{title}</h3>
                    <span>{items.length}</span>
                  </div>
                  <div className="board-items">
                    {items.map((lead) => (
                      <button className="board-card" key={lead.id} onClick={() => onSelect(lead)}>
                        <span className="board-card-top">
                          <span className="board-card-name">{lead.company}</span>
                          <ChevronRight size={15} />
                        </span>
                        <span className="board-contact">
                          {lead.contact || 'Ingen kontaktperson'}
                        </span>
                        <span className="board-company">
                          {lead.industry || 'Ikke beriket'}
                          {lead.city ? ` · ${lead.city}` : ''}
                        </span>
                        <span className="board-card-footer">
                          <span className="board-avatar">{initials(lead.company)}</span>
                          <span>{lead.kind.toUpperCase()}</span>
                          <Badge status={badgeStatus(lead)} />
                        </span>
                      </button>
                    ))}
                    {items.length === 0 && <p className="board-empty">Ingen leads</p>}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="lead-table">
          <div className="lead-row table-header">
            <span>BEDRIFT / KONTAKT</span>
            <span>BRANSJE</span>
            <span>STATUS</span>
            <span>PRIORITET</span>
            <span />
          </div>
          {filtered.slice(0, view === 'overview' ? 4 : 500).map((lead, index) => (
            <button className="lead-row" key={lead.id} onClick={() => onSelect(lead)}>
              <div className="company-cell">
                <div className={`company-avatar color-${index % 4}`}>{initials(lead.company)}</div>
                <div>
                  <strong>{lead.company}</strong>
                  <small>
                    {lead.contact || 'Ingen kontaktperson'}
                    {lead.city ? ` · ${lead.city}` : ''}
                  </small>
                </div>
              </div>
              <span className="industry-cell">{lead.industry || 'Ikke beriket'}</span>
              <span>
                <Badge status={badgeStatus(lead)} />
                {lead.blocked && <span className="sr-only">Sperret</span>}
              </span>
              <span className="priority-cell">
                <span className={cn('priority-dot', lead.priority >= 90 && 'high')} />
                {lead.priority >= 90 ? 'Høy' : 'Normal'}
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="empty-state">
              <Search />
              <h3>Ingen leads å vise</h3>
              <p>Prøv et annet søk eller legg til ditt første lead.</p>
            </div>
          )}
        </div>
      )}
      <div className="table-footer">
        <span>
          {view === 'overview' ? Math.min(filtered.length, 4) : filtered.length} av {leads.length}{' '}
          leads
        </span>
        <span>
          <ShieldCheck size={13} />
          Prosjektisolerte data
        </span>
      </div>
    </section>
  )
}
