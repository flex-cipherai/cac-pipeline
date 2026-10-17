import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { SETTINGS_MODULES } from '../../lib/permissions'

// /settings on its own: send the person to the first Settings page they may open. The LinkedIn connect
// flow still returns to /settings?linkedin=..., so that goes straight to Integrations with the result
// kept in the address for that page to show.
export default function SettingsIndex() {
  const { can, homePath } = useAuth()
  const { search } = useLocation()

  if (search.includes('linkedin=') && can('settings_integrations')) {
    return <Navigate to={`/settings/integrations${search}`} replace />
  }

  const first = SETTINGS_MODULES.find(m => can(m.key))
  return <Navigate to={first?.path || homePath || '/login'} replace />
}
