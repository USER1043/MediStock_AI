/**
 * @file Root application component defining router layout and protected application routes.
 * @module App
 */
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Alerts from './pages/Alerts';
import Inventory from './pages/Inventory';
import Billing from './pages/Billing';
import Reports from './pages/Reports';
import Customers from './pages/Customers';
import StockIntelligence from './pages/StockIntelligence';
import ExcelUpload from './pages/ExcelUpload';
import FinancialReports from './pages/FinancialReports';
import MedicineInventory from './pages/MedicineInventory';
import SupplierManagement from './pages/reorder/SupplierManagement';
import ReorderReview from './pages/reorder/ReorderReview';
import UserManagement from './pages/admin/UserManagement';
import ActivityLog from './pages/ActivityLog';
import DemandSetup from './pages/ai/DemandSetup';
import ForecastReview from './pages/ai/ForecastReview';

// Initializes main application router and context providers.
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

          {/* Persistent Layout for all protected application routes */}
          <Route element={<Layout />}>
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute allowedRoles={['owner', 'staff']}>
                  <Dashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/alerts"
              element={
                <ProtectedRoute allowedRoles={['owner', 'staff']}>
                  <Alerts />
                </ProtectedRoute>
              }
            />

            <Route
              path="/inventory"
              element={
                <ProtectedRoute allowedRoles={['owner', 'staff']}>
                  <Inventory />
                </ProtectedRoute>
              }
            />

            <Route
              path="/billing"
              element={
                <ProtectedRoute allowedRoles={['owner', 'staff']}>
                  <Billing />
                </ProtectedRoute>
              }
            />

            <Route
              path="/customers"
              element={
                <ProtectedRoute allowedRoles={['owner', 'staff']}>
                  <Customers />
                </ProtectedRoute>
              }
            />

            <Route
              path="/excel-upload"
              element={
                <ProtectedRoute allowedRoles={['owner', 'staff']}>
                  <ExcelUpload />
                </ProtectedRoute>
              }
            />

            <Route
              path="/stock-intelligence"
              element={
                <ProtectedRoute allowedRoles={['owner']}>
                  <StockIntelligence />
                </ProtectedRoute>
              }
            />

            <Route
              path="/reports"
              element={
                <ProtectedRoute allowedRoles={['owner']}>
                  <Reports />
                </ProtectedRoute>
              }
            />

            <Route
              path="/financial-reports"
              element={
                <ProtectedRoute allowedRoles={['owner']}>
                  <FinancialReports />
                </ProtectedRoute>
              }
            />

            <Route
              path="/medicine-inventory"
              element={
                <ProtectedRoute allowedRoles={['owner', 'staff']}>
                  <MedicineInventory />
                </ProtectedRoute>
              }
            />

            <Route
              path="/suppliers"
              element={
                <ProtectedRoute allowedRoles={['owner', 'staff']}>
                  <SupplierManagement />
                </ProtectedRoute>
              }
            />

            <Route
              path="/reorder-review"
              element={
                <ProtectedRoute allowedRoles={['owner', 'staff']}>
                  <ReorderReview />
                </ProtectedRoute>
              }
            />

            <Route
              path="/user-management"
              element={
                <ProtectedRoute allowedRoles={['owner']}>
                  <UserManagement />
                </ProtectedRoute>
              }
            />

            <Route
              path="/activity-log"
              element={
                <ProtectedRoute allowedRoles={['owner']}>
                  <ActivityLog />
                </ProtectedRoute>
              }
            />

            {/* AI Demand Forecasting Routes */}
            <Route
              path="/ai/demand-setup"
              element={
                <ProtectedRoute allowedRoles={['owner']}>
                  <DemandSetup />
                </ProtectedRoute>
              }
            />

            <Route
              path="/ai/forecast-review"
              element={
                <ProtectedRoute allowedRoles={['owner', 'staff']}>
                  <ForecastReview />
                </ProtectedRoute>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />

        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
