/**
 * @file Reorder review page component for automated reorder suggestions and purchase order creation.
 * @module pages/reorder/ReorderReview
 */
import { useState, useEffect } from 'react';
import axiosInstance from '../../utils/axiosConfig';
import { FaStar, FaShoppingCart } from 'react-icons/fa';

const ReorderReview = () => {
  const [suggestions, setSuggestions] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('suggestions');
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderForm, setOrderForm] = useState({
    supplier_id: '',
    unit_price: '',
    expected_delivery_date: '',
    notes: '',
  });

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'suggestions') {
        const [suggRes, suppRes] = await Promise.all([
          axiosInstance.get('/suppliers/reorder/suggestions'),
          axiosInstance.get('/suppliers')
        ]);
        setSuggestions(suggRes.data.suggestions || []);
        setAllSuppliers(suppRes.data.suppliers || []);
      } else {
        const res = await axiosInstance.get('/suppliers/purchase-orders');
        setPurchaseOrders(res.data.orders || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrder = (suggestion) => {
    setSelectedSuggestion(suggestion);
    setOrderForm({
      supplier_id: suggestion.suggested_suppliers[0]?.supplier_id?._id || suggestion.suggested_suppliers[0]?.supplier_id || '',
      unit_price: '',
      expected_delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      notes: '',
    });
    setShowOrderModal(true);
  };

  const submitPurchaseOrder = async (e) => {
    e.preventDefault();
    try {
      await axiosInstance.post('/suppliers/purchase-orders', {
        suggestion_id: selectedSuggestion._id,
        supplier_id: orderForm.supplier_id,
        unit_price: parseFloat(orderForm.unit_price),
        expected_delivery_date: orderForm.expected_delivery_date,
        notes: orderForm.notes,
      });
      alert('Purchase order created successfully');
      setShowOrderModal(false);
      fetchData();
    } catch (error) {
      console.error('Error creating purchase order:', error);
      alert(error.response?.data?.message || 'Error creating purchase order');
    }
  };

  const updateOrderStatus = async (orderId, status) => {
    try {
      await axiosInstance.put(`/suppliers/purchase-orders/${orderId}`, {
        order_status: status,
        ...(status === 'Received' && { actual_delivery_date: new Date().toISOString() }),
      });
      alert(`Order status updated to ${status}`);
      fetchData();
    } catch (error) {
      console.error('Error updating order:', error);
      alert(error.response?.data?.message || 'Error updating order');
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'Critical':
        return 'bg-red-100 text-red-800';
      case 'High':
        return 'bg-orange-100 text-orange-800';
      case 'Medium':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-green-100 text-green-800';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Received':
        return 'bg-green-100 text-green-800';
      case 'Shipped':
        return 'bg-blue-100 text-blue-800';
      case 'Ordered':
        return 'bg-purple-100 text-purple-800';
      case 'Approved':
        return 'bg-teal-100 text-teal-800';
      case 'Cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-800">Reorder Management</h1>
          <p className="text-gray-600 mt-2">Draft orders from the demand forecast, and purchase orders</p>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('suggestions')}
              className={`pb-2 px-4 ${activeTab === 'suggestions'
                ? 'border-b-2 border-primary-600 text-primary-600 font-semibold'
                : 'text-gray-600'
                }`}
            >
              Reorder Suggestions ({suggestions.length})
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={`pb-2 px-4 ${activeTab === 'orders'
                ? 'border-b-2 border-primary-600 text-primary-600 font-semibold'
                : 'text-gray-600'
                }`}
            >
              Purchase Orders ({purchaseOrders.length})
            </button>
          </div>
        </div>

        {/* Suggestions Tab */}
        {activeTab === 'suggestions' && (
          <div className="space-y-4">
            {suggestions.map((suggestion) => (
              <div key={suggestion._id} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-semibold">{suggestion.medicine_name}</h3>
                    <div className="flex gap-2 mt-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getPriorityColor(suggestion.priority)}`}>
                        {suggestion.priority}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(suggestion.status)}`}>
                        {suggestion.status}
                      </span>
                    </div>
                  </div>
                  {suggestion.status === 'Pending' && (
                    <button
                      onClick={() => handleCreateOrder(suggestion)}
                      className="bg-primary-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-primary-700"
                    >
                      <FaShoppingCart /> Create Order
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-600">Current Stock</p>
                    <p className="text-lg font-semibold">{suggestion.current_stock ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Reorder Level</p>
                    <p className="text-lg font-semibold">{suggestion.reorder_level ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Suggested Quantity</p>
                    <p className="text-lg font-semibold text-primary-600">{suggestion.suggested_quantity}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">AI Forecast</p>
                    <p className="text-lg font-semibold text-blue-600">{suggestion.ai_demand_forecast}</p>
                  </div>
                </div>

                {suggestion.suggested_suppliers.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Suggested Suppliers:</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {suggestion.suggested_suppliers.map((supplier, index) => (
                        <div key={index} className="border rounded-lg p-3">
                          <div className="flex justify-between items-start">
                            <p className="font-medium">{supplier.supplier_name || supplier.supplier_id?.supplier_name || 'Unknown Supplier'}</p>
                            <div className="flex items-center gap-1">
                              <FaStar className="text-yellow-500 text-sm" />
                              <span className="text-sm font-semibold">{supplier.delivery_score ? supplier.delivery_score.toFixed(1) : 'N/A'}</span>
                            </div>
                          </div>
                          <p className="text-sm text-gray-600 mt-1">Est. ₹{supplier.estimated_price}/unit</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {suggestions.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                No reorder suggestions. The owner creates them by running the forecast on the Forecast Setup page.
              </div>
            )}
          </div>
        )}

        {/* Purchase Orders Tab */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            {purchaseOrders.map((order) => (
              <div key={order._id} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-semibold">Order #{order.order_number}</h3>
                    <p className="text-gray-600">{order.medicine_id?.name}</p>
                    <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(order.order_status)}`}>
                      {order.order_status}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-primary-600">₹{order.total_amount.toFixed(2)}</p>
                    <p className="text-sm text-gray-600">{order.requested_quantity} units × ₹{order.unit_price}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-600">Supplier</p>
                    <p className="font-semibold">{order.supplier_id?.supplier_name}</p>
                    <p className="text-sm text-gray-600">{order.supplier_id?.contact_info.phone}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Expected Delivery</p>
                    <p className="font-semibold">{new Date(order.expected_delivery_date).toLocaleDateString()}</p>
                  </div>
                  {order.actual_delivery_date && (
                    <div>
                      <p className="text-sm text-gray-600">Actual Delivery</p>
                      <p className="font-semibold">{new Date(order.actual_delivery_date).toLocaleDateString()}</p>
                    </div>
                  )}
                </div>

                {order.notes && (
                  <div className="mb-4 text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border-l-4 border-gray-300 italic">
                    <span className="font-semibold not-italic text-gray-800">Notes: </span> {order.notes}
                  </div>
                )}

                {order.order_status === 'Pending' && (
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => updateOrderStatus(order._id, 'Ordered')}
                      className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
                    >
                      Mark as Ordered
                    </button>
                    <button
                      onClick={() => updateOrderStatus(order._id, 'Cancelled')}
                      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Cancel Order
                    </button>
                  </div>
                )}

                {order.order_status === 'Ordered' && (
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => updateOrderStatus(order._id, 'Shipped')}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Mark as Shipped
                    </button>
                  </div>
                )}

                {order.order_status === 'Shipped' && (
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => updateOrderStatus(order._id, 'Received')}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Mark as Received
                    </button>
                  </div>
                )}
              </div>
            ))}

            {purchaseOrders.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                No purchase orders yet. Create orders from reorder suggestions.
              </div>
            )}
          </div>
        )}

        {/* Create Order Modal */}
        {showOrderModal && selectedSuggestion && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full">
              <h2 className="text-2xl font-bold mb-4">Create Purchase Order</h2>
              <form onSubmit={submitPurchaseOrder}>
                <div className="mb-4">
                  <p className="text-sm text-gray-600">Medicine</p>
                  <p className="font-semibold">{selectedSuggestion.medicine_name}</p>
                </div>

                <div className="mb-4">
                  <p className="text-sm text-gray-600">Quantity</p>
                  <p className="font-semibold">{selectedSuggestion.suggested_quantity} units</p>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Select Supplier *</label>
                  <select
                    value={orderForm.supplier_id}
                    onChange={(e) => setOrderForm({ ...orderForm, supplier_id: e.target.value })}
                    required
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select a supplier...</option>

                    {selectedSuggestion.suggested_suppliers.length > 0 && (
                      <optgroup label="Suggested Suppliers (Category Match)">
                        {selectedSuggestion.suggested_suppliers.map((supplier) => {
                          const supId = supplier.supplier_id?._id || supplier.supplier_id;
                          const supName = supplier.supplier_name || supplier.supplier_id?.supplier_name || 'Unknown Supplier';
                          const score = supplier.delivery_score ? supplier.delivery_score.toFixed(1) : 'N/A';
                          return (
                            <option key={`sugg-${supId}`} value={supId}>
                              ⭐ {supName} (Score: {score})
                            </option>
                          );
                        })}
                      </optgroup>
                    )}

                    <optgroup label="All Other Suppliers">
                      {allSuppliers
                        .filter(s => !selectedSuggestion.suggested_suppliers.some(ss =>
                          (ss.supplier_id?._id || ss.supplier_id) === s._id
                        ))
                        .map((supplier) => (
                          <option key={`all-${supplier._id}`} value={supplier._id}>
                            {supplier.supplier_name}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Unit Price (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={orderForm.unit_price}
                    onChange={(e) => setOrderForm({ ...orderForm, unit_price: e.target.value })}
                    required
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Expected Delivery Date *</label>
                  <input
                    type="date"
                    value={orderForm.expected_delivery_date}
                    onChange={(e) => setOrderForm({ ...orderForm, expected_delivery_date: e.target.value })}
                    required
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Notes</label>
                  <textarea
                    value={orderForm.notes}
                    onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })}
                    rows="3"
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div className="flex gap-4">
                  <button
                    type="submit"
                    className="flex-1 bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700"
                  >
                    Create Order
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowOrderModal(false)}
                    className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
  );
};

export default ReorderReview;
