// Fictional records for the in-memory workspace. Real sessions load records from FastAPI.
import type { Lead, Meeting, Product, Project, Sale } from '@/lib/crmTypes'

export const demoProjects: Project[] = [
  {
    id: 'demo-1',
    partner_id: 'p1',
    name: 'Digitale vekstpakker',
    project_type: 'Direktesalg',
    description: 'Nettsider og synlighet for norske bedrifter',
    kind: 'b2b',
    role: 'leader',
    active: true,
  },
  {
    id: 'demo-2',
    partner_id: 'p2',
    name: 'Smartere arbeidsdag',
    project_type: 'Møtebooking',
    description: 'Programvare som gir teamet tid tilbake',
    kind: 'b2b',
    role: 'leader',
    active: true,
  },
]

export const demoLeads: Lead[] = [
  [
    '1',
    'Fjord & Form',
    'Emma Berg',
    'Arkitektur og design',
    'Bergen',
    98,
    'new',
    'Et lite arkitektkontor med store ambisjoner. De ønsker flere henvendelser fra lokale bedrifter og en nettside som viser frem prosjektene deres.',
  ],
  [
    '2',
    'Nordlys Elektro',
    'Jonas Vik',
    'Elektro og installasjon',
    'Tromsø',
    92,
    'callback',
    'Et etablert elektrofirma med fokus på smarte hjem. Ta opp hvordan en tydeligere digital profil kan gjøre det enklere å finne riktig tjeneste.',
  ],
  [
    '3',
    'Løkka Kaffebrenneri',
    'Sara Holm',
    'Mat og drikke',
    'Oslo',
    87,
    'new',
    'Lokalt kaffebrenneri med nettbutikk. Utforsk behov for bedre synlighet og en enklere bestillingsopplevelse for bedriftskunder.',
  ],
  [
    '4',
    'Vest Byggpartner',
    'Marius Dahl',
    'Bygg og anlegg',
    'Stavanger',
    81,
    'meeting',
    'Voksende entreprenør med mange referanseprosjekter. Et kvalifiseringsmøte er planlagt for å avklare behov og tidslinje.',
  ],
  [
    '5',
    'Grønn Hverdag',
    'Ida Solberg',
    'Handel og bærekraft',
    'Trondheim',
    76,
    'new',
    'Butikk med bærekraftige hverdagsprodukter. Ønsker å nå flere lokale kunder.',
  ],
  [
    '6',
    'Havblikk Studio',
    'Noah Strand',
    'Foto og kommunikasjon',
    'Ålesund',
    70,
    'sold',
    'Fotostudio som har valgt en ny digital vekstpakke.',
  ],
  [
    '7',
    'Eksempelkontakt',
    'Testperson',
    'Forbruker',
    'Oslo',
    65,
    'new',
    'Demonstrerer sperring av B2C-kontakt uten gyldig samtykke.',
  ],
].map(([id, company, contact, industry, city, priority, status, summary]) => ({
  id: String(id),
  project_id: 'demo-1',
  company: String(company),
  contact: String(contact),
  industry: String(industry),
  city: String(city),
  priority: Number(priority),
  status: String(status),
  summary: String(summary),
  phone: 'Kun demonstrasjon',
  kind: id === '7' ? 'b2c' : 'b2b',
  blocked: id === '7',
  enrichment:
    id === '1'
      ? { employees: 12, city: String(city), industry: String(industry), source: 'Eksempeldata' }
      : {},
}))
export const demoProducts: Product[] = [
  { id: 'growth', name: 'Vekstpakke · Nettside', price_ore: 2490000 },
  { id: 'visibility', name: 'Synlighet · Oppstart', price_ore: 990000 },
]
export const demoSales: Sale[] = [
  {
    id: 'sale-demo',
    lead_id: '6',
    amount_ore: 2490000,
    status: 'registered',
    created_at: new Date().toISOString(),
    allocation: { seller: 249000, hub: 498000, partner: 1743000 },
  },
]
export function initialMeetings(): Meeting[] {
  const start = new Date()
  start.setDate(start.getDate() + 1)
  start.setHours(10, 0, 0, 0)
  return [
    {
      id: 'meeting-demo',
      lead_id: '4',
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 30 * 60000).toISOString(),
      outcome: 'booked',
      closer_id: 'demo-closer',
      qualification: { behov: 'Ny nettside og flere henvendelser', budsjett: '25 000–40 000 kr' },
    },
  ]
}
