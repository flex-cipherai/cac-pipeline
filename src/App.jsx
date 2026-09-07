import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Layout from './components/Layout/Layout'
import Login from './pages/Login'
import LeadIntakeForm from './pages/LeadIntakeForm'
import Dashboard from './pages/Dashboard'
import Pipeline from './pages/Pipeline'
import AllLeads from './pages/AllLeads'
import Settings from './pages/Settings'
import Notifications from './pages/Notifications'
import MarketingAnalytics from './pages/MarketingAnalytics'
import ResetPassword from './pages/ResetPassword'

// Protected route wrapper
function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuth()

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

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    // Redirect to the appropriate default page based on role
    if (profile.role === 'marketing') {
      return <Navigate to="/analytics" replace />
    }
    return <Navigate to="/dashboard" replace />
  }

  return <Layout>{children}</Layout>
}

// Redirect authenticated users away from login
function PublicRoute({ children }) {
  const { user, profile, loading } = useAuth()

  if (loading) return null

  if (user && profile) {
    if (profile.role === 'marketing') {
      return <Navigate to="/analytics" replace />
    }
    return <Navigate to="/dashboard" replace />
  }

  return children
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/intake" element={<LeadIntakeForm />} />
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
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute allowedRoles={['admin', 'sales']}>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/pipeline"
        element={
          <ProtectedRoute allowedRoles={['admin', 'sales']}>
            <Pipeline />
          </ProtectedRoute>
        }
      />
      <Route
        path="/leads"
        element={
          <ProtectedRoute allowedRoles={['admin', 'sales']}>
            <AllLeads />
          </ProtectedRoute>
        }
      />
      <Route
        path="/notifications"
        element={
          <ProtectedRoute allowedRoles={['admin', 'sales']}>
            <Notifications />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute allowedRoles={['admin', 'sales']}>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute allowedRoles={['marketing']}>
            <MarketingAnalytics />
          </ProtectedRoute>
        }
      />

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
