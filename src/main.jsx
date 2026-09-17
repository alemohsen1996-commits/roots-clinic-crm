// نقطة الدخول — المسارات فقط، كل شاشة في ملفها
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles.css'

import { AuthProvider } from './auth/AuthContext'
import ConnectionBanner from './layout/ConnectionBanner'
import { RequireAuth, RequireManager } from './auth/guards'
import Login from './auth/Login'
import Shell from './layout/Shell'
import Dashboard from './pages/Dashboard'
import TasksPage from './pages/TasksPage'
import TeamPage from './users/TeamPage'
import LeadsPage from './leads/LeadsPage'
import DealsPage from './deals/DealsPage'
import PaymentsPage from './finance/PaymentsPage'
import InstallmentsPage from './finance/InstallmentsPage'
import PrpPage from './prp/PrpPage'
import ReportsPage from './reports/ReportsPage'
import ArchivePage from './archive/ArchivePage'
import SettingsPage from './settings/SettingsPage'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ConnectionBanner />
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<RequireAuth><Shell /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="team" element={<RequireManager><TeamPage /></RequireManager>} />
            <Route path="leads" element={<LeadsPage />} />
            <Route path="deals" element={<DealsPage />} />
            <Route path="prp" element={<PrpPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="installments" element={<InstallmentsPage />} />
            <Route path="reports" element={<RequireManager><ReportsPage /></RequireManager>} />
            <Route path="archive" element={<RequireManager><ArchivePage /></RequireManager>} />
            <Route path="settings" element={<RequireManager><SettingsPage /></RequireManager>} />
          </Route>

          {/* أي مسار غير معروف (ومنه /register القديم) يعود للرئيسية */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
