import { Customer } from '../models/customerModel.js';
import log from '../utils/logger.js';

// Create customer
export const createCustomer = async (req, res) => {
  try {
    const { name, phone, email, customerType, address, city } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name and phone',
      });
    }

    const existingCustomer = await Customer.findOne({ phone });
    if (existingCustomer) {
      return res.status(400).json({
        success: false,
        message: 'Customer with this phone already exists',
      });
    }

    const customer = await Customer.create({
      name,
      phone,
      email,
      customerType: customerType || 'walking',
      address,
      city,
    });

    log('INFO', 'Customer created', { customerId: customer._id, name });

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      customer,
    });
  } catch (error) {
    log('ERROR', 'Create customer error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error creating customer',
      error: error.message,
    });
  }
};

// Get all customers
export const getAllCustomers = async (req, res) => {
  try {
    const { customerType } = req.query;

    const filter = {};
    if (customerType) filter.customerType = customerType;

    const customers = await Customer.find(filter).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: customers.length,
      customers,
    });
  } catch (error) {
    log('ERROR', 'Get all customers error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching customers',
      error: error.message,
    });
  }
};

// Get single customer
export const getCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    res.status(200).json({
      success: true,
      customer,
    });
  } catch (error) {
    log('ERROR', 'Get customer error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching customer',
      error: error.message,
    });
  }
};

// Update customer
export const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const customer = await Customer.findByIdAndUpdate(id, updates, {
      returnDocument: 'after',
      runValidators: true,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    log('INFO', 'Customer updated', { customerId: id });

    res.status(200).json({
      success: true,
      message: 'Customer updated successfully',
      customer,
    });
  } catch (error) {
    log('ERROR', 'Update customer error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error updating customer',
      error: error.message,
    });
  }
};

// Delete customer
export const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findByIdAndDelete(id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    log('INFO', 'Customer deleted', { customerId: id });

    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully',
    });
  } catch (error) {
    log('ERROR', 'Delete customer error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error deleting customer',
      error: error.message,
    });
  }
};

// Search customers
export const searchCustomers = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required',
      });
    }

    const customers = await Customer.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { phone: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
      ],
    });

    res.status(200).json({
      success: true,
      count: customers.length,
      customers,
    });
  } catch (error) {
    log('ERROR', 'Search customers error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error searching customers',
      error: error.message,
    });
  }
};

// Get customer stats
export const getCustomerStats = async (req, res) => {
  try {
    const totalCustomers = await Customer.countDocuments();
    const regularCustomers = await Customer.countDocuments({ customerType: 'regular' });
    const walkingCustomers = await Customer.countDocuments({ customerType: 'walking' });

    res.status(200).json({
      success: true,
      stats: {
        totalCustomers,
        regularCustomers,
        walkingCustomers,
      },
    });
  } catch (error) {
    log('ERROR', 'Get customer stats error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching customer stats',
      error: error.message,
    });
  }
};
