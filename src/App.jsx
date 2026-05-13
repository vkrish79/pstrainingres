import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';
import TrainerHomePage from './pages/TrainerHomePage.jsx';
import WorkbookEditorPage from './pages/WorkbookEditorPage.jsx';
import ImportWorkbookPage from './pages/ImportWorkbookPage.jsx';
import NewWorkbookPage from './pages/NewWorkbookPage.jsx';
import SessionDashboardPage from './pages/SessionDashboardPage.jsx';
import NewSessionPage from './pages/NewSessionPage.jsx';
import PeoplePage from './pages/PeoplePage.jsx';
import VendorsAdminPage from './pages/VendorsAdminPage.jsx';
import ParticipantWorkbookPage from './pages/ParticipantWorkbookPage.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
      <Route path="/trainer/people" element={
        <ProtectedRoute role="trainer"><PeoplePage /></ProtectedRoute>
      } />
      <Route path="/trainer/vendors" element={
        <ProtectedRoute role="super"><VendorsAdminPage /></ProtectedRoute>
      } />
      <Route path="/workbook" element={
        <ProtectedRoute role="participant"><ParticipantWorkbookPage /></ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
