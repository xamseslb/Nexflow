import { request, type Lead, type Project } from '@/lib/api'
import type { CallEntry } from '@/components/CallHistory'

export const categories = { hot: 'Hot', cold: 'Cold', winback: 'Winback' } as const
export type Category = keyof typeof categories
export type CallList = { id: string; name: string; category: Category; assignee_id: string | null; lead_count: number }
export type Member = { id: string; name?: string; role: string }
export type QueueLead = Lead & { call_list_id?: string | null }
export type NewList = Pick<CallList, 'name' | 'category' | 'assignee_id'>
export type CallResult = { outcome: string; note: string; callback_at: string | null }
const change = (method: string, data?: unknown) => ({ method, body: data === undefined ? undefined : JSON.stringify(data) })

export function projectQueues(projectId: string) {
  const root = `/projects/${projectId}`
  const base = `${root}/call-lists`
  return {
    lists: () => request<CallList[]>(base),
    team: () => request<Member[]>(`${root}/team`),
    create: (input: NewList) => request(base, change('POST', input)),
    assign: (id: string, assignee_id: string | null) => request(`${base}/${id}`, change('PATCH', { assignee_id })),
    move: (id: string, lead_ids: string[]) => request(`${base}/${id}/leads`, change('POST', { lead_ids })),
    search: (query: string, signal: AbortSignal) => request<QueueLead[]>(`${root}/leads?${new URLSearchParams({ search: query })}`, { signal }),
    next: async (id: string) => (await request<{ lead: Lead | null }>(`${base}/${id}/next`, change('POST'))).lead,
    authorize: (id: string) => request<{ id: string; phone: string }>(`${root}/leads/${id}/call-authorization`, change('POST')),
    finish: async (id: string, leadId: string, result: CallResult) => {
      const save = () => request(`${root}/calls/${id}`, change('PATCH', result))
      try { return await save() }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'Reservasjonen er utløpt. Reserver leadet på nytt før utfallet lagres.') throw error
        await request(`${root}/leads/${leadId}/reserve`, change('POST'))
        return save()
      }
    },
    release: (id: string) => request(`${root}/leads/${id}/reservation`, change('DELETE'))
  }
}

// One in-memory demonstration per project. All live decisions belong to FastAPI.
export const demoTeam: Member[] = [
    { id: 'demo-me', name: 'Deg', role: 'leader' },
    { id: 'demo-seller', name: 'Alex · demoselger', role: 'seller' }
  ]
export class DemoQueues {
  readonly team = demoTeam
  lists: CallList[]
  membership = new Map<string, string>()
  history: Record<string, CallEntry[]> = {}
  private finished = new Set<string>()
  private callbacks = new Map<string, number>()
  private reopened = new Set<string>()
  constructor(project: Project) {
    this.lists = []
    if (project.id !== 'demo-1') return
    for (const [category, ids] of [['hot', ['1', '2']], ['cold', ['3', '7']], ['winback', ['5']]] as const) {
      const id = `demo-${category}`
      this.lists.push({ id, category, name: { hot: 'Interesserte bedrifter', cold: 'Nye bedriftskontakter', winback: 'Tidligere kunder' }[category], assignee_id: 'demo-me', lead_count: 0 })
      ids.forEach(leadId => this.membership.set(leadId, id))
    }
  }
  snapshot() {
    return this.lists.map(list => ({ ...list, lead_count: [...this.membership.values()].filter(id => id === list.id).length }))
  }
  create(input: NewList) {
    this.lists.push({ ...input, id: crypto.randomUUID(), lead_count: 0 })
  }
  assign(id: string, assignee: string | null) {
    const list = this.lists.find(row => row.id === id)
    if (list) list.assignee_id = assignee
  }
  move(list: CallList, leads: Lead[]) {
    for (const lead of leads) {
      if (this.membership.get(lead.id) === list.id) continue
      this.membership.set(lead.id, list.id)
      this.finished.delete(lead.id)
      if (list.category === 'winback' && lead.status === 'declined' && !lead.blocked) this.reopened.add(lead.id)
    }
  }
  next(id: string, leads: Lead[]) {
    const eligible = leads.filter(lead =>
      this.membership.get(lead.id) === id && !this.finished.has(lead.id) && !lead.blocked &&
      (['new', 'callback'].includes(lead.status) || this.reopened.has(lead.id)) &&
      (this.callbacks.get(lead.id) ?? (Date.parse(lead.callback_at || '') || 0)) <= Date.now()
    )
    const dueAt = (lead: Lead) => this.callbacks.get(lead.id) ?? (Date.parse(lead.callback_at || '') || Infinity)
    return eligible.sort((a, b) => dueAt(a) - dueAt(b) || b.priority - a.priority)[0] || null
  }
  finish(leadId: string, result: CallResult) {
    if (result.callback_at) this.callbacks.set(leadId, Date.parse(result.callback_at))
    else this.finished.add(leadId)
    this.reopened.delete(leadId)
    const entry = { id: crypto.randomUUID(), completed_at: new Date().toISOString(), outcome: result.outcome, note: result.note }
    this.history[leadId] = [entry, ...(this.history[leadId] || [])].slice(0, 10)
    return entry
  }
}

