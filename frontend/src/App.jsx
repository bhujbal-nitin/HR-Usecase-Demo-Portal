import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import { AuthProvider } from './context/AuthContext';
import { EmployeesProvider } from './context/EmployeesContext';
import AuthGate from './features/auth/AuthGate';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import AdminPage from './features/admin/AdminPage';
import ApprovalsPage from './features/approvals/ApprovalsPage';
import OnboardingSamplesPage from './features/sampleFiles/OnboardingSamplesPage';
import PreOnboardingSamplesPage from './features/sampleFiles/PreOnboardingSamplesPage';
import ReimbursementSamplesPage from './features/sampleFiles/ReimbursementSamplesPage';
import AgentCatalog from './features/agents/AgentCatalog';
import AgentDemoPage from './features/agentDemo/AgentDemoPage';
import { AgentDemoProvider } from './features/agentDemo/engine/AgentDemoContext';

// The simulated HRMS (HRMS replica) is loaded only when someone opens it.
const HrmsApp = lazy(() => import('./features/hrms/HrmsApp'));

export default function App() {
  return (
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider>
        <AuthGate>
        <EmployeesProvider>
          <AgentDemoProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<AgentCatalog />} />
              <Route path="agent-demo/:agentId?" element={<AgentDemoPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="sample-files" element={<Navigate to="/sample-files/onboarding" replace />} />
              <Route path="sample-files/pre-onboarding" element={<PreOnboardingSamplesPage />} />
              <Route path="sample-files/onboarding" element={<OnboardingSamplesPage />} />
              <Route path="sample-files/reimbursement" element={<ReimbursementSamplesPage />} />
              <Route path="simulated/hrms/*" element={<Suspense fallback={<div className="hrms-root hrms-loading">Opening HRMS...</div>}><HrmsApp /></Suspense>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          </AgentDemoProvider>
        </EmployeesProvider>
        </AuthGate>
        </AuthProvider>
      </ThemeProvider>
    </ToastProvider>
  );
}
