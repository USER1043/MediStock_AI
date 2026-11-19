/**
 * @file Inventory management page displaying live stock, FEFO sorting, and search filtering.
 * @module pages/Inventory
 */
import { useState, useEffect } from 'react';
import axiosInstance from '../utils/axiosConfig';
import { getExpiryStatus, getStockStatus, filterMedicines, sortByFEFO } from '../utils/helpers';
import { STOCK_LEVEL_META } from '../utils/stockLevel';
import { FaSearch, FaSort } from 'react-icons/fa';

// Renders inventory management view.
const Inventory = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('fefo');
  const [medicines, setMedicines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetches inventory data from backend API.
    const fetchMedicines = async () => {
      try {
        const res = await axiosInstance.get('/inventory');
        setMedicines(res.data.medicines || []);
      } catch (error) {
        console.error('Failed to fetch inventory:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchMedicines();
  }, []);

  let filteredMedicines = filterMedicines(medicines, searchQuery);

  if (sortBy === 'fefo') {
    filteredMedicines = sortByFEFO(filteredMedicines);
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Inventory Management</h1>

      {/* Search and Filter */}
      <div className="bg-white p-4 rounded-xl shadow-md mb-6 flex gap-4">
        <div className="flex-1 relative">
          <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, category, batch, or rack..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg"
        >
          <option value="fefo">Sort by FEFO</option>
          <option value="name">Sort by Name</option>
        </select>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Medicine</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Batch</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expiry</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rack</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan="7" className="px-6 py-8 text-center text-gray-500">
                  Loading inventory...
                </td>
              </tr>
            ) : filteredMedicines.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-6 py-8 text-center text-gray-500">
                  No medicines found
                </td>
              </tr>
            ) : filteredMedicines.map((medicine) => {
              const primaryBatch = medicine.batches && medicine.batches.length > 0 ? medicine.batches[0] : {};
              const expiryValue = primaryBatch.expiryDate || 'N/A';
              const expiryStatus = getExpiryStatus(expiryValue !== 'N/A' ? expiryValue : new Date());
              const stockStatus = getStockStatus(medicine.quantity, medicine.reorderLevel);

              return (
                <tr key={medicine._id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-gray-900">{medicine.name}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{medicine.category}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 font-mono">{primaryBatch.batchNumber || 'N/A'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${expiryStatus.color === 'red' ? 'bg-red-100 text-red-700' :
                      expiryStatus.color === 'yellow' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                      {expiryValue !== 'N/A' ? new Date(expiryValue).toLocaleDateString() : 'N/A'}{' '}
                      {expiryStatus.status === 'expired'
                        ? '(EXPIRED)'
                        : `(${expiryStatus.days || 0}d)`}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold">{medicine.quantity}</td>
                  <td className="px-6 py-4 text-sm font-mono font-semibold">{primaryBatch.rackNumber || 'N/A'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${STOCK_LEVEL_META[stockStatus.status].badge}`}>
                      {stockStatus.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Inventory;
