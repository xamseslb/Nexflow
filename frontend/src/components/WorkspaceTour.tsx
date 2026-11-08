import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { Button } from './ui/button'
import { pageSteps, tourTarget } from './workspaceTourSteps'
import './workspace-tour.css'

type Page = { id: string; label: string }
type TourProps = {
  owner: string; view: string; pages: Page[]; ready: boolean; replay: boolean; full: boolean
  menuOpen: boolean; closeMenu: () => void
}
const seenThisSession = new Set<string>()

export function WorkspaceTour({ owner, view, pages, ready, replay, full, menuOpen, closeMenu }: TourProps) {
  const key = 'nexflow:tour:v2:' + owner
  const [finished, setFinished] = useState(() => {
    if (replay) return false
    if (seenThisSession.has(key)) return true
    try { return Boolean(localStorage.getItem(key)) } catch { return false }
  })
  const [chapter, setChapter] = useState({ id: full ? 'overview' : view, atEnd: false })
  const position = pages.findIndex(page => page.id === chapter.id)
  if (finished || !ready || position < 0) return null

  function finish() {
    seenThisSession.add(key)
    try { localStorage.setItem(key, 'seen') } catch { /* Remember the choice for the current session. */ }
    setFinished(true)
    if (menuOpen) closeMenu()
  }

  if (view !== chapter.id) {
    return <NavigationHint page={pages[position]} menuOpen={menuOpen} onSkip={finish} onBack={() => {
      closeMenu()
      setChapter({ id: view, atEnd: !chapter.atEnd })
    }} />
  }

  const next = full ? pages[position + 1] : undefined
  const previous = full ? pages[position - 1] : undefined
  return <ChapterTour key={chapter.id} page={pages[position]} full={full} next={next}
    chapterLabel={full ? `Side ${position + 1} av ${pages.length} · ${pages[position].label}` : pages[position].label}
    atEnd={chapter.atEnd} onFinish={finish}
    onNextPage={next ? () => setChapter({ id: next.id, atEnd: false }) : undefined}
    onPreviousPage={previous ? () => setChapter({ id: previous.id, atEnd: true }) : undefined} />
}

function NavigationHint({ page, menuOpen, onSkip, onBack }: {
  page: Page; menuOpen: boolean; onSkip: () => void; onBack: () => void
}) {
  const [compact, setCompact] = useState(() => matchMedia('(max-width:1120px)').matches)
  const openMenuFirst = compact && !menuOpen
  const slot = document.querySelector(openMenuFirst ? '#tour-menu-hint' : `[data-tour-slot="${page.id}"]`)
  useEffect(() => {
    const media = matchMedia('(max-width:1120px)')
    const resize = () => setCompact(media.matches)
    media.addEventListener('change', resize)
    return () => media.removeEventListener('change', resize)
  }, [])
  useLayoutEffect(() => {
    const button = document.querySelector<HTMLButtonElement>(openMenuFirst ? '.mobile-menu' : `[data-tour-page="${page.id}"]`)
    if (!button) return
    button.classList.add('tour-destination')
    button.setAttribute('aria-describedby', 'tour-direction')
    // The drawer also sets initial focus when mounted. Give the learner the requested destination.
    const frame = requestAnimationFrame(() => {
      button.scrollIntoView({ block: 'center', behavior: 'instant' })
      button.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(frame)
      button.classList.remove('tour-destination')
      button.removeAttribute('aria-describedby')
    }
  }, [page.id, openMenuFirst])
  if (!slot) return null
  return createPortal(<aside className="tour-direction" aria-label="Neste side i omvisningen">
    <div id="tour-direction" aria-live="polite"><strong>{openMenuFirst ? 'Åpne hovedmenyen' : 'Trykk på «' + page.label + '»'}</strong>
      <p>{openMenuFirst ? 'Trykk på menyknappen og velg «' + page.label + '» for å fortsette omvisningen.' : 'Omvisningen fortsetter når du åpner siden i menyen.'}</p></div>
    <div><button onClick={onBack}>Forrige</button><button onClick={onSkip}>Hopp over</button></div>
  </aside>, slot)
}

function ChapterTour({ page, full, next, chapterLabel, atEnd, onFinish, onNextPage, onPreviousPage }: {
  page: Page; full: boolean; next?: Page; chapterLabel: string; atEnd: boolean; onFinish: () => void
  onNextPage?: () => void; onPreviousPage?: () => void
}) {
  const candidates = useMemo(() => pageSteps(page.id, page.label, full, !next), [page.id, page.label, full, next?.id])
  const [steps, setSteps] = useState<typeof candidates>([])
  const [cursor, setCursor] = useState<number>(atEnd ? Infinity : 0)
  useLayoutEffect(() => {
    function collect() {
      const visible = candidates.filter(step => tourTarget(step.target))
      setSteps(previous => previous.length === visible.length && previous.every((step, i) => step === visible[i]) ? previous : visible)
    }
    collect()
    // Customer rows, call lists and report totals can arrive after their page heading.
    const observer = new MutationObserver(collect)
    const main = document.querySelector('main')
    if (main) observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] })
    window.addEventListener('resize', collect)
    return () => { observer.disconnect(); window.removeEventListener('resize', collect) }
  }, [candidates])
  const nextIndex = steps.findIndex(step => candidates.indexOf(step) >= cursor)
  const index = nextIndex < 0 ? steps.length - 1 : nextIndex
  const current = steps[index]
  const dialog = useRef<HTMLDialogElement>(null)
  const panel = useRef<HTMLElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const advance = useRef<HTMLButtonElement>(null)
  const open = Boolean(current)
  useLayoutEffect(() => {
    if (!open || !dialog.current) return
    const el = dialog.current
    const before = document.activeElement
    const scrollY = window.scrollY
    el.showModal()
    advance.current?.focus({ preventScroll: true })
    return () => {
      el.close()
      if (before instanceof HTMLElement && before !== document.body && before.isConnected) before.focus({ preventScroll: true })
      else document.querySelector<HTMLElement>('[data-tour="help"]')?.focus({ preventScroll: true })
      window.scrollTo({ top: scrollY, behavior: 'instant' })
    }
  }, [open])

  useLayoutEffect(() => {
    if (!current || !panel.current || !ring.current) return
    const card = panel.current, marker = ring.current
    const target = tourTarget(current.target)
    target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    function position() {
      const rect = tourTarget(current.target)?.getBoundingClientRect()
      const w = document.documentElement.clientWidth, h = window.innerHeight, gap = 14
      const cw = card.offsetWidth, ch = card.offsetHeight
      let top = (h - ch) / 2, left = (w - cw) / 2
      marker.hidden = !rect
      if (rect) {
        Object.assign(marker.style, { left: rect.left - 3 + 'px', top: rect.top - 3 + 'px', width: rect.width + 6 + 'px', height: rect.height + 6 + 'px' })
        left = rect.left
        if (rect.bottom + gap + ch <= h - gap) top = rect.bottom + gap
        else if (rect.top - gap - ch >= gap) top = rect.top - gap - ch
        else if (rect.right + cw + 2 * gap <= w) { left = rect.right + gap; top = rect.top }
        else top = rect.top > h / 2 ? gap : h - ch - gap
      }
      card.style.left = Math.max(gap, Math.min(w - cw - gap, left)) + 'px'
      card.style.top = Math.max(gap, Math.min(h - ch - gap, top)) + 'px'
    }
    position()
    const resize = new ResizeObserver(position)
    resize.observe(card)
    if (target) resize.observe(target)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [current])

  if (!current) return null
  const last = index === steps.length - 1
  function back() {
    if (index > 0) setCursor(candidates.indexOf(steps[index - 1]))
    else onPreviousPage?.()
  }
  function forward() {
    if (!last) setCursor(candidates.indexOf(steps[index + 1]))
    else if (onNextPage) onNextPage()
    else onFinish()
  }
  return <dialog ref={dialog} className="workspace-tour" aria-label="Omvisning i Nexflow" aria-describedby="tour-description"
    onCancel={event => { event.preventDefault(); onFinish() }}>
    <div className="tour-ring" ref={ring} aria-hidden="true" />
    <article ref={panel} className="tour-card">
      <header><span>{chapterLabel}</span><span>Steg {index + 1} av {steps.length}</span></header>
      <progress aria-label="Fremdrift på denne siden" value={index + 1} max={steps.length} />
      <div aria-live="polite" aria-atomic="true"><h2>{current.title}</h2><p id="tour-description">{current.body}</p></div>
      <footer>
        <button type="button" className="tour-skip" onClick={onFinish}>Hopp over</button>
        {(index > 0 || onPreviousPage) && <Button variant="outline" size="sm" onClick={back}><ArrowLeft />Forrige</Button>}
        <Button size="sm" ref={advance} onClick={forward}>{last ? next ? 'Videre til ' + next.label : 'Fullfør' : 'Neste'}{last && !next ? <Check /> : <ArrowRight />}</Button>
      </footer>
    </article>
  </dialog>
}
