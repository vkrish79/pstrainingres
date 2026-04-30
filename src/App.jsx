import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';
import TrainerHomePage from './pages/TrainerHomePage.jsx';
import WorkbookEditorPage from './pages/WorkbookEditorPage.jsx';
import SessionDashboardPage from './pages/SessionDashboardPage.jsx';
import NewSessionPage from './pages/NewSessionPage.jsx';
import PeoplePage from './pages/PeoplePage.jsx';
import ParticipantWorkbookPage from './pages/ParticipantWorkbookPage.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={
        <ProtectedRoute><ChangePasswordPage /></ProtectedRoute>
      } />
      <Route path="/trainer" element={
        <ProtectedRoute role="trainer"><TrainerHomePage /></ProtectedRoute>
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
      <Route path="/workbook" element={
        <ProtectedRoute role="participant"><ParticipantWorkbookPage /></ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
