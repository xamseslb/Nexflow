import { request } from './api'
import type { Lead, Meeting, Product, Sale } from './crmTypes'

// The workspace displays these four lists together after opening or refreshing a project.
export async function loadProjectRecords(id: string) {
  const root = `/projects/${id}`
  const [leads, sales, products, meetings] = await Promise.all([
    request<Lead[]>(`${root}/leads`),
    request<Sale[]>(`${root}/sales`),
    request<Product[]>(`${root}/products`),
    request<Meeting[]>(`${root}/meetings`),
  ])
  return { leads, sales, products, meetings }
}
