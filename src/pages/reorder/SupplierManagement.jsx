/**
 * @file Manages supplier profiles, procurement partners, and categories.
 * @module pages/reorder/SupplierManagement
 */

import { useState, useEffect } from 'react';
import axiosInstance from '../../utils/axiosConfig';
import { FaPlus, FaEdit, FaSearch, FaStar } from 'react-icons/fa';

const SupplierManagement = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categories, setCategories] = useState(['Tablet', 'Syrup', 'Injection', 'Capsule', 'Ointment', 'Drops', 'Other']);
  const [formData, setFormData] = useState({
    supplier_name: '',
    contact_info: {
      phone: '',
      email: '',
      address: '',
      city: '',
      state: '',
      pincode: '',
    },
    medicine_categories: [],
    notes: '',
  });

  useEffect(() => {
    fetchSuppliers();
    fetchCategories();
  }, []);

  // Fetches dynamic medicine categories from the backend database.
  const fetchCategories = async () => {
    try {
      const res = await axiosInstance.get('/categories');
      const categoryNames = (res.data.categories || []).map((c) => c.name);
      if (categoryNames.length > 0) {
        setCategories(categoryNames);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  // Fetches active suppliers from the backend database.
  const fetchSuppliers = async () => {
    try {
      const res = await axiosInstance.get('/suppliers/suppliers');
      setSuppliers(res.data.suppliers || []);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      setSuppliers([]); // Set empty array on error
      alert('Error loading suppliers: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingSupplier) {
        await axiosInstance.put(`/suppliers/suppliers/${editingSupplier._id}`, formData);
      } else {
        await axiosInstance.post('/suppliers/suppliers', formData);
      }
      resetForm();
      fetchSuppliers();
    } catch (error) {
      console.error('Error saving supplier:', error);
      alert(error.response?.data?.message || 'Error saving supplier');
    }
  };

  const handleEdit = (supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      supplier_name: supplier.supplier_name,
      contact_info: supplier.contact_info,
      medicine_categories: supplier.medicine_categories || [],
      notes: supplier.notes || '',
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      supplier_name: '',
      contact_info: {
        phone: '',
        email: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
      },
      medicine_categories: [],
      notes: '',
    });
    setEditingSupplier(null);
    setShowForm(false);
  };

  const handleCategoryChange = (category) => {
    setFormData((prev) => ({
      ...prev,
      medicine_categories: prev.medicine_categories.includes(category)
        ? prev.medicine_categories.filter((c) => c !== category)
        : [...prev.medicine_categories, category],
    }));
  };

  const filteredSuppliers = suppliers.filter((supplier) =>
    supplier?.supplier_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Supplier Management</h1>
            <p className="text-gray-600 mt-2">
              {suppliers.length > 0
                ? `Manage suppliers and procurement partners • ${suppliers.length} supplier${suppliers.length !== 1 ? 's' : ''} available`
                : 'Manage suppliers and procurement partners'}
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="bg-primary-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-primary-700"
          >
            <FaPlus /> Add Supplier
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <FaSearch className="absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search suppliers..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Supplier Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-4">
                {editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}
              </h2>
              <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium mb-2">Supplier Name *</label>
                    <input
                      type="text"
                      value={formData.supplier_name}
                      onChange={(e) => setFormData({ ...formData, supplier_name: e.target.value })}
                      required
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Phone *</label>
                    <input
                      type="tel"
                      value={formData.contact_info.phone}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contact_info: { ...formData.contact_info, phone: e.target.value },
                        })
                      }
                      required
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Email *</label>
                    <input
                      type="email"
                      value={formData.contact_info.email}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contact_info: { ...formData.contact_info, email: e.target.value },
                        })
                      }
                      required
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium mb-2">Address *</label>
                    <textarea
                      value={formData.contact_info.address}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contact_info: { ...formData.contact_info, address: e.target.value },
                        })
                      }
                      required
                      rows="2"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">City</label>
                    <input
                      type="text"
                      value={formData.contact_info.city}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contact_info: { ...formData.contact_info, city: e.target.value },
                        })
                      }
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Pincode</label>
                    <input
                      type="text"
                      value={formData.contact_info.pincode}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contact_info: { ...formData.contact_info, pincode: e.target.value },
                        })
                      }
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium mb-2">Medicine Categories</label>
                    <div className="flex flex-wrap gap-2">
                      {categories.map((category) => (
                        <label key={category} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={formData.medicine_categories.includes(category)}
                            onChange={() => handleCategoryChange(category)}
                            className="rounded"
                          />
                          <span className="text-sm">{category}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium mb-2">Notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows="3"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>

                <div className="flex gap-4 mt-6">
                  <button
                    type="submit"
                    className="flex-1 bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700"
                  >
                    {editingSupplier ? 'Update' : 'Create'} Supplier
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Suppliers List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSuppliers.map((supplier) => (
            <div key={supplier._id} className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-semibold">{supplier.supplier_name}</h3>
                <button
                  onClick={() => handleEdit(supplier)}
                  className="text-blue-600 hover:text-blue-800"
                >
                  <FaEdit />
                </button>
              </div>

              <div className="space-y-2 text-sm text-gray-600">
                <p>📞 {supplier.contact_info?.phone}</p>
                <p>✉️ {supplier.contact_info?.email}</p>
                <p>📍 {supplier.contact_info?.address}</p>

                <div className="flex items-center gap-2 mt-3">
                  <FaStar className="text-yellow-500" />
                  <span className="font-semibold">{supplier.delivery_performance_score?.toFixed(1) || '0.0'}/10</span>
                  <span className="text-xs text-gray-500">Performance Score</span>
                </div>

                <div className="flex flex-wrap gap-1 mt-3">
                  {supplier.medicine_categories?.map((cat) => (
                    <span key={cat} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                      {cat}
                    </span>
                  ))}
                </div>

                <div className="mt-3 pt-3 border-t text-xs">
                  <p>Total Orders: {supplier.total_orders}</p>
                  <p>Successful: {supplier.successful_deliveries}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredSuppliers.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No suppliers found. Add your first supplier to get started!
          </div>
        )}
      </div>
  );
};

export default SupplierManagement;
