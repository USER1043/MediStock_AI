/**
 * @file Frontend API clients and interceptors for HTTP requests.
 * @module utils/api
 */

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('medistock_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ============ AUTH APIs ============
export const authAPI = {
  register: (data) => apiClient.post('/auth/register', data),
  login: (data) => apiClient.post('/auth/login', data),
  getCurrentUser: () => apiClient.get('/auth/me'),
};

// ============ INVENTORY APIs ============
export const inventoryAPI = {
  getAllMedicines: () => apiClient.get('/inventory'),
  getMedicine: (id) => apiClient.get(`/inventory/${id}`),
  createMedicine: (data) => apiClient.post('/inventory', data),
  updateMedicine: (id, data) => apiClient.put(`/inventory/${id}`, data),
  deleteMedicine: (id) => apiClient.delete(`/inventory/${id}`),
  searchMedicines: (query) => apiClient.get('/inventory/search', { params: { query } }),
  getLowStockMedicines: () => apiClient.get('/inventory/low-stock'),
  getNearExpiryMedicines: () => apiClient.get('/inventory/near-expiry'),
  getExpiredMedicines: () => apiClient.get('/inventory/expired'),
  adjustQuantity: (id, data) => apiClient.post(`/inventory/${id}/adjust-quantity`, data),
  getInventoryHistory: () => apiClient.get('/inventory/history'),
};

// ============ BILLING APIs ============
export const billingAPI = {
  getAllBills: () => apiClient.get('/billing'),
  getBill: (id) => apiClient.get(`/billing/${id}`),
  getBillsByCustomer: (customerId) => apiClient.get(`/billing/customer/${customerId}`),
  getBillsByDateRange: (startDate, endDate) =>
    apiClient.get('/billing/date-range', { params: { startDate, endDate } }),
  createBill: (data) => apiClient.post('/billing', data),
  confirmPayment: (data) => apiClient.post('/billing/payment/confirm', data),
  getSalesSummary: (period) => apiClient.get('/billing/summary', { params: { period } }),
};

// ============ CUSTOMER APIs ============
export const customerAPI = {
  getAllCustomers: (customerType) =>
    apiClient.get('/customers', { params: { customerType } }),
  getCustomer: (id) => apiClient.get(`/customers/${id}`),
  createCustomer: (data) => apiClient.post('/customers', data),
  updateCustomer: (id, data) => apiClient.put(`/customers/${id}`, data),
  deleteCustomer: (id) => apiClient.delete(`/customers/${id}`),
  searchCustomers: (query) => apiClient.get('/customers/search', { params: { query } }),
  getCustomerStats: () => apiClient.get('/customers/stats'),
};

// ============ ALERT APIs ============
export const alertAPI = {
  // params: { resolved?: boolean, type?, severity? }
  getAllAlerts: (params = {}) => apiClient.get('/alerts', { params }),
  getCriticalAlerts: () => apiClient.get('/alerts/critical'),
  generateAlerts: () => apiClient.post('/alerts/generate'),
  resolveAlert: (id) => apiClient.put(`/alerts/${id}/resolve`),
  getMedicineRecommendations: () => apiClient.get('/alerts/recommendations'),
};

// Fired after alerts are resolved or regenerated, so the sidebar badge refreshes at once
export const ALERTS_CHANGED_EVENT = 'medistock:alerts-changed';
export const notifyAlertsChanged = () => window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT));

// ============ UPLOAD APIs ============
export const uploadAPI = {
  uploadExcel: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/uploads', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getUploadHistory: () => apiClient.get('/uploads'),
  getUploadLog: (id) => apiClient.get(`/uploads/${id}`),
};

// ============ REPORT APIs ============
export const reportAPI = {
  getDashboardSummary: () => apiClient.get('/reports/dashboard/summary'),
  getSalesReport: (period, startDate, endDate) =>
    apiClient.get('/reports/sales', { params: { period, startDate, endDate } }),
  getPurchaseReport: (period) => apiClient.get('/reports/purchase', { params: { period } }),
  getInventoryReport: () => apiClient.get('/reports/inventory'),
  getDemandForecast: (medicineId, days) =>
    apiClient.get('/reports/forecast', { params: { medicineId, days } }),
  getStockClassification: () => apiClient.get('/reports/classification'),
};

// ============ CATEGORY APIs ============
export const categoryAPI = {
  getAllCategories: () => apiClient.get('/categories'),
};

// ============ CHATBOT APIs ============
export const chatbotAPI = {
  query: (message, language) => apiClient.post('/chatbot/query', { message, language }),
};

export default apiClient;
