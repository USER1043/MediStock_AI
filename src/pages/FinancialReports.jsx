/**
 * @file Financial reports page comparing backend purchase costs vs sales revenue.
 * @module pages/FinancialReports
 */
import { useState, useEffect, useCallback } from 'react';
import { FaChartBar, FaDownload, FaSyncAlt, FaExclamationTriangle } from 'react-icons/fa';
import axiosInstance from '../utils/axiosConfig';
import { supplierIdOf } from '../utils/suppliers';

// Renders financial reporting dashboard connected to backend sales and purchase APIs.
const FinancialReports = () => {
  const [period, setPeriod] = useState('monthly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [financialData, setFinancialData] = useState({
    purchases: [],
    sales: [],
    totalPurchases: 0,
    totalSales: 0,
  });

  // Fetches sales and purchase financial report metrics from backend API endpoints.
  const fetchFinancialData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = { period };
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const [salesRes, purchaseRes, suppliersRes] = await Promise.all([
        axiosInstance.get('/reports/sales', { params }),
        axiosInstance.get('/reports/purchase', { params }),
        // Only used to count suppliers correctly; the report still loads without it
        axiosInstance.get('/suppliers').catch(() => ({ data: [] })),
      ]);
      const suppliers = Array.isArray(suppliersRes.data) ? suppliersRes.data : (suppliersRes.data?.suppliers || []);

      const salesReport = salesRes.data?.report || {};
      const purchaseReport = purchaseRes.data?.report || {};

      const bills = salesReport.data || [];
      const medicines = purchaseReport.medicines || [];

      // Group sales by period key
      const salesGrouped = {};
      bills.forEach(bill => {
        const key = new Date(bill.createdAt || Date.now()).toLocaleDateString('en-IN', {
          month: 'short',
          year: 'numeric',
          ...(period === 'daily' ? { day: '2-digit' } : {}),
        });
        if (!salesGrouped[key]) {
          salesGrouped[key] = { amount: 0, bills: 0, customers: new Set() };
        }
        salesGrouped[key].amount += bill.grandTotal || 0;
        salesGrouped[key].bills += 1;
        if (bill.customerName) salesGrouped[key].customers.add(bill.customerName);
      });

      // Group purchases by period key
      const purchaseGrouped = {};
      medicines.forEach(med => {
        const key = new Date(med.createdAt || Date.now()).toLocaleDateString('en-IN', {
          month: 'short',
          year: 'numeric',
          ...(period === 'daily' ? { day: '2-digit' } : {}),
        });
        if (!purchaseGrouped[key]) {
          purchaseGrouped[key] = { amount: 0, items: 0, suppliers: new Set() };
        }
        purchaseGrouped[key].amount += (med.purchasePrice || 0) * (med.quantity || 0);
        purchaseGrouped[key].items += 1;
        // Count by supplier id, so a supplier stored by id on one medicine and by name on another counts once
        if (med.supplier) purchaseGrouped[key].suppliers.add(supplierIdOf(med.supplier, suppliers) || med.supplier);
      });

      const allKeys = Array.from(new Set([...Object.keys(salesGrouped), ...Object.keys(purchaseGrouped)]));

      const salesList = allKeys.map(k => ({
        label: k,
        amount: salesGrouped[k]?.amount || 0,
        bills: salesGrouped[k]?.bills || 0,
        customers: salesGrouped[k]?.customers?.size || 0,
      }));

      const purchaseList = allKeys.map(k => ({
        label: k,
        amount: purchaseGrouped[k]?.amount || 0,
        items: purchaseGrouped[k]?.items || 0,
        suppliers: purchaseGrouped[k]?.suppliers?.size || 0,
      }));

      setFinancialData({
        purchases: purchaseList,
        sales: salesList,
        totalPurchases: purchaseReport.totalPurchaseValue || 0,
        totalSales: salesReport.totalSales || 0,
      });
    } catch (err) {
      console.error('Failed to load financial reports:', err);
      setError(err.response?.data?.message || 'Failed to load financial data from backend.');
    } finally {
      setLoading(false);
    }
  }, [period, startDate, endDate]);

  useEffect(() => {
    fetchFinancialData();
  }, [fetchFinancialData]);

  // Handles exporting current financial report view.
  const handleExportPDF = () => {
    window.print();
  };

  const totalPurchases = financialData.totalPurchases;
  const totalSales = financialData.totalSales;
  const netProfit = totalSales - totalPurchases;
  const profitMargin = totalSales > 0 ? ((netProfit / totalSales) * 100).toFixed(2) : '0.00';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading backend financial report metrics…</p>
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
            onClick={fetchFinancialData}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Financial Reports</h1>
          <p className="text-gray-600 mt-1">Compare purchase income vs sales income (Live Backend Data)</p>
        </div>
        <button
          onClick={fetchFinancialData}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium shadow-sm transition"
        >
          <FaSyncAlt />
          Refresh
        </button>
      </div>

      {/* Period Selection & Date Filters */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Report Period</label>
            <div className="flex gap-2">
              <button
                onClick={() => setPeriod('daily')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  period === 'daily'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Daily
              </button>
              <button
                onClick={() => setPeriod('weekly')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  period === 'weekly'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Weekly
              </button>
              <button
                onClick={() => setPeriod('monthly')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  period === 'monthly'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Monthly
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <button
            onClick={handleExportPDF}
            className="bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700 flex items-center gap-2"
          >
            <FaDownload />
            Export / Print Report
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Purchases</p>
              <p className="text-2xl font-bold text-red-600">₹{totalPurchases.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-red-100 p-3 rounded-lg">
              <FaChartBar className="text-red-600 text-2xl" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Sales</p>
              <p className="text-2xl font-bold text-green-600">₹{totalSales.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-green-100 p-3 rounded-lg">
              <FaChartBar className="text-green-600 text-2xl" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Net Profit</p>
              <p className="text-2xl font-bold text-primary-600">₹{netProfit.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-primary-100 p-3 rounded-lg">
              <FaChartBar className="text-primary-600 text-2xl" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Profit Margin</p>
              <p className="text-2xl font-bold text-purple-600">{profitMargin}%</p>
            </div>
            <div className="bg-purple-100 p-3 rounded-lg">
              <FaChartBar className="text-purple-600 text-2xl" />
            </div>
          </div>
        </div>
      </div>

      {/* Side-by-Side Comparison Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">Purchase vs Sales Comparison</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Period
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-red-600 uppercase tracking-wider bg-red-50">
                  Purchase Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-red-600 uppercase tracking-wider bg-red-50">
                  Items / Suppliers
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-green-600 uppercase tracking-wider bg-green-50">
                  Sales Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-green-600 uppercase tracking-wider bg-green-50">
                  Bills / Customers
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-primary-600 uppercase tracking-wider bg-primary-50">
                  Net Profit
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-primary-600 uppercase tracking-wider bg-primary-50">
                  Margin %
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {financialData.purchases.length === 0 && financialData.sales.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    No financial transaction records found for the selected period.
                  </td>
                </tr>
              ) : (
                financialData.purchases.map((purchase, index) => {
                  const sale = financialData.sales[index] || { amount: 0, bills: 0, customers: 0 };
                  const profit = sale.amount - purchase.amount;
                  const margin = sale.amount > 0 ? ((profit / sale.amount) * 100).toFixed(2) : '0.00';
                  const periodLabel = purchase.label || sale.label || `Record #${index + 1}`;

                  return (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {periodLabel}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 bg-red-50 font-semibold">
                        ₹{purchase.amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 bg-red-50">
                        {purchase.items} items / {purchase.suppliers} suppliers
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 bg-green-50 font-semibold">
                        ₹{sale.amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 bg-green-50">
                        {sale.bills} bills / {sale.customers} customers
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-primary-600 bg-primary-50 font-bold">
                        ₹{profit.toLocaleString('en-IN')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-primary-600 bg-primary-50 font-bold">
                        {margin}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot className="bg-gray-100">
              <tr className="font-bold">
                <td className="px-6 py-4 text-sm text-gray-900">TOTAL</td>
                <td className="px-6 py-4 text-sm text-red-600 bg-red-100">
                  ₹{totalPurchases.toLocaleString('en-IN')}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600 bg-red-100">-</td>
                <td className="px-6 py-4 text-sm text-green-600 bg-green-100">
                  ₹{totalSales.toLocaleString('en-IN')}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600 bg-green-100">-</td>
                <td className="px-6 py-4 text-sm text-primary-600 bg-primary-100">
                  ₹{netProfit.toLocaleString('en-IN')}
                </td>
                <td className="px-6 py-4 text-sm text-primary-600 bg-primary-100">
                  {profitMargin}%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Notes */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> Live financial metrics are generated directly from backend sales (`/api/reports/sales`) and inventory valuation (`/api/reports/purchase`) records. Owner-only access ensures sensitive financial data remains confidential.
        </p>
      </div>
    </div>
  );
};

export default FinancialReports;
