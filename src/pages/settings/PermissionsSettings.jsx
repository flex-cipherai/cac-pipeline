import PermissionsManager from '../../components/PermissionsManager/PermissionsManager'
import { SettingsHeading } from './SettingsLayout'
import useToast from './useToast'

export default function PermissionsSettings() {
  const { showToast, toast } = useToast()

  return (
    <div>
      <SettingsHeading title="Permissions" hint="Which modules each role can open. The menu, the pages and the data all follow this table." />
      <PermissionsManager showToast={showToast} />
      {toast}
    </div>
  )
}
