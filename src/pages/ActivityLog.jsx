/**
 * @file System activity log page component displaying audit trails and filter options.
 * @module pages/ActivityLog
 */
import { useState, useEffect, useCallback } from 'react';
import axiosInstance from '../utils/axiosConfig';
import {
    FaShieldAlt,
    FaSearch,
    FaFilter,
    FaSyncAlt,
    FaUser,
    FaCalendarAlt,
    FaChevronLeft,
    FaChevronRight,
    FaExclamationTriangle,
    FaDownload,
} from 'react-icons/fa';

// ── Audit actions and modules ───────────────────────────────────
// Keep in step with AUDIT_ACTIONS / AUDIT_MODULES in server/models/auditLogModel.js.
// Older values (e.g. the generic DELETE) stay so existing entries still render.
const ACTION_OPTIONS = [
    // Users
    { value: 'USER_LOGIN', label: '🔑 User Login', bg: 'bg-blue-100', text: 'text-blue-700' },
    { value: 'USER_CREATED', label: '👤 User Created', bg: 'bg-green-100', text: 'text-green-700' },
    { value: 'USER_UPDATED', label: '✏️ User Updated', bg: 'bg-yellow-100', text: 'text-yellow-700' },
    { value: 'USER_DELETED', label: '🗑️ User Deleted', bg: 'bg-red-100', text: 'text-red-700' },
    { value: 'TWO_FA_ENABLED', label: '🛡️ 2FA Enabled', bg: 'bg-blue-100', text: 'text-blue-700' },
    // Inventory
    { value: 'MEDICINE_CREATED', label: '💊 Medicine Created', bg: 'bg-teal-100', text: 'text-teal-700' },
    { value: 'MEDICINE_UPDATED', label: '📝 Medicine Updated', bg: 'bg-teal-100', text: 'text-teal-700' },
    { value: 'MEDICINE_DELETED', label: '❌ Medicine Deleted', bg: 'bg-red-100', text: 'text-red-700' },
    { value: 'STOCK_UPDATE', label: '📦 Stock Update', bg: 'bg-cyan-100', text: 'text-cyan-700' },
    { value: 'EXCEL_UPLOAD', label: '📤 Excel Bulk Upload', bg: 'bg-purple-100', text: 'text-purple-700' },
    // Billing
    { value: 'BILL_GENERATED', label: '🧾 Bill Generated', bg: 'bg-emerald-100', text: 'text-emerald-700' },
    { value: 'PAYMENT_CONFIRMED', label: '💳 Payment Confirmed', bg: 'bg-emerald-100', text: 'text-emerald-700' },
    // Customers
    { value: 'CUSTOMER_CREATED', label: '🧑 Customer Created', bg: 'bg-sky-100', text: 'text-sky-700' },
    { value: 'CUSTOMER_UPDATED', label: '✏️ Customer Updated', bg: 'bg-sky-100', text: 'text-sky-700' },
    { value: 'CUSTOMER_DELETED', label: '🗑️ Customer Deleted', bg: 'bg-red-100', text: 'text-red-700' },
    // Suppliers and orders
    { value: 'SUPPLIER_CREATED', label: '🏭 Supplier Created', bg: 'bg-indigo-100', text: 'text-indigo-700' },
    { value: 'SUPPLIER_UPDATED', label: '🏭 Supplier Updated', bg: 'bg-indigo-100', text: 'text-indigo-700' },
    { value: 'ORDER_CREATED', label: '🛒 Order Created', bg: 'bg-violet-100', text: 'text-violet-700' },
    { value: 'ORDER_STATUS_UPDATE', label: '🔄 Order Status Update', bg: 'bg-fuchsia-100', text: 'text-fuchsia-700' },
    // Categories
    { value: 'CATEGORY_CREATED', label: '🏷️ Category Created', bg: 'bg-amber-100', text: 'text-amber-700' },
    { value: 'CATEGORY_APPROVED', label: '🏷️ Category Approved', bg: 'bg-amber-100', text: 'text-amber-700' },
    // Forecasting
    { value: 'FORECAST_RUN', label: '📈 Forecast Run', bg: 'bg-lime-100', text: 'text-lime-700' },
    { value: 'MODEL_RETRAINED', label: '🧠 Model Retrained', bg: 'bg-lime-100', text: 'text-lime-700' },
    { value: 'FORECAST_SETTINGS_UPDATED', label: '⚙️ Forecast Settings Updated', bg: 'bg-lime-100', text: 'text-lime-700' },
    { value: 'RECOMMENDATION_CREATED', label: '💡 Recommendation Created', bg: 'bg-lime-100', text: 'text-lime-700' },
    { value: 'RECOMMENDATION_UPDATED', label: '💡 Recommendation Updated', bg: 'bg-lime-100', text: 'text-lime-700' },
    { value: 'RECOMMENDATION_DELETED', label: '🗑️ Recommendation Deleted', bg: 'bg-red-100', text: 'text-red-700' },
    { value: 'REORDER_APPROVED', label: '🔁 Reorder Approved', bg: 'bg-lime-100', text: 'text-lime-700' },
    // Alerts
    { value: 'ALERT_RESOLVED', label: '✅ Alert Resolved', bg: 'bg-orange-100', text: 'text-orange-700' },
    // System
    { value: 'TEMPORAL_REFRESH', label: '🕒 Demo Data Refreshed', bg: 'bg-gray-100', text: 'text-gray-600' },
    { value: 'DELETE', label: '🗑️ Delete', bg: 'bg-red-200', text: 'text-red-800' },
    { value: 'OTHER', label: '⚙️ Other', bg: 'bg-gray-100', text: 'text-gray-600' },
];

const MODULE_OPTIONS = [
    'Inventory', 'Billing', 'Customers', 'UserManagement', 'DataImport',
    'Alerts', 'Orders', 'Suppliers', 'Categories', 'Forecasting', 'System',
];

// ── Helpers ─────────────────────────────────────────────────────
const fmtDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    });
};

const detailsText = (details) => {
    if (!details || typeof details !== 'object') return String(details || '—');
    const parts = [];
    if (details.fileName) parts.push(`File: ${details.fileName}`);
    if (details.recordsSuccessful !== undefined) parts.push(`✓ ${details.recordsSuccessful} ok`);
    if (details.recordsFailed !== undefined) parts.push(`✗ ${details.recordsFailed} failed`);
    if (details.role) parts.push(`Role: ${details.role}`);
    if (details.medicineName) parts.push(`Medicine: ${details.medicineName}`);
    if (details.alertType) parts.push(`Alert: ${details.alertType.replace('_', ' ')}`);
    if (details.body && typeof details.body === 'object') {
        const keys = Object.keys(details.body).filter(k => !['password', 'token'].includes(k)).slice(0, 3);
        keys.forEach(k => parts.push(`${k}: ${String(details.body[k]).slice(0, 30)}`));
    }
    return parts.length ? parts.join('  ·  ') : JSON.stringify(details).slice(0, 80);
};

// ── Stat Card ────────────────────────────────────────────────────
function StatCard({ label, value, icon, colorClass }) {
    return (
        <div className={`bg-white rounded-xl shadow-sm p-4 border-l-4 ${colorClass} flex items-center gap-3`}>
            <div className="text-2xl opacity-70">{icon}</div>
            <div>
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">{label}</p>
                <p className="text-xl font-bold text-gray-900">{value}</p>
            </div>
        </div>
    );
}

// ── Action Badge ─────────────────────────────────────────────────
function ActionBadge({ action }) {
    const found = ACTION_OPTIONS.find(a => a.value === action);
    const { bg, text } = found || ACTION_OPTIONS.find(a => a.value === 'OTHER');
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${bg} ${text}`}>
            {found ? found.label : action}
        </span>
    );
}

// ── Main Component ───────────────────────────────────────────────
export default function ActivityLog() {
    const [logs, setLogs] = useState([]);
    const [stats, setStats] = useState(null);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);

    // Pagination
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const LIMIT = 20;

    // Filters
    const [filters, setFilters] = useState({
        username: '',
        module: '',
        action: '',
        startDate: '',
        endDate: '',
    });
    const [applied, setApplied] = useState({});

    // ── Fetch ──────────────────────────────────────────────────────
    const fetchLogs = useCallback(async (currentFilters, currentPage, isRefresh = false) => {
        try {
            isRefresh ? setRefreshing(true) : setLoading(true);
            setError(null);

            const params = { page: currentPage, limit: LIMIT };
            Object.entries(currentFilters).forEach(([k, v]) => { if (v) params[k] = v; });

            const [logsRes, statsRes, usersRes] = await Promise.all([
                axiosInstance.get('/audit', { params }),
                axiosInstance.get('/audit/stats'),
                axiosInstance.get('/auth/users'),
            ]);

            setLogs(logsRes.data.logs);
            setTotal(logsRes.data.total);
            setPages(logsRes.data.pages);
            setStats(statsRes.data.stats);
            if (usersRes.data.users) setUsers(usersRes.data.users);
        } catch (err) {
            console.error('Audit log error:', err);
            setError('Failed to load audit logs. Make sure you have owner access.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchLogs(applied, page);
    }, [fetchLogs, applied, page]);

    const applyFilters = () => {
        setApplied({ ...filters });
        setPage(1);
    };

    const resetFilters = () => {
        const empty = { username: '', module: '', action: '', startDate: '', endDate: '' };
        setFilters(empty);
        setApplied(empty);
        setPage(1);
    };

    const handleRefresh = () => fetchLogs(applied, page, true);

    // ─────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">Loading activity logs…</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <FaExclamationTriangle className="text-4xl text-red-400 mx-auto mb-3" />
                    <p className="text-red-600 font-medium">{error}</p>
                    <button onClick={handleRefresh} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition">
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">

                {/* ── Header ──────────────────────────────────────────── */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <FaShieldAlt className="text-3xl text-blue-600" />
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">System Activity Log</h1>
                            <p className="text-sm text-gray-500">Read-only audit trail · Owner access only</p>
                        </div>
                    </div>
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium shadow-sm transition"
                    >
                        <FaSyncAlt className={refreshing ? 'animate-spin text-blue-500' : ''} />
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                    </button>
                </div>

                {/* ── Stats Row ───────────────────────────────────────── */}
                {stats && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        <StatCard label="Total Entries" value={stats.total.toLocaleString()} icon="📋" colorClass="border-blue-500" />
                        <StatCard label="Today" value={stats.todayCount} icon="🕐" colorClass="border-green-500" />
                        <StatCard label="Top Module" value={stats.topModule} icon="📦" colorClass="border-purple-500" />
                    </div>
                )}

                {/* ── Filter Bar ──────────────────────────────────────── */}
                <div className="bg-white rounded-xl shadow-sm p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <FaFilter className="text-blue-500" />
                        <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Filter Logs</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">User</label>
                            <select
                                value={filters.username}
                                onChange={e => setFilters(f => ({ ...f, username: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                                <option value="">All Users</option>
                                {users.map(u => (
                                    <option key={u._id} value={u.username}>
                                        {u.username} ({u.role})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Module</label>
                            <select
                                value={filters.module}
                                onChange={e => setFilters(f => ({ ...f, module: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                                <option value="">All Modules</option>
                                {MODULE_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Action</label>
                            <select
                                value={filters.action}
                                onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                                <option value="">All Actions</option>
                                {ACTION_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
                            <div className="relative">
                                <FaCalendarAlt className="absolute left-2.5 top-2.5 text-gray-400 text-xs" />
                                <input
                                    type="date"
                                    value={filters.startDate}
                                    onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))}
                                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
                            <input
                                type="date"
                                value={filters.endDate}
                                onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                        </div>
                    </div>
                    <div className="flex gap-3 mt-4">
                        <button
                            onClick={applyFilters}
                            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition flex items-center gap-2"
                        >
                            <FaSearch /> Search
                        </button>
                        <button
                            onClick={resetFilters}
                            className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 transition"
                        >
                            Reset
                        </button>
                    </div>
                </div>

                {/* ── Table ───────────────────────────────────────────── */}
                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                        <p className="text-sm text-gray-600">
                            Showing <span className="font-semibold">{logs.length}</span> of{' '}
                            <span className="font-semibold">{total.toLocaleString()}</span> entries
                        </p>
                        <span className="text-xs text-gray-400 italic flex items-center gap-1">
                            🔒 Read-only — no edits or deletes permitted
                        </span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    {['Timestamp', 'User', 'Module', 'Action', 'Details', 'IP Address', 'Status'].map(h => (
                                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {logs.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                                            No audit logs found for the selected filters.
                                        </td>
                                    </tr>
                                ) : (
                                    logs.map((logEntry) => (
                                        <tr key={logEntry._id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                                                {fmtDate(logEntry.timestamp)}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className="font-medium text-gray-800">{logEntry.username}</span>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-medium">
                                                    {logEntry.module}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <ActionBadge action={logEntry.action} />
                                            </td>
                                            <td className="px-4 py-3 max-w-xs">
                                                <span className="text-gray-600 text-xs truncate block" title={JSON.stringify(logEntry.details)}>
                                                    {detailsText(logEntry.details)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs font-mono">
                                                {logEntry.ipAddress}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${logEntry.statusCode < 300
                                                    ? 'bg-green-100 text-green-700'
                                                    : 'bg-red-100 text-red-700'
                                                    }`}>
                                                    {logEntry.statusCode}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* ── Pagination ────────────────────────────────────── */}
                    {pages > 1 && (
                        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
                            <p className="text-xs text-gray-500">Page {page} of {pages}</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition"
                                >
                                    <FaChevronLeft /> Prev
                                </button>
                                {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                                    const p = Math.max(1, Math.min(page - 2, pages - 4)) + i;
                                    return p <= pages ? (
                                        <button
                                            key={p}
                                            onClick={() => setPage(p)}
                                            className={`w-8 h-8 text-xs rounded-lg border transition ${p === page
                                                ? 'bg-blue-600 text-white border-blue-600'
                                                : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700'
                                                }`}
                                        >
                                            {p}
                                        </button>
                                    ) : null;
                                })}
                                <button
                                    onClick={() => setPage(p => Math.min(pages, p + 1))}
                                    disabled={page === pages}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition"
                                >
                                    Next <FaChevronRight />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
    );
}
