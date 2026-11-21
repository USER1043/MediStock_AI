/**
 * @file Seeder script to refresh temporal data (bills, sales history, audit logs, alerts, POs) relative to current time.
 * @module seedFiles/seedTemporal
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/database.js";
import { User } from "../models/userModel.js";
import { Medicine } from "../models/medicineModel.js";
import { Customer } from "../models/customerModel.js";
import { Bill } from "../models/billModel.js";
import { InventoryHistory } from "../models/inventoryHistoryModel.js";
import { AuditLog } from "../models/auditLogModel.js";
import { Alert } from "../models/alertModel.js";
import { isMedicineLowStock } from "../utils/stockLevel.js";
import { lowStockCondition } from "../services/alertService.js";
import { Report } from "../models/reportModel.js";
import { Supplier, PurchaseOrder } from "../models/supplierModels.js";
import { createSeedClock } from "./seedClock.js";

dotenv.config();

// Generates a random integer between min and max inclusive.
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Every seeded date is relative to the moment the seed runs, and seeded activity is never after it
const { now: SEED_NOW, daysAgoDate, daysFutureDate } = createSeedClock();

let billSeq = 5000;
const nextBill = () => `BILL-TEMP-${billSeq++}`;
// Purchase-order numbers: a counter, like bill numbers (random 4-digit numbers could repeat)
let poSeq = 1000;
const nextPo = (prefix) => `${prefix}-TEMP-${poSeq++}`;
const SAMPLE_IPS = [
  "192.168.1.10",
  "192.168.1.21",
  "10.0.0.5",
  "172.16.0.3",
  "127.0.0.1",
];
const ip = () => SAMPLE_IPS[rand(0, SAMPLE_IPS.length - 1)];

const refreshTemporalData = async () => {
  try {
    await connectDB();
    console.log("Connected to MongoDB for Temporal Data Refresh");

    // ── 1. VERIFY CORE ENTITIES EXIST ────────────────────────────────────
    const [users, medicines, customers, suppliers] = await Promise.all([
      User.find({}),
      Medicine.find({}),
      Customer.find({}),
      Supplier.find({}),
    ]);

    if (users.length === 0 || medicines.length === 0 || customers.length === 0) {
      throw new Error(
        "Core database entities (Users/Medicines/Customers) are missing. Run full 'npm run seed' first."
      );
    }

    const owner = users.find((u) => u.role === "owner") || users[0];
    const staffList = users.filter((u) => u.role === "staff");
    const getStaff = () =>
      staffList.length > 0 ? staffList[rand(0, staffList.length - 1)] : owner;

    // ── 2. UPDATE MEDICINE BATCH EXPIRY DATES RELATIVE TO CURRENT DATE ──
    console.log("Updating medicine batch expiry dates dynamically...");
    for (let i = 0; i < medicines.length; i++) {
      const med = medicines[i];
      if (med.batches && med.batches.length > 0) {
        // Vary expiry dates: some expired, some near-expiry, some far future
        const offset = (i % 4 === 0) ? -15 : (i % 4 === 1) ? 15 : (i % 4 === 2) ? 60 : 180;
        med.batches[0].expiryDate = daysFutureDate(offset);
        await med.save();
      }
    }
    console.log("✓ Medicine batch expiry dates refreshed");

    // ── 3. CLEAR ONLY TEMPORAL ACTIVITY COLLECTIONS ──────────────────────
    console.log("Cleaning previous temporal logs, bills, alerts, and POs...");
    await Promise.all([
      Bill.deleteMany({}),
      InventoryHistory.deleteMany({}),
      AuditLog.deleteMany({}),
      PurchaseOrder.deleteMany({}),
      Alert.deleteMany({}),
      Report.deleteMany({}),
    ]);
    console.log("✓ Temporal activity collections cleared");

    // ── 4. GENERATE 30 DAYS OF RICH BILLING & INVENTORY SALES HISTORY ──
    const bills = [];
    const historyRecords = [];
    const historicalForecastPOs = [];
    const defaultSupplier = suppliers[0] || { _id: new mongoose.Types.ObjectId() };

    for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
      const date = daysAgoDate(daysAgo);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      // Generate rich daily volume: 15-32 bills on weekends, 10-22 on weekdays
      const billsThisDay = isWeekend ? rand(15, 32) : rand(10, 22);
      let dayTotalUnitsSold = 0;

      for (let b = 0; b < billsThisDay; b++) {
        const numItems = rand(1, 5);
        const shuffled = [...medicines].sort(() => Math.random() - 0.5);
        const pickedMeds = shuffled.slice(0, numItems);

        const items = pickedMeds.map((m) => {
          const quantity = rand(1, 8);
          dayTotalUnitsSold += quantity;
          const price = m.sellingPrice;
          return {
            medicineId: m._id,
            name: m.name,
            quantity,
            price,
            total: Math.round(price * quantity * 100) / 100,
          };
        });

        const subtotal = items.reduce((s, i) => s + i.total, 0);
        const tax = Math.round(subtotal * 0.05 * 100) / 100;
        const grandTotal = Math.round((subtotal + tax) * 100) / 100;
        const customer = customers[rand(0, customers.length - 1)];

        const bill = {
          billNumber: nextBill(),
          customerId: customer?._id || null,
          customerName: customer?.name || "Walk-in Customer",
          customerType: customer?.customerType || "walking",
          items,
          subtotal,
          tax,
          grandTotal,
          paymentMethod: ["cash", "gpay", "upi", "card"][rand(0, 3)],
          paymentStatus: "completed",
          createdAt: date,
          updatedAt: date,
        };
        bills.push(bill);

        items.forEach((item) => {
          historyRecords.push({
            medicineId: item.medicineId,
            medicineName: item.name,
            action: "sale",
            quantityChanged: -item.quantity,
            previousQuantity: 999,
            newQuantity: 999 - item.quantity,
            reason: "temporal-refresh-seed",
            createdAt: date,
            updatedAt: date,
          });
        });
      }

      // Seed historical AI forecast prediction record for this day
      const predictedDemandUnits = Math.round(dayTotalUnitsSold * (0.88 + (((daysAgo * 37 + 19) % 27) / 100)));
      historicalForecastPOs.push({
        order_number: `PO-HIST-${Date.now()}-${daysAgo}`,
        medicine_id: medicines[0]._id,
        medicine_name: medicines[0].name,
        supplier_id: defaultSupplier._id,
        requested_quantity: predictedDemandUnits,
        unit_price: 15,
        total_amount: predictedDemandUnits * 15,
        order_status: "AI_Draft",
        expected_delivery_date: new Date(date.getTime() + 7 * 86400000),
        created_by: owner._id,
        ai_forecast_reference: {
          demand_predicted: predictedDemandUnits * 7,
          forecast_date: date,
          priority: "Medium",
        },
      });
    }

    await Bill.insertMany(bills, { ordered: false });
    await InventoryHistory.insertMany(historyRecords, { ordered: false });
    await PurchaseOrder.insertMany(historicalForecastPOs, { ordered: false });
    console.log(
      `✓ Seeded ${bills.length} Bills & ${historyRecords.length} Sales History records across past 30 days`
    );

    // ── 5. RE-SYNC CUSTOMER ANALYTICS ───────────────────────────────────
    for (const c of customers) {
      const customerBills = bills.filter(
        (b) => String(b.customerId) === String(c._id)
      );
      const totalPurchases = customerBills.length;
      const totalSpent =
        Math.round(
          customerBills.reduce((sum, b) => sum + b.grandTotal, 0) * 100
        ) / 100;
      await Customer.updateOne(
        { _id: c._id },
        { $set: { totalPurchases, totalSpent } }
      );
    }
    console.log("✓ Customer analytics totals re-synced");

    // ── 6. SEED ALERTS & PURCHASE ORDERS ───────────────────────────────
    const purchaseOrders = [];
    const mainSupplier = suppliers[0] || { _id: new mongoose.Types.ObjectId() };

    for (let i = 0; i < Math.min(3, medicines.length); i++) {
      const med = medicines[i];
      purchaseOrders.push({
        order_number: nextPo('PO'),
        medicine_id: med._id,
        medicine_name: med.name,
        supplier_id: med.supplier || defaultSupplier._id,
        requested_quantity: rand(100, 500),
        unit_price: med.purchasePrice || 10,
        total_amount: (med.purchasePrice || 10) * rand(100, 500),
        order_status: ["Pending", "Ordered", "Shipped"][i],
        expected_delivery_date: new Date(Date.now() + 86400000 * rand(3, 10)),
        created_by: owner._id,
        approved_by: owner._id,
      });
    }

    const alerts = [];
    const lowStockMeds = medicines.filter(isMedicineLowStock);
    for (const med of lowStockMeds) {
      // Same alert the alert service would raise (message, severity, fingerprint)
      const { alertType, message, severity, fingerprint } = lowStockCondition(med);
      const alertDoc = await Alert.create({
        medicineId: med._id,
        medicineName: med.name,
        alertType,
        message,
        severity,
        fingerprint,
      });
      alerts.push(alertDoc);

      purchaseOrders.push({
        order_number: nextPo('PO-AI'),
        medicine_id: med._id,
        medicine_name: med.name,
        supplier_id: med.supplier || defaultSupplier._id,
        requested_quantity: (med.reorderLevel || 50) * 2,
        unit_price: med.purchasePrice || 10,
        total_amount: (med.purchasePrice || 10) * (med.reorderLevel || 50) * 2,
        order_status: "AI_Draft",
        expected_delivery_date: new Date(Date.now() + 86400000 * rand(5, 7)),
        created_by: owner._id,
        ai_forecast_reference: {
          demand_predicted: (med.reorderLevel || 50) * 2.5,
          forecast_date: new Date(),
          priority: alertDoc.severity === "critical" ? "High" : "Medium",
        },
      });
    }
    await PurchaseOrder.insertMany(purchaseOrders);

    await Report.create({
      reportType: "sales",
      period: "monthly",
      date: new Date(),
      data: {
        totalSales: bills.length,
        revenue: Math.round(bills.reduce((s, b) => s + b.grandTotal, 0) * 100) / 100,
      },
      generatedBy: owner._id,
    });
    console.log(`✓ Seeded ${purchaseOrders.length} PurchaseOrders & ${alerts.length} Alerts`);

    // ── 7. SEED AUDIT LOGS ─────────────────────────────────────────────
    const auditEntries = [];

    auditEntries.push({
      userId: owner._id,
      username: owner.username,
      action: "TEMPORAL_REFRESH",
      module: "System",
      details: { refreshedAt: SEED_NOW.toISOString() },
      ipAddress: ip(),
      httpMethod: "POST",
      endpoint: "/api/seed/temporal",
      statusCode: 200,
      timestamp: SEED_NOW,
    });

    for (let day = 29; day >= 0; day--) {
      auditEntries.push({
        userId: owner._id,
        username: owner.username,
        action: "USER_LOGIN",
        module: "System",
        details: { role: "owner" },
        ipAddress: ip(),
        httpMethod: "POST",
        endpoint: "SEED/api/auth/login",
        statusCode: 200,
        timestamp: daysAgoDate(day, 9),
      });
      const staff = getStaff();
      auditEntries.push({
        userId: staff._id,
        username: staff.username,
        action: "USER_LOGIN",
        module: "System",
        details: { role: staff.role || "staff" },
        ipAddress: ip(),
        httpMethod: "POST",
        endpoint: "SEED/api/auth/login",
        statusCode: 200,
        timestamp: daysAgoDate(day, 10),
      });
    }

    for (const bill of bills) {
      const biller = getStaff();
      auditEntries.push({
        userId: biller._id,
        username: biller.username,
        action: "BILL_GENERATED",
        module: "Billing",
        details: {
          billNumber: bill.billNumber,
          grandTotal: bill.grandTotal,
          paymentMethod: bill.paymentMethod,
        },
        ipAddress: ip(),
        httpMethod: "POST",
        endpoint: "SEED/api/billing",
        statusCode: 201,
        timestamp: bill.createdAt,
      });
    }

    await AuditLog.insertMany(auditEntries, { ordered: false });
    console.log(`✓ Seeded ${auditEntries.length} Audit Logs`);

    console.log(`
      ╔═════════════════════════════════════════════════════════╗
      ║    Temporal Data Refresh Completed Successfully!       ║
      ╠═════════════════════════════════════════════════════════╣
      ║ Core Models (Kept Preserved)                            ║
      ║ ├─ Users              : ${users.length.toString().padEnd(30)}║
      ║ ├─ Suppliers          : ${suppliers.length.toString().padEnd(30)}║
      ║ ├─ Customers          : ${customers.length.toString().padEnd(30)}║
      ║ └─ Medicines          : ${medicines.length.toString().padEnd(30)}║
      ║                                                         ║
      ║ Refreshed Temporal Data                                 ║
      ║ ├─ Bills (30 Days)    : ${bills.length.toString().padEnd(30)}║
      ║ ├─ Audit Logs         : ${auditEntries.length.toString().padEnd(30)}║
      ║ ├─ Purchase Orders    : ${purchaseOrders.length.toString().padEnd(30)}║
      ║ └─ Alerts             : ${alerts.length.toString().padEnd(30)}║
      ╚═════════════════════════════════════════════════════════╝
    `);

    await mongoose.disconnect();
    console.log("Database Connection Closed.");
    process.exit(0);
  } catch (error) {
    console.error("Temporal Refresh Seeding Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
};

refreshTemporalData();
