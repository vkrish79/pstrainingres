import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import JoinSessionLoginPage from './pages/JoinSessionLoginPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';
import TrainerHomePage from './pages/TrainerHomePage.jsx';
import WorkbookEditorPage from './pages/WorkbookEditorPage.jsx';
import ImportWorkbookPage from './pages/ImportWorkbookPage.jsx';
import NewWorkbookPage from './pages/NewWorkbookPage.jsx';
import SessionDashboardPage from './pages/SessionDashboardPage.jsx';
import NewSessionPage from './pages/NewSessionPage.jsx';
import VendorsAdminPage from './pages/VendorsAdminPage.jsx';
import VendorSessionsPage from './pages/VendorSessionsPage.jsx';
import ClosedSessionsPage from './pages/ClosedSessionsPage.jsx';
// Lazy: pulls in recharts, so keep it out of the main bundle.
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.jsx'));
import StaffAdminPage from './pages/StaffAdminPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ProgramsListPage from './pages/ProgramsListPage.jsx';
import ProgramEditorPage from './pages/ProgramEditorPage.jsx';
import AssessmentsListPage from './pages/AssessmentsListPage.jsx';
import AssessmentEditorPage from './pages/AssessmentEditorPage.jsx';
import ImportAssessmentPage from './pages/ImportAssessmentPage.jsx';
import ParticipantWorkbookPage from './pages/ParticipantWorkbookPage.jsx';
import ParticipantAssessmentPage from './pages/ParticipantAssessmentPage.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/join/:code" element={<JoinSessionLoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/change-password" element={
        <ProtectedRoute><ChangePasswordPage /></ProtectedRoute>
      } />
      <Route path="/trainer" element={
        <ProtectedRoute role="trainer"><TrainerHomePage /></ProtectedRoute>
      } />
      <Route path="/trainer/workbooks/new" element={
        <ProtectedRoute role="trainer"><NewWorkbookPage /></ProtectedRoute>
      } />
      <Route path="/trainer/workbooks/import" element={
        <ProtectedRoute role="trainer"><ImportWorkbookPage /></ProtectedRoute>
      } />
      <Route path="/trainer/workbooks/:id" element={
        <ProtectedRoute role="trainer"><WorkbookEditorPage /></ProtectedRoute>
      } />
      <Route path="/trainer/sessions/new" element={
        <ProtectedRoute role="trainer"><NewSessionPage /></ProtectedRoute>
      } />
      <Route path="/trainer/sessions/:id" element={
        <ProtectedRoute role="trainer"><SessionDashboardPage /></ProtectedRoute>
      } />
      <Route path="/trainer/archive" element={
        <ProtectedRoute role="trainer"><ClosedSessionsPage /></ProtectedRoute>
      } />
      <Route path="/trainer/analytics" element={
        <ProtectedRoute role="trainer">
          <Suspense fallback={<div className="loading" style={{ padding: '2rem' }}>Loading analytics…</div>}>
            <AnalyticsPage />
          </Suspense>
        </ProtectedRoute>
      } />
      <Route path="/trainer/vendors" element={
        <ProtectedRoute role="super"><VendorsAdminPage /></ProtectedRoute>
      } />
      <Route path="/trainer/vendors/:vendorId/sessions" element={
        <ProtectedRoute role="super"><VendorSessionsPage /></ProtectedRoute>
      } />
      <Route path="/trainer/staff" element={
        <ProtectedRoute role="super"><StaffAdminPage /></ProtectedRoute>
      } />
      <Route path="/trainer/settings" element={
        <ProtectedRoute role="super"><SettingsPage /></ProtectedRoute>
      } />
      <Route path="/trainer/programs" element={
        <ProtectedRoute role="super"><ProgramsListPage /></ProtectedRoute>
      } />
      <Route path="/trainer/programs/:id" element={
        <ProtectedRoute role="super"><ProgramEditorPage /></ProtectedRoute>
      } />
      <Route path="/trainer/assessments" element={
        <ProtectedRoute role="super"><AssessmentsListPage /></ProtectedRoute>
      } />
      <Route path="/trainer/assessments/import" element={
        <ProtectedRoute role="super"><ImportAssessmentPage /></ProtectedRoute>
      } />
      <Route path="/trainer/assessments/:id" element={
        <ProtectedRoute role="super"><AssessmentEditorPage /></ProtectedRoute>
      } />
      <Route path="/workbook" element={
        <ProtectedRoute role="participant"><ParticipantWorkbookPage /></ProtectedRoute>
      } />
      <Route path="/assessment" element={
        <ProtectedRoute role="participant"><ParticipantAssessmentPage /></ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
