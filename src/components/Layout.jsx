/**
 * @file Provides persistent layout shell with sidebar navigation and outlet rendering.
 * @module components/Layout
 */
import { Link, useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  FaTachometerAlt, FaBoxes, FaFileInvoice, FaUsers, FaUsersCog,
  FaChartLine, FaBrain, FaFileUpload, FaSignOutAlt, FaRobot, FaMoneyBillWave, FaPills, FaTruck, FaClipboardList, FaList, FaShieldAlt, FaBell
} from 'react-icons/fa';
import { useState, useEffect, useCallback } from 'react';
import { alertAPI, ALERTS_CHANGED_EVENT } from '../utils/api';
import Chatbot from './Chatbot';
import SecuritySettingsModal from './SecuritySettingsModal';
import logo from '../assets/logo.png';

// Renders persistent application layout shell with sidebar and child routes.
const Layout = ({ children }) => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showChatbot, setShowChatbot] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);

  // Unresolved critical alerts, shown as a badge on the Alerts link.
  // Refreshed on navigation, every 60 s, and when a page reports that alerts changed.
  const [criticalCount, setCriticalCount] = useState(0);
  const canSeeAlerts = ['owner', 'staff'].includes(currentUser?.role);

  const refreshCriticalCount = useCallback(async () => {
    if (!canSeeAlerts) return;
    try {
      const { data } = await alertAPI.getCriticalAlerts();
      setCriticalCount(data.count || 0);
    } catch {
      // keep the last known count; the badge is a hint, not a source of truth
    }
  }, [canSeeAlerts]);

  useEffect(() => {
    refreshCriticalCount();
  }, [refreshCriticalCount, location.pathname]);

  useEffect(() => {
    const timer = setInterval(refreshCriticalCount, 60 * 1000);
    window.addEventListener(ALERTS_CHANGED_EVENT, refreshCriticalCount);
    return () => {
      clearInterval(timer);
      window.removeEventListener(ALERTS_CHANGED_EVENT, refreshCriticalCount);
    };
  }, [refreshCriticalCount]);

  // Handles user logout action and redirects to login.
  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navGroups = [
    {
      title: 'Pharmacy Operations',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: <FaTachometerAlt />, roles: ['owner', 'staff'] },
        { path: '/alerts', label: 'Alerts', icon: <FaBell />, roles: ['owner', 'staff'], badge: criticalCount },
        { path: '/billing', label: 'Billing POS', icon: <FaFileInvoice />, roles: ['owner', 'staff'] },
        { path: '/inventory', label: 'Live Stock', icon: <FaBoxes />, roles: ['owner', 'staff'] },
        { path: '/medicine-inventory', label: 'Medicine DB', icon: <FaPills />, roles: ['owner', 'staff'] },
        { path: '/customers', label: 'Customers', icon: <FaUsers />, roles: ['owner', 'staff'] },
      ]
    },
    {
      title: 'Supply Chain',
      items: [
        { path: '/suppliers', label: 'Suppliers', icon: <FaTruck />, roles: ['owner', 'staff'] },
        { path: '/reorder-review', label: 'Reorders', icon: <FaClipboardList />, roles: ['owner', 'staff'] },
        { path: '/excel-upload', label: 'Bulk Import', icon: <FaFileUpload />, roles: ['owner', 'staff'] },
      ]
    },
    {
      title: 'Intelligence & Reports',
      items: [
        { path: '/stock-intelligence', label: 'Stock AI', icon: <FaBrain />, roles: ['owner'] },
        { path: '/ai/forecast-review', label: 'Forecasts', icon: <FaChartLine />, roles: ['owner', 'staff'] },
        { path: '/ai/demand-setup', label: 'Forecast Setup', icon: <FaBrain />, roles: ['owner'] },
        { path: '/reports', label: 'Analytics', icon: <FaChartLine />, roles: ['owner'] },
        { path: '/financial-reports', label: 'Financials', icon: <FaMoneyBillWave />, roles: ['owner'] },
      ]
    },
    {
      title: 'Administration',
      items: [
        { path: '/user-management', label: 'Users', icon: <FaUsersCog />, roles: ['owner'] },
        { path: '/activity-log', label: 'Activity Log', icon: <FaList />, roles: ['owner'] },
      ]
    }
  ];

  const filteredNavGroups = navGroups.map(group => ({
    ...group,
    items: group.items.filter(item => item.roles.includes(currentUser?.role))
  })).filter(group => group.items.length > 0);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white shadow-lg fixed h-full flex flex-col">
        <div className="p-6 shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-9 w-9 rounded-xl overflow-hidden bg-primary-50 border border-primary-100 shadow-sm flex-shrink-0">
              <img src={logo} alt="MediStock Logo" className="h-full w-full object-cover" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">
              MediStock <span className="text-primary-600">AI</span>
            </h1>
          </div>
          <p className="text-xs text-gray-500">Smart Inventory. Safer Care.</p>
        </div>

        <nav className="px-4 flex-1 overflow-y-auto pt-2 pb-4">
          {filteredNavGroups.map((group, idx) => (
            <div key={idx} className="mb-6">
              <h3 className="px-4 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                {group.title}
              </h3>
              {group.items.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-lg mb-1 transition-colors ${location.pathname === item.path
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'text-gray-700 hover:bg-gray-100'
                    }`}
                >
                  <span className="text-xl">{item.icon}</span>
                  <span className="font-medium text-sm">{item.label}</span>
                  {item.badge > 0 && (
                    <span
                      className={`ml-auto min-w-[1.5rem] text-center text-xs font-bold px-1.5 py-0.5 rounded-full ${location.pathname === item.path ? 'bg-white text-red-600' : 'bg-red-600 text-white'}`}
                      title={`${item.badge} unresolved critical alert${item.badge === 1 ? '' : 's'}`}
                      data-testid="alerts-badge"
                    >
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="p-4 shrink-0 bg-white border-t">
          <div className="bg-gray-50 p-3 rounded-lg mb-3">
            <p className="text-sm font-semibold text-gray-900">{currentUser?.name}</p>
            <p className="text-xs text-gray-500 capitalize">{currentUser?.role}</p>
          </div>
          <button
            onClick={() => setShowSecurityModal(true)}
            className="w-full flex items-center justify-center gap-2 bg-primary-50 text-primary-700 py-2 rounded-lg hover:bg-primary-100 transition-colors mb-2 font-medium shadow-sm"
          >
            <FaShieldAlt />
            <span>2FA Setup</span>
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition-colors"
          >
            <FaSignOutAlt />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 flex-1 p-8">
        {children || <Outlet />}
      </main>

      {/* Chatbot Toggle Button */}
      <button
        onClick={() => setShowChatbot(!showChatbot)}
        className="fixed bottom-6 right-6 bg-primary-600 text-white p-4 rounded-full shadow-2xl hover:bg-primary-700 transition-all z-50"
      >
        <FaRobot className="text-2xl" />
      </button>

      {/* Chatbot Component */}
      {showChatbot && <Chatbot onClose={() => setShowChatbot(false)} />}

      {/* Security Modal Component */}
      {showSecurityModal && <SecuritySettingsModal onClose={() => setShowSecurityModal(false)} />}
    </div>
  );
};

export default Layout;
