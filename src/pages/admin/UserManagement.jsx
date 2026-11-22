/**
 * @file User management page component for managing user accounts and roles.
 * @module pages/admin/UserManagement
 */
import { useState, useEffect } from 'react';
import axiosInstance from '../../utils/axiosConfig';
import { FaPlus, FaEdit, FaTrash, FaShieldAlt, FaUserTie, FaKey, FaToggleOn, FaToggleOff, FaCheckCircle, FaRegCircle } from 'react-icons/fa';
import { PASSWORD_RULES, getPasswordPolicyFailures, describePasswordPolicyFailures } from '../../utils/passwordPolicy';

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    role: 'staff',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');

  // An empty password is "not set yet" when adding (the field is required) and
  // "keep the current one" when editing; anything typed must meet the policy.
  const passwordFailures = getPasswordPolicyFailures(formData.password);
  const passwordBlocked = formData.password !== '' && passwordFailures.length > 0;

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await axiosInstance.get('/auth/users');
      setUsers(res.data.users || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      if (error.response?.status === 403) {
        alert('Access denied. Only administrators can view users.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (passwordBlocked) {
      setFormError(describePasswordPolicyFailures(passwordFailures));
      return;
    }
    setFormError('');
    try {
      if (editingUser) {
        // Update user
        const updateData = {
          username: formData.username,
          email: formData.email,
          role: formData.role,
        };

        // Only include password if it's been changed
        if (formData.password) {
          updateData.password = formData.password;
        }

        await axiosInstance.put(`/auth/users/${editingUser.id}`, updateData);
        alert('User updated successfully');
      } else {
        // Create user
        await axiosInstance.post('/auth/register', formData);
        alert('User registered successfully');
      }
      resetForm();
      fetchUsers();
    } catch (error) {
      console.error('Error saving user:', error);
      // Shown in the form (which stays open), e.g. the server's password policy message
      setFormError(error.response?.data?.message || 'Error saving user');
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      email: user.email,
      password: '', // Don't pre-fill password
      role: user.role,
    });
    setFormError('');
    setShowForm(true);
  };

  const handleDelete = async (userId, username) => {
    if (!window.confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await axiosInstance.delete(`/auth/users/${userId}`);
      alert('User deleted successfully');
      fetchUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
      alert(error.response?.data?.message || 'Error deleting user');
    }
  };

  const toggleUserStatus = async (userId, currentStatus, username) => {
    try {
      await axiosInstance.put(`/auth/users/${userId}`, {
        isActive: !currentStatus,
      });
      alert(`User "${username}" ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      fetchUsers();
    } catch (error) {
      console.error('Error updating user status:', error);
      alert(error.response?.data?.message || 'Error updating user status');
    }
  };

  const resetForm = () => {
    setFormData({
      username: '',
      email: '',
      password: '',
      role: 'staff',
    });
    setEditingUser(null);
    setShowForm(false);
    setShowPassword(false);
    setFormError('');
  };

  const getRoleIcon = (role) => {
    return role === 'owner' ? <FaShieldAlt className="text-yellow-500" /> : <FaUserTie className="text-blue-500" />;
  };

  const getRoleBadgeColor = (role) => {
    return role === 'owner' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800';
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">User & Role Management</h1>
            <p className="text-gray-600 mt-2">
              Manage clinic personnel and access control • {users.length} user{users.length !== 1 ? 's' : ''} registered
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="bg-primary-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-primary-700"
          >
            <FaPlus /> Add User
          </button>
        </div>

        {/* User Registration/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-2xl font-bold mb-4">
                {editingUser ? 'Edit User' : 'Register New User'}
              </h2>
              <form onSubmit={handleSubmit}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Username *</label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      required
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="Enter username"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Email *</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="user@example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Password {editingUser ? '(leave blank to keep current)' : '*'}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={formData.password}
                        onChange={(e) => {
                          setFormData({ ...formData, password: e.target.value });
                          setFormError('');
                        }}
                        required={!editingUser}
                        aria-invalid={passwordBlocked}
                        aria-describedby="password-requirements"
                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ${passwordBlocked ? 'border-red-400' : ''}`}
                        placeholder={editingUser ? 'Leave blank to keep current password' : 'Enter password'}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-3 text-gray-500"
                      >
                        <FaKey />
                      </button>
                    </div>
                    <ul id="password-requirements" className="mt-2 space-y-1 text-xs" aria-live="polite">
                      {PASSWORD_RULES.map((rule) => {
                        const met = formData.password !== '' && !passwordFailures.includes(rule.id);
                        return (
                          <li
                            key={rule.id}
                            data-rule={rule.id}
                            data-met={met}
                            className={`flex items-center gap-2 ${met ? 'text-green-600' : 'text-gray-500'}`}
                          >
                            {met ? <FaCheckCircle aria-hidden="true" /> : <FaRegCircle aria-hidden="true" />}
                            <span>{rule.label}</span>
                            <span className="sr-only">{met ? '(met)' : '(not met)'}</span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-xs text-gray-500 mt-1">
                      A symbol is any character that isn't a letter, a number or a space.
                      {editingUser && ' These apply only if you set a new password.'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Role *</label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      required
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="staff">Operational Staff</option>
                      <option value="owner">Admin (Owner)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      {formData.role === 'owner'
                        ? '✓ Full access to all modules including financials and user management'
                        : '✓ Can perform billing, uploads, and chatbot queries'}
                    </p>
                  </div>
                </div>

                {formError && (
                  <div role="alert" className="mt-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                    {formError}
                  </div>
                )}

                <div className="flex gap-4 mt-6">
                  <button
                    type="submit"
                    disabled={passwordBlocked}
                    title={passwordBlocked ? describePasswordPolicyFailures(passwordFailures) : undefined}
                    className="flex-1 bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary-600"
                  >
                    {editingUser ? 'Update User' : 'Register User'}
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

        {/* Users List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {users.map((user) => (
            <div
              key={user.id}
              className={`bg-white rounded-lg shadow p-6 ${!user.isActive ? 'opacity-60' : ''}`}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="text-3xl">
                    {getRoleIcon(user.role)}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold">{user.username}</h3>
                    <span className={`inline-block mt-1 px-3 py-1 rounded-full text-xs font-semibold ${getRoleBadgeColor(user.role)}`}>
                      {user.roleDisplay}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-sm text-gray-600 mb-4">
                <p>✉️ {user.email}</p>
                <p>📅 Registered: {new Date(user.createdAt).toLocaleDateString()}</p>
                <div className="flex items-center gap-2">
                  {user.isActive ? (
                    <>
                      <FaToggleOn className="text-green-500 text-xl" />
                      <span className="text-green-600 font-semibold">Active</span>
                    </>
                  ) : (
                    <>
                      <FaToggleOff className="text-red-500 text-xl" />
                      <span className="text-red-600 font-semibold">Inactive</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(user)}
                  className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm flex items-center justify-center gap-1"
                >
                  <FaEdit /> Edit
                </button>
                {user.role !== 'owner' && (
                  <>
                    <button
                      onClick={() => toggleUserStatus(user.id, user.isActive, user.username)}
                      className={`flex-1 px-3 py-2 ${user.isActive ? 'bg-orange-600 hover:bg-orange-700' : 'bg-green-600 hover:bg-green-700'} text-white rounded text-sm`}
                    >
                      {user.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleDelete(user.id, user.username)}
                      className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                    >
                      <FaTrash />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {users.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No users found. Register your first staff member to get started!
          </div>
        )}

        {/* Permission Matrix Info */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <FaShieldAlt className="text-blue-600" />
            Role Permissions Matrix
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-semibold text-yellow-700 mb-2">Admin (Owner) - Full Access:</h4>
              <ul className="space-y-1 text-gray-700">
                <li>✓ View financial revenue & analytics</li>
                <li>✓ Manage user accounts</li>
                <li>✓ Approve bulk purchase orders</li>
                <li>✓ Modify system settings</li>
                <li>✓ Access all modules</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-blue-700 mb-2">Operational Staff - Limited Access:</h4>
              <ul className="space-y-1 text-gray-700">
                <li>✓ Perform billing operations</li>
                <li>✓ Upload Excel bulk data</li>
                <li>✓ Use AI chatbot queries</li>
                <li>✗ Cannot view financials</li>
                <li>✗ Cannot manage users</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
  );
};

export default UserManagement;
