import {
  Phone,
  CalendarDays,
  LayoutDashboard,
  Wallet,
  BriefcaseBusiness,
  Search,
  ListTodo,
  BarChart3,
} from 'lucide-react'

export type View =
  | 'overview'
  | 'leads'
  | 'meetings'
  | 'sales'
  | 'projects'
  | 'reports'
  | 'tasks'
  | 'queues'
  | 'customers'
  | 'discovery'

// This order is shared by the sidebar and the tour after filtering pages by project role.
export const navigation: { id: View; label: string; icon: typeof Phone }[] = [
  { id: 'overview', label: 'Oversikt', icon: LayoutDashboard },
  { id: 'leads', label: 'Ringeliste', icon: Phone },
  { id: 'queues', label: 'Ringekøer', icon: Phone },
  { id: 'customers', label: 'Kunder', icon: BriefcaseBusiness },
  { id: 'discovery', label: 'Finn bedrifter', icon: Search },
  { id: 'meetings', label: 'Møter', icon: CalendarDays },
  { id: 'sales', label: 'Salg og opptjening', icon: Wallet },
  { id: 'projects', label: 'Prosjekter', icon: BriefcaseBusiness },
  { id: 'tasks', label: 'Oppfølging', icon: ListTodo },
  { id: 'reports', label: 'Rapporter', icon: BarChart3 },
]
