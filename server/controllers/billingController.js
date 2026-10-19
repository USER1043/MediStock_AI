import mongoose from 'mongoose';
import { Bill } from '../models/billModel.js';
import { Medicine } from '../models/medicineModel.js';
import { Customer } from '../models/customerModel.js';
import { InventoryHistory } from '../models/inventoryHistoryModel.js';
import { User } from '../models/userModel.js';
import { generateBillNumber, getStockStatus } from '../utils/helpers.js';
import { sendBillNotification, sendEmailNotification, sendWhatsAppNotification } from '../utils/notifications.js';
import { generateBillPDF } from '../utils/pdfGenerator.js';
import log from '../utils/logger.js';

// Create bill with atomic batch deductions, FEFO allocation, and concurrency protection
export const createBill = async (req, res) => {
  const { customerId, customerName, customerType, items, paymentMethod } = req.body;

  if (!customerName || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Please provide customerName and items',
    });
  }

  // Check if replica set transactions are supported by the connected MongoDB topology
  const topologyType = mongoose.connection?.client?.topology?.description?.type;
  const supportsTransactions =
    topologyType === 'ReplicaSetWithPrimary' ||
    topologyType === 'Sharded' ||
    topologyType === 'LoadBalanced';

  let session = null;
  let useTransaction = false;

  if (supportsTransactions) {
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      useTransaction = true;
    } catch (sessionErr) {
      log('WARN', 'Failed to initialize Mongo session; falling back to OCC with compensating rollback', {
        error: sessionErr.message,
      });
      if (session) await session.endSession().catch(() => {});
      session = null;
      useTransaction = false;
    }
  }

  // Track completed deductions for manual compensating rollback in standalone non-transactional mode
  const completedDeductions = [];
  // Sale history rows written so far; removed on rollback so forecasts/reports don't count phantom sales
  const createdHistoryIds = [];

  try {
    let subtotal = 0;
    const billItems = [];

    for (const item of items) {
      if (!item.quantity || item.quantity <= 0) {
        throw { status: 400, message: `Invalid quantity for medicine: ${item.medicineId}` };
      }

      // Read current medicine state with session if active
      const medicine = await Medicine.findById(item.medicineId).session(useTransaction ? session : null);

      if (!medicine) {
        throw { status: 404, message: `Medicine not found: ${item.medicineId}` };
      }

      if (medicine.quantity < item.quantity) {
        throw {
          status: 400,
          message: `Insufficient stock for ${medicine.name}. Available: ${medicine.quantity}`,
        };
      }

      const itemTotal = medicine.sellingPrice * item.quantity;
      subtotal += itemTotal;

      // Deep clone batches to compute FEFO deduction (oldest expiry date first)
      let updatedBatches = medicine.batches
        ? medicine.batches.map((b) => (b.toObject ? b.toObject() : { ...b }))
        : [];
      let remainingToDeduct = item.quantity;
      const deductedBatchNumbers = [];

      // Sort batches ascending by expiry (FEFO)
      updatedBatches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

      for (let batch of updatedBatches) {
        if (remainingToDeduct === 0) break;
        if (batch.quantity > 0) {
          const deduction = Math.min(batch.quantity, remainingToDeduct);
          batch.quantity -= deduction;
          remainingToDeduct -= deduction;
          deductedBatchNumbers.push(batch.batchNumber);
        }
      }

      // Record the batches actually consumed (may span several when the oldest runs out)
      const billedBatchNumber = deductedBatchNumbers.length > 0 ? deductedBatchNumbers.join(', ') : 'N/A';

      const newQuantity = medicine.quantity - item.quantity;
      const newStockStatus = getStockStatus(newQuantity, medicine.reorderLevel);

      // Atomic conditional update with Optimistic Concurrency Control (OCC)
      // Checks both sufficient quantity and matching version (__v) to prevent lost updates
      const updateFilter = {
        _id: medicine._id,
        quantity: { $gte: item.quantity },
        __v: medicine.__v,
      };

      const updatePayload = {
        $set: {
          quantity: newQuantity,
          batches: updatedBatches,
          stockStatus: newStockStatus,
        },
        $inc: { __v: 1 },
      };

      const updatedMedicine = await Medicine.findOneAndUpdate(updateFilter, updatePayload, {
        new: true,
        session: useTransaction ? session : undefined,
      });

      if (!updatedMedicine) {
        throw {
          status: 409,
          message: `Inventory write conflict or stock depleted for ${medicine.name}. Please retry checkout.`,
        };
      }

      // Track for compensating rollback in case non-transactional mode fails later in loop
      completedDeductions.push({
        medicineId: medicine._id,
        quantityDeducted: item.quantity,
        originalQuantity: medicine.quantity,
        originalBatches: medicine.batches,
        originalStockStatus: medicine.stockStatus,
      });

      billItems.push({
        medicineId: medicine._id,
        name: medicine.name,
        batchNumber: billedBatchNumber,
        quantity: item.quantity,
        price: medicine.sellingPrice,
        total: itemTotal,
      });

      // Log the inventory sale mutation
      const historyDocs = [
        {
          medicineId: medicine._id,
          medicineName: medicine.name,
          action: 'sale',
          quantityChanged: -item.quantity,
          previousQuantity: medicine.quantity,
          newQuantity: newQuantity,
          reason: 'Bill sale',
          performedBy: req.user.id,
        },
      ];

      const createdHistory = await InventoryHistory.create(historyDocs, useTransaction ? { session } : undefined);
      createdHistoryIds.push(...createdHistory.map((h) => h._id));
    }

    // Calculate tax (12% GST)
    const tax = subtotal * 0.12;
    const grandTotal = subtotal + tax;

    // Create bill record
    const billDocs = [
      {
        billNumber: generateBillNumber(),
        customerId: customerId || null,
        customerName,
        customerType,
        items: billItems,
        subtotal,
        tax,
        grandTotal,
        paymentMethod: paymentMethod || 'cash',
        paymentStatus: 'completed',
        staffId: req.user.id,
      },
    ];

    const createdBills = await Bill.create(billDocs, useTransaction ? { session } : undefined);
    const bill = createdBills[0];

    // Commit transaction if active
    if (useTransaction && session) {
      await session.commitTransaction();
    }

    // Asynchronous customer notification & PDF generation outside transaction scope
    let customerEmail = null;
    let customerPhone = null;

    if (customerId) {
      const customer = await Customer.findById(customerId);
      if (customer) {
        customerEmail = customer.email;
        customerPhone = customer.phone;
      }
    }

    try {
      const pdfPath = await generateBillPDF(bill);
      log('INFO', 'Bill PDF generated', { pdfPath });
      await sendBillNotification(bill, customerPhone, customerEmail);

      if (paymentMethod === 'gpay') {
        const owner = await User.findOne({ role: 'owner' });
        if (owner) {
          await sendEmailNotification(
            owner.email,
            'GPay Payment Received',
            `A GPay payment of ₹${grandTotal.toFixed(2)} has been received for Bill #${bill.billNumber}\nCustomer: ${customerName}`
          );

          if (process.env.OWNER_WHATSAPP_NUMBER) {
            await sendWhatsAppNotification(
              process.env.OWNER_WHATSAPP_NUMBER,
              `💰 GPay Payment Received\n\nAmount: ₹${grandTotal.toFixed(2)}\nBill: #${bill.billNumber}\nCustomer: ${customerName}`
            );
          }
        }
      }
    } catch (notifError) {
      log('WARN', 'Notification failed but bill created', {
        billId: bill._id,
        error: notifError.message,
      });
    }

    log('INFO', 'Bill created successfully', { billId: bill._id, billNumber: bill.billNumber });

    return res.status(201).json({
      success: true,
      message: 'Bill created successfully',
      bill,
    });
  } catch (error) {
    // Rollback: abort ACID transaction or execute compensating transaction
    if (useTransaction && session) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        log('ERROR', 'Transaction abort failed', { error: abortErr.message });
      }
    } else if (completedDeductions.length > 0) {
      log('WARN', 'Triggering compensating rollback for partial deductions', {
        count: completedDeductions.length,
      });
      for (const comp of completedDeductions) {
        try {
          await Medicine.updateOne(
            { _id: comp.medicineId },
            {
              $inc: { quantity: comp.quantityDeducted, __v: 1 },
              $set: {
                batches: comp.originalBatches,
                stockStatus: comp.originalStockStatus,
              },
            }
          );
        } catch (rollbackErr) {
          log('ERROR', 'Compensating rollback failed', {
            error: rollbackErr.message,
            medicineId: comp.medicineId,
          });
        }
      }

      if (createdHistoryIds.length > 0) {
        try {
          await InventoryHistory.deleteMany({ _id: { $in: createdHistoryIds } });
        } catch (historyErr) {
          log('ERROR', 'Failed to remove sale history during rollback', {
            error: historyErr.message,
            historyIds: createdHistoryIds,
          });
        }
      }
    }

    log('ERROR', 'Create bill error', { error: error.message || error });
    const statusCode = error.status || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Error creating bill',
    });
  } finally {
    if (session) {
      await session.endSession().catch(() => {});
    }
  }
};

// Get all bills
export const getAllBills = async (req, res) => {
  try {
    const bills = await Bill.find()
      .populate('customerId', 'name phone email')
      .populate('staffId', 'username')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: bills.length,
      bills,
    });
  } catch (error) {
    log('ERROR', 'Get all bills error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching bills',
      error: error.message,
    });
  }
};

// Get single bill
export const getBill = async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id)
      .populate('customerId', 'name phone email')
      .populate('staffId', 'username');

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
    }

    res.status(200).json({
      success: true,
      bill,
    });
  } catch (error) {
    log('ERROR', 'Get bill error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching bill',
      error: error.message,
    });
  }
};

// Get bills by customer
export const getBillsByCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;

    const bills = await Bill.find({ customerId })
      .populate('staffId', 'username')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: bills.length,
      bills,
    });
  } catch (error) {
    log('ERROR', 'Get bills by customer error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching bills',
      error: error.message,
    });
  }
};

// Get bills by date range
export const getBillsByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required',
      });
    }

    const bills = await Bill.find({
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    })
      .populate('customerId', 'name phone')
      .populate('staffId', 'username')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: bills.length,
      bills,
    });
  } catch (error) {
    log('ERROR', 'Get bills by date range error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching bills',
      error: error.message,
    });
  }
};

// Mock payment confirmation
export const confirmPayment = async (req, res) => {
  try {
    const { billId, transactionId } = req.body;

    const bill = await Bill.findById(billId);

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
    }

    bill.paymentStatus = 'completed';
    await bill.save();

    log('INFO', 'Payment confirmed', { billId, transactionId });

    res.status(200).json({
      success: true,
      message: 'Payment confirmed',
      bill,
      transactionId: transactionId || `TXN-${Date.now()}`,
    });
  } catch (error) {
    log('ERROR', 'Confirm payment error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error confirming payment',
      error: error.message,
    });
  }
};

// Get sales summary
export const getSalesSummary = async (req, res) => {
  try {
    const { period } = req.query; // daily, weekly, monthly

    let startDate = new Date();

    if (period === 'weekly') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'monthly') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else {
      startDate.setHours(0, 0, 0, 0);
    }

    const bills = await Bill.find({
      createdAt: { $gte: startDate },
    });

    const totalSales = bills.reduce((sum, bill) => sum + bill.grandTotal, 0);
    const totalBills = bills.length;
    const avgBillValue = totalBills > 0 ? totalSales / totalBills : 0;

    res.status(200).json({
      success: true,
      summary: {
        period: period || 'daily',
        totalSales,
        totalBills,
        avgBillValue,
        startDate,
      },
    });
  } catch (error) {
    log('ERROR', 'Get sales summary error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching sales summary',
      error: error.message,
    });
  }
};
