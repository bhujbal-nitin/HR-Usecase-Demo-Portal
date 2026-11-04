import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import { EmployeesProvider } from './context/EmployeesContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import ApprovalsPage from './features/approvals/ApprovalsPage';
import OnboardingSamplesPage from './features/sampleFiles/OnboardingSamplesPage';
import ReimbursementSamplesPage from './features/sampleFiles/ReimbursementSamplesPage';
import AgentCatalog from './features/agents/AgentCatalog';
import AgentDemoPage from './features/agentDemo/AgentDemoPage';
import { AgentDemoProvider } from './features/agentDemo/engine/AgentDemoContext';

export default function App() {
  return (
    <ToastProvider>
      <ThemeProvider>
        <EmployeesProvider>
          <AgentDemoProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<AgentCatalog />} />
              <Route path="agent-demo/:agentId?" element={<AgentDemoPage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="sample-files" element={<Navigate to="/sample-files/onboarding" replace />} />
              <Route path="sample-files/onboarding" element={<OnboardingSamplesPage />} />
              <Route path="sample-files/reimbursement" element={<ReimbursementSamplesPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          </AgentDemoProvider>
        </EmployeesProvider>
      </ThemeProvider>
    </ToastProvider>
  );
}
