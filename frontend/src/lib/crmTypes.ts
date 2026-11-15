export type Project = {
  id: string
  name: string
  description: string
  active: boolean
  kind: string
  project_type?: string
  role: string
  partner_id: string
}
export type Lead = {
  id: string
  project_id: string
  company: string
  contact: string
  phone: string
  kind: 'b2b' | 'b2c'
  status: string
  priority: number
  industry: string
  city: string
  summary: string
  blocked: boolean
  review_required?: boolean
  enrichment: Record<string, unknown>
  reserved_by?: string | null
  callback_at?: string | null
}
export type Product = { id: string; name: string; price_ore: number }
export type Sale = {
  can_manage_documents?: boolean
  id: string
  lead_id: string
  amount_ore: number
  status: string
  created_at: string
  allocation: { seller: number; hub: number; partner: number }
}
export type Meeting = {
  id: string
  lead_id: string
  starts_at: string
  ends_at: string
  outcome: string
  closer_id: string
  qualification: Record<string, string>
}
