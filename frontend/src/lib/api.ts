import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
// Capture the intent before Supabase consumes the one-time link fragment.
export const passwordLink =
  ['invite', 'recovery'].includes(
    new URLSearchParams(window.location.hash.slice(1)).get('type') || '',
  ) || new URLSearchParams(window.location.search).get('auth') === 'password'
export const supabase = url && key ? createClient(url, key) : null
export const apiUrl = import.meta.env.VITE_API_URL || '/api/v1'

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
  if (!data.session) throw new Error('Logg inn for å fortsette')
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
      Authorization: `Bearer ${data.session.access_token}`,
    },
    cache: 'no-store',
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(
      typeof error.detail === 'string' ? error.detail : 'Kontroller opplysningene og prøv igjen',
    )
  }
  return response.status === 204 ? (undefined as T) : response.json()
}
