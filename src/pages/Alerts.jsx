/**
 * @file Alerts page: stock and expiry alerts with filters, resolve and history.
 * @module pages/Alerts
 *
 * Alerts are generated on the server when they are read (at most every 15 minutes, or right
 * after a stock change). "Refresh" forces a run. Expiry alerts are per batch. Resolving an alert
 * acknowledges it: it won't come back until the situation changes (e.g. that batch expires, or
 * sells out and is restocked while still expiring).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { alertAPI, notifyAlertsChanged } from '../utils/api';
import {
  FaBell,
  FaSyncAlt,
  FaExclamationTriangle,
  FaClock,
  FaBoxOpen,
  FaLayerGroup,
  FaCheckCircle,
  FaRobot,
  FaInfoCircle,
  FaFilter,
} from 'react-icons/fa';

const TYPE_META = {
  low_stock: { label: 'Low stock', icon: <FaBoxOpen /> },
  expired: { label: 'Expired', icon: <FaExclamationTriangle /> },
  near_expiry: { label: 'Near expiry', icon: <FaClock /> },
  overstock: { label: 'Overstock', icon: <FaLayerGroup /> },
};

const SEVERITY_META = {
  critical: { label: 'Critical', border: 'border-red-500', badge: 'bg-red-100 text-red-700', icon: 'bg-red-50 text-red-600' },
  warning: { label: 'Warning', border: 'border-yellow-400', badge: 'bg-yellow-100 text-yellow-700', icon: 'bg-yellow-50 text-yellow-600' },
  info: { label: 'Info', border: 'border-blue-400', badge: 'bg-blue-100 text-blue-700', icon: 'bg-blue-50 text-blue-600' },
};

// Same day count as the server: ceil((expiry - now) / 1 day); 0 or less means expired
const daysLeft = (iso) => Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));

const batchStatus = (alertType, expiryDate) => {
  const days = daysLeft(expiryDate);
  if (alertType === 'expired') {
    const ago = -days;
    return ago <= 0 ? 'Expired today, still in stock' : `Expired ${ago} day${ago === 1 ? '' : 's'} ago, still in stock`;
  }
  return days <= 1 ? 'Expires within a day' : `Expires in ${days} days`;
};

function BatchField({ label, value, mono }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">{label}</p>
      <p className={`text-sm font-semibold text-gray-800 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

function SummaryCard({ label, value, colorClass, icon }) {
  return (
    <div className={`bg-white rounded-xl shadow-md p-5 border-l-4 ${colorClass} flex items-center gap-4`}>
      <div className="text-2xl opacity-80">{icon}</div>
      <div>
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function ResolutionNote({ alert }) {
  if (!alert.isResolved) return null;
  if (alert.autoResolved) {
    return (
      <p className="text-xs text-green-700 flex items-center gap-1.5">
        <FaRobot /> Cleared automatically {fmtDateTime(alert.resolvedAt)}: the condition no longer holds
      </p>
    );
  }
  return (
    <p className="text-xs text-green-700 flex items-center gap-1.5 flex-wrap">
      <FaCheckCircle /> Resolved by <span className="font-semibold">{alert.resolvedByName || 'unknown user'}</span>
      {alert.resolvedAt && <> on {fmtDateTime(alert.resolvedAt)}</>}
      {alert.clearedAt && <span className="text-gray-500">· condition cleared {fmtDateTime(alert.clearedAt)}</span>}
    </p>
  );
}

function AlertCard({ alert, onResolve, resolving }) {
  const type = TYPE_META[alert.alertType] || { label: alert.alertType, icon: <FaBell /> };
  const sev = SEVERITY_META[alert.severity] || SEVERITY_META.info;
  const medicineName = alert.medicineId?.name || alert.medicineName || 'Deleted medicine';
  const changed = alert.lastChangedAt && new Date(alert.lastChangedAt) - new Date(alert.createdAt) > 1000;

  return (
    <div
      className={`bg-white rounded-xl shadow-md p-5 border-l-4 ${sev.border} ${alert.isResolved ? 'opacity-70' : ''}`}
      data-testid="alert-card"
    >
      <div className="flex items-start gap-4">
        <div className={`p-3 rounded-full text-lg shrink-0 ${sev.icon}`}>{type.icon}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-gray-900">{medicineName}</h3>
            {alert.batch && (
              <span className="px-2 py-0.5 rounded-full text-xs font-mono font-semibold bg-gray-800 text-white">
                {alert.batch.batchNumber}
              </span>
            )}
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">{type.label}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${sev.badge}`}>{sev.label}</span>
            {alert.isResolved && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Resolved</span>
            )}
          </div>

          {alert.batch ? (
            <div className="mt-3">
              {/* Closed alerts keep the batch as it was last seen; a relative "expires in" would mislead */}
              {alert.isCurrent !== false && (
                <p className={`text-sm font-medium ${alert.alertType === 'expired' ? 'text-red-700' : 'text-yellow-700'}`}>
                  {batchStatus(alert.alertType, alert.batch.expiryDate)}
                </p>
              )}
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 rounded-lg px-4 py-3 max-w-xl">
                <BatchField label="Batch" value={alert.batch.batchNumber} mono />
                <BatchField label="Expiry" value={fmtDate(alert.batch.expiryDate)} />
                <BatchField label="Rack" value={alert.batch.rackNumber} />
                <BatchField label="Qty" value={alert.batch.quantity} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-700 mt-2">{alert.message}</p>
          )}

          <div className="mt-3 space-y-1">
            <p className="text-xs text-gray-500" title={fmtDateTime(alert.createdAt)}>
              Raised {timeAgo(alert.createdAt)} ({fmtDateTime(alert.createdAt)})
              {changed && <> · updated {timeAgo(alert.lastChangedAt)}</>}
            </p>
            <ResolutionNote alert={alert} />
          </div>
        </div>

        {!alert.isResolved && (
          <button
            onClick={() => onResolve(alert)}
            disabled={resolving}
            className="shrink-0 flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium shadow-sm disabled:opacity-60"
          >
            <FaCheckCircle />
            {resolving ? 'Resolving…' : 'Resolve'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);

  const [typeFilter, setTypeFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const { data } = await alertAPI.getAllAlerts(showResolved ? {} : { resolved: false });
      setAlerts(data.alerts || []);
      setMeta({ lastGeneratedAt: data.lastGeneratedAt, refreshIntervalMinutes: data.refreshIntervalMinutes });
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load alerts.');
    } finally {
      setLoading(false);
    }
  }, [showResolved]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const { data } = await alertAPI.generateAlerts();
      const parts = [`${data.created} new`];
      if (data.updated) parts.push(`${data.updated} updated`);
      if (data.autoResolved) parts.push(`${data.autoResolved} cleared`);
      setNotice(`Checked inventory: ${parts.join(', ')}.`);
      await fetchAlerts();
      notifyAlertsChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not refresh alerts.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleResolve = async (alert) => {
    setResolvingId(alert._id);
    setNotice(null);
    try {
      await alertAPI.resolveAlert(alert._id);
      setNotice(`Resolved: ${alert.medicineId?.name || alert.medicineName}. It will come back only if the situation changes.`);
    } catch (err) {
      // 409: someone (or the system) resolved it first; reloading shows the current state
      if (err.response?.status !== 409) {
        setError(err.response?.data?.message || 'Could not resolve the alert.');
      }
    } finally {
      setResolvingId(null);
      await fetchAlerts();
      notifyAlertsChanged();
    }
  };

  const open = useMemo(() => alerts.filter((a) => !a.isResolved), [alerts]);
  const counts = useMemo(
    () => ({
      critical: open.filter((a) => a.severity === 'critical').length,
      warning: open.filter((a) => a.severity === 'warning').length,
      info: open.filter((a) => a.severity === 'info').length,
    }),
    [open]
  );

  const visible = alerts.filter(
    (a) => (!typeFilter || a.alertType === typeFilter) && (!severityFilter || a.severity === severityFilter)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading alerts…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <FaBell className="text-orange-500" /> Alerts
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Checked automatically every {meta.refreshIntervalMinutes || 15} minutes and after stock changes
            {meta.lastGeneratedAt && <> · last checked {timeAgo(meta.lastGeneratedAt)}</>}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm font-medium shadow-sm"
        >
          <FaSyncAlt className={refreshing ? 'animate-spin text-blue-500' : ''} />
          {refreshing ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
          <FaExclamationTriangle /> {error}
        </div>
      )}
      {notice && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
          <FaInfoCircle /> {notice}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard label="Critical" value={counts.critical} colorClass="border-red-500" icon={<FaExclamationTriangle className="text-red-500" />} />
        <SummaryCard label="Warning" value={counts.warning} colorClass="border-yellow-400" icon={<FaClock className="text-yellow-500" />} />
        <SummaryCard label="Info" value={counts.info} colorClass="border-blue-400" icon={<FaInfoCircle className="text-blue-500" />} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-md p-4 flex items-center gap-4 flex-wrap">
        <span className="text-sm font-semibold text-gray-600 flex items-center gap-2">
          <FaFilter className="text-blue-600" /> Filters
        </span>
        <select
          aria-label="Type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All types</option>
          {Object.entries(TYPE_META).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          aria-label="Severity"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All severities</option>
          {Object.entries(SEVERITY_META).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Show resolved
        </label>
        <span className="text-xs text-gray-400 ml-auto">
          Showing {visible.length} of {alerts.length}
        </span>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-10 text-center">
          <FaCheckCircle className="text-4xl text-green-500 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">
            {alerts.length === 0 && !showResolved ? 'No open alerts. Stock and expiry look fine.' : 'No alerts match these filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((alert) => (
            <AlertCard
              key={alert._id}
              alert={alert}
              onResolve={handleResolve}
              resolving={resolvingId === alert._id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
