import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Layout from './components/Layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Pipeline from './pages/Pipeline'
import AllLeads from './pages/AllLeads'
import Inquiries from './pages/Inquiries'
import QuotationGenerator from './pages/QuotationGenerator'
import Settings from './pages/Settings'
import Notifications from './pages/Notifications'
import MarketingAnalytics from './pages/MarketingAnalytics'
import ResetPassword from './pages/ResetPassword'
import ContentComposer from './pages/social/ContentComposer'
import ContentLibrary from './pages/social/ContentLibrary'
import ContentCalendar from './pages/social/ContentCalendar'
import BulkScheduler from './pages/social/BulkScheduler'
import ApprovalQueue from './pages/social/ApprovalQueue'
import SocialAnalytics from './pages/social/SocialAnalytics'
import WebsiteAnalytics from './pages/social/WebsiteAnalytics'
import ActivityInbox from './pages/social/ActivityInbox'

// Shown to someone whose role has no module switched on in Settings → Permissions.
function NoAccess() {
  const { profile, signOut } = useAuth()
  return (
    <Layout>
      <div className="section-card" style={{ maxWidth: 520, margin: '10vh auto 0', padding: 'var(--space-xl)', textAlign: 'center' }}>
        <h1 className="page-title" style={{ fontSize: 'var(--text-xl)' }}>No modules available</h1>
        <p className="page-subtitle" style={{ lineHeight: 1.6 }}>
          Your {profile?.role} role has not been given access to any part of the system yet. Ask an admin to switch modules on in Settings → Permissions.
        </p>
        <button className="btn btn-secondary" style={{ marginTop: 'var(--space-lg)' }} onClick={signOut}>Sign out</button>
      </div>
    </Layout>
  )
}

// Protected route wrapper. `module` is a key from lib/permissions.js; admins always pass.
function ProtectedRoute({ children, module }) {
  const { user, profile, loading, can, homePath } = useAuth()

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-family)',
      }}>
        Loading...
      </div>
    )
  }

  if (!user || !profile) {
    return <Navigate to="/login" replace />
  }

  if (module && !can(module)) {
    // Send them to the first page they can open instead of a dead end.
    return homePath ? <Navigate to={homePath} replace /> : <NoAccess />
  }

  return <Layout>{children}</Layout>
}

// Redirect authenticated users away from login
function PublicRoute({ children }) {
  const { user, profile, loading, homePath } = useAuth()

  if (loading) return null

  if (user && profile) {
    return homePath ? <Navigate to={homePath} replace /> : <NoAccess />
  }

  return children
}

const BOOKING_URL = 'https://sdfmgroup.com/book'

// Sends the visitor to another site, keeping any ?source= / utm_ params they arrived with.
function ExternalRedirect({ to }) {
  useEffect(() => { window.location.replace(to + window.location.search) }, [to])
  return null
}

// Every signed-in page and the module (lib/permissions.js) that unlocks it.
const PROTECTED_ROUTES = [
  { path: '/dashboard', module: 'dashboard', element: <Dashboard /> },
  { path: '/inquiries', module: 'inquiries', element: <Inquiries /> },
  { path: '/pipeline', module: 'pipeline', element: <Pipeline /> },
  { path: '/leads', module: 'leads', element: <AllLeads /> },
  { path: '/quotations', module: 'quotations', element: <QuotationGenerator /> },
  { path: '/notifications', module: 'notifications', element: <Notifications /> },
  { path: '/settings', module: 'settings', element: <Settings /> },
  { path: '/analytics', module: 'lead_analytics', element: <MarketingAnalytics /> },

  // Social Media Management
  { path: '/social/composer', module: 'social_composer', element: <ContentComposer /> },
  { path: '/social/composer/:id', module: 'social_composer', element: <ContentComposer /> },
  { path: '/social/library', module: 'social_library', element: <ContentLibrary /> },
  { path: '/social/calendar', module: 'social_calendar', element: <ContentCalendar /> },
  { path: '/social/bulk-schedule', module: 'social_bulk', element: <BulkScheduler /> },
  { path: '/social/approvals', module: 'social_approvals', element: <ApprovalQueue /> },
  { path: '/social/analytics', module: 'social_analytics', element: <SocialAnalytics /> },
  { path: '/social/website-analytics', module: 'website_analytics', element: <WebsiteAnalytics /> },
  { path: '/social/activity', module: 'social_activity', element: <ActivityInbox /> },
]

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      {/* The public booking form now lives on the marketing site (sdfmgroup.com/book).
          netlify.toml 301s this path; the route is the fallback for local/dev use. */}
      <Route path="/intake" element={<ExternalRedirect to={BOOKING_URL} />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />

      {/* Protected routes */}
      {PROTECTED_ROUTES.map(({ path, module, element }) => (
        <Route
          key={path}
          path={path}
          element={<ProtectedRoute module={module}>{element}</ProtectedRoute>}
        />
      ))}

      {/* Default redirect */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
