/**
 * @file Dashboard and analytics overview page component.
 * @module pages/Dashboard
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../utils/axiosConfig';
import { useAuth } from '../context/AuthContext';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  ResponsiveContainer,
} from 'recharts';
import {
  FaBoxes,
  FaExclamationTriangle,
  FaClock,
  FaUsers,
  FaRupeeSign,
  FaFileInvoice,
  FaChartLine,
  FaPills,
  FaCloudUploadAlt,
  FaBrain,
  FaFilter,
  FaSyncAlt,
  FaBell,
  FaList,
  FaMoneyBillWave,
  FaTachometerAlt,
  FaUsersCog,
  FaFileUpload,
  FaTruck,
  FaClipboardList
} from 'react-icons/fa';

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const shortDate = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

const CHART_COLORS = ['#22c55e', '#f59e0b', '#3b82f6', '#a855f7', '#ef4444'];

// ─── Sub-components ─────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, colorClass, bgClass }) {
  return (
    <div className={`bg-white rounded-xl shadow-md p-5 border-l-4 ${colorClass} flex items-center gap-4`}>
      <div className={`p-3 rounded-full ${bgClass} text-xl`}>{icon}</div>
      <div>
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function SectionHeader({ title, icon }) {
  return (
    <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
      <span className="text-blue-600">{icon}</span>
      {title}
    </h2>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="bg-white rounded-xl shadow-md p-5">
      <h3 className="text-sm font-bold text-gray-700 mb-4 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' && p.name.toLowerCase().includes('revenue')
            ? `₹${fmt(p.value)}`
            : p.value}
        </p>
      ))}
    </div>
  );
};

// ─── Main Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const { currentUser, hasRole } = useAuth();
  const isOwner = hasRole('owner');

  // Analytics state
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Filtered sales trend (owner-only)
  const [filteredSales, setFilteredSales] = useState([]);
  const [filterLoading, setFilterLoading] = useState(false);

  // Filter form state
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    category: '',
    supplier: '',
  });
  const [suppliers, setSuppliers] = useState([]);
  const [filtersApplied, setFiltersApplied] = useState(false);

  // ── Fetch main analytics ──────────────────────────────────────────────────
  const fetchAnalytics = useCallback(async (isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);

      const res = await axiosInstance.get('/reports/dashboard/analytics');
      const data = res.data.analytics;
      setAnalytics(data);
      setFilteredSales(data.salesTrend);
    } catch (err) {
      console.error('Dashboard analytics error:', err);
      setError('Failed to load dashboard data. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load + fetch suppliers for filter dropdown
  useEffect(() => {
    fetchAnalytics();
    if (isOwner) {
      axiosInstance.get('/suppliers').then((r) =>
        setSuppliers(r.data.suppliers || [])
      ).catch(() => { });
    }
  }, [fetchAnalytics, isOwner]);

  // ── Apply filters ─────────────────────────────────────────────────────────
  const applyFilters = async () => {
    if (!isOwner) return;
    setFilterLoading(true);
    setFiltersApplied(false);
    try {
      const params = {};
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.category) params.category = filters.category;
      if (filters.supplier) params.supplier = filters.supplier;

      const res = await axiosInstance.get('/reports/sales', { params });
      const bills = res.data.report?.data || [];

      // Group bills by day for the line chart
      const byDay = {};
      bills.forEach((b) => {
        const key = new Date(b.createdAt).toISOString().split('T')[0];
        byDay[key] = (byDay[key] || 0) + b.grandTotal;
      });

      const sorted = Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, revenue]) => ({ date, revenue: Math.round(revenue * 100) / 100, billCount: 1 }));

      setFilteredSales(sorted.length ? sorted : [{ date: 'No data', revenue: 0, billCount: 0 }]);
      setFiltersApplied(true);
    } catch (err) {
      console.error('Filter error:', err);
    } finally {
      setFilterLoading(false);
    }
  };

  const resetFilters = () => {
    setFilters({ startDate: '', endDate: '', category: '', supplier: '' });
    setFilteredSales(analytics?.salesTrend || []);
    setFiltersApplied(false);
  };

  // ── Loading / Error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading dashboard analytics…</p>
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
          <button
            onClick={() => fetchAnalytics()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { kpis, stockDistribution, forecastComparison, lowStockMeds, nearExpiryMeds, categories } = analytics;

  return (
    <div className="space-y-8">
        {/* ── Page Header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard & Analytics</h1>
            <p className="text-sm text-gray-500 mt-1">
              Welcome back,{' '}
              <span className="font-semibold text-blue-600">{currentUser?.username}</span>
              {' '}·{' '}
              <span className="capitalize bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                {currentUser?.role}
              </span>
            </p>
          </div>
          <button
            onClick={() => fetchAnalytics(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm font-medium shadow-sm"
          >
            <FaSyncAlt className={refreshing ? 'animate-spin text-blue-500' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* ── Section 1: KPI Metric Cards ──────────────────────────────── */}
        <section>
          <SectionHeader title="Metric Overview" icon={<FaChartLine />} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <KpiCard
              icon={<FaBoxes className="text-blue-600" />}
              bgClass="bg-blue-50"
              colorClass="border-blue-500"
              label="Total Medicines"
              value={kpis.totalMedicines}
              sub="items in stock"
            />
            <KpiCard
              icon={<FaExclamationTriangle className="text-red-500" />}
              bgClass="bg-red-50"
              colorClass="border-red-500"
              label="Low Stock"
              value={kpis.lowStockCount}
              sub="at or below reorder level"
            />
            <KpiCard
              icon={<FaClock className="text-yellow-500" />}
              bgClass="bg-yellow-50"
              colorClass="border-yellow-400"
              label="Near Expiry"
              value={kpis.nearExpiryCount}
              sub="expiring within 7 days"
            />
            <Link to="/alerts" className="block rounded-xl hover:ring-2 hover:ring-orange-300 transition" title="Open the Alerts page">
              <KpiCard
                icon={<FaBell className="text-orange-500" />}
                bgClass="bg-orange-50"
                colorClass="border-orange-400"
                label="Critical Alerts"
                value={kpis.activeCriticalAlerts}
                sub="unresolved · view alerts →"
              />
            </Link>
            {/* Revenue card — owner only */}
            {isOwner && (
              <>
                <KpiCard
                  icon={<FaRupeeSign className="text-green-600" />}
                  bgClass="bg-green-50"
                  colorClass="border-green-500"
                  label="Today's Revenue"
                  value={`₹${fmt(kpis.todayRevenue)}`}
                  sub={`${kpis.todayBillCount} bill(s) today`}
                />
                <KpiCard
                  icon={<FaFileInvoice className="text-purple-600" />}
                  bgClass="bg-purple-50"
                  colorClass="border-purple-500"
                  label="Today's Bills"
                  value={kpis.todayBillCount}
                  sub="invoices raised today"
                />
              </>
            )}
          </div>
        </section>

        {/* ── Section 2: Performance Charts (owner only) ───────────────── */}
        {isOwner ? (
          <section>
            <SectionHeader title="Performance Analytics" icon={<FaChartLine />} />

            {/* Filter & Report Form */}
            <div className="bg-white rounded-xl shadow-md p-5 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <FaFilter className="text-blue-500" />
                <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">
                  Filter & Custom Report
                </h3>
                {filtersApplied && (
                  <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                    Filtered
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Medicine Category</label>
                  <select
                    value={filters.category}
                    onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">All Categories</option>
                    {(categories || []).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Supplier</label>
                  <select
                    value={filters.supplier}
                    onChange={(e) => setFilters((f) => ({ ...f, supplier: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">All Suppliers</option>
                    {suppliers.map((s) => (
                      <option key={s._id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={applyFilters}
                  disabled={filterLoading}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition disabled:opacity-60 flex items-center gap-2"
                >
                  {filterLoading ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <FaFilter />
                  )}
                  Apply Filters
                </button>
                {filtersApplied && (
                  <button
                    onClick={resetFilters}
                    className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 transition"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Line Chart — Sales Trend */}
              <ChartCard title="Sales Trend — Revenue (Last 30 Days)">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={filteredSales} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDate}
                      tick={{ fontSize: 10 }}
                      interval={4}
                    />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue (₹)"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                {filtersApplied && (
                  <p className="text-xs text-blue-600 mt-2 text-center">
                    Showing filtered results · <button onClick={resetFilters} className="underline">Clear</button>
                  </p>
                )}
              </ChartCard>

              {/* Pie Chart — Stock Distribution */}
              <ChartCard title="Stock Distribution — Movement Classification">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={stockDistribution}
                      cx="50%"
                      cy="50%"
                      outerRadius={95}
                      dataKey="value"
                      label={({ name, percent }) =>
                        percent > 0 ? `${name} ${(percent * 100).toFixed(0)}%` : ''
                      }
                      labelLine={false}
                    >
                      {stockDistribution.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Bar Chart — Forecast vs Actual */}
            <ChartCard title="Forecast vs Actual Sales — Last 7 Days">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={forecastComparison} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="predicted" name="Predicted Units" fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="actual" name="Actual Units" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-gray-400 mt-2 text-center">
                Predicted values are based on recent sales average. Actual values reflect recorded inventory outflows.
              </p>
            </ChartCard>
          </section>
        ) : (
          // Staff role — show banner instead of hidden charts
          <section>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-center gap-4">
              <FaChartLine className="text-3xl text-blue-400 shrink-0" />
              <div>
                <p className="font-semibold text-blue-800">Performance graphs are restricted to Owner accounts.</p>
                <p className="text-sm text-blue-600 mt-0.5">
                  You can view stock levels, expiry alerts, and quick actions below.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ── Section 3: Live Alerts Panel (all roles) ─────────────────── */}
        <section>
          <div className="flex items-center justify-between">
            <SectionHeader title="Live Alerts" icon={<FaBell />} />
            <Link to="/alerts" className="mb-4 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline">
              View all alerts →
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Low Stock */}
            <div className="bg-white rounded-xl shadow-md p-5">
              <h3 className="text-sm font-bold text-red-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <FaExclamationTriangle /> Low Stock Items ({lowStockMeds.length})
              </h3>
              {lowStockMeds.length === 0 ? (
                <p className="text-gray-400 text-sm">✅ All medicines are adequately stocked.</p>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {lowStockMeds.map((m) => (
                    <div
                      key={m._id}
                      className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2"
                    >
                      <span className="text-sm font-medium text-gray-800">{m.name}</span>
                      <span className="text-xs text-red-600 font-semibold bg-red-100 px-2 py-0.5 rounded-full">
                        {m.quantity} / {m.reorderLevel} units
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Near Expiry */}
            <div className="bg-white rounded-xl shadow-md p-5">
              <h3 className="text-sm font-bold text-yellow-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <FaClock /> Near Expiry (7 days) ({nearExpiryMeds.length})
              </h3>
              {nearExpiryMeds.length === 0 ? (
                <p className="text-gray-400 text-sm">✅ No medicines expiring within 7 days.</p>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {nearExpiryMeds.map((m) => (
                    <div
                      key={m._id}
                      className="flex items-center justify-between bg-yellow-50 rounded-lg px-3 py-2"
                    >
                      <span className="text-sm font-medium text-gray-800">{m.name}</span>
                      <span className="text-xs text-yellow-700 font-semibold bg-yellow-100 px-2 py-0.5 rounded-full">
                        Exp: {new Date(m.expiryDate).toLocaleDateString('en-IN')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

      </div>
  );
}
