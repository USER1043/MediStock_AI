/**
 * @file Database seeder script for local development environment.
 * @module seedFiles/seedAll
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
import { getStockStatus } from "../utils/helpers.js";
import { isMedicineLowStock } from "../utils/stockLevel.js";
import { lowStockCondition } from "../services/alertService.js";
import { Report } from "../models/reportModel.js";
import { Supplier, PurchaseOrder } from "../models/supplierModels.js";
import { createSeedClock } from "./seedClock.js";

dotenv.config();

// Generates a random integer between min and max inclusive.
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Every seeded date is relative to the moment the seed runs, and seeded activity is never after it
const { daysAgoDate, daysFutureDate } = createSeedClock();

let billSeq = 1000;
const nextBill = () => `BILL-SEED-${billSeq++}`;
const SAMPLE_IPS = [
  "192.168.1.10",
  "192.168.1.21",
  "10.0.0.5",
  "172.16.0.3",
  "127.0.0.1",
];
const ip = () => SAMPLE_IPS[rand(0, SAMPLE_IPS.length - 1)];

const seedDatabase = async () => {
  try {
    await connectDB();
    console.log("Connected to MongoDB");

    // ── 0. CLEAR EXISTING DATA ──────────────────────────────────────────
    console.log("Cleaning existing data across all collections...");
    await Promise.all([
      Medicine.deleteMany({}),
      Customer.deleteMany({}),
      Bill.deleteMany({}),
      Supplier.deleteMany({}),
      InventoryHistory.deleteMany({}),
      AuditLog.deleteMany({}),
      PurchaseOrder.deleteMany({}),
      Alert.deleteMany({}),
      Report.deleteMany({}),
    ]);
    console.log("✓ Existing data cleared");

    // ── 1. FETCH USERS (Required for Analytics Data) ───────────────────
    const users = await User.find({});
    if (users.length === 0) {
      throw new Error(
        "No users found in database. Required to seed analytics. Please run the base seed script or create users first.",
      );
    }
    const owner = users.find((u) => u.role === "owner") || users[0];
    const staffList = users.filter((u) => u.role === "staff");
    const getStaff = () =>
      staffList.length > 0 ? staffList[rand(0, staffList.length - 1)] : owner;
    console.log("✓ Using existing secure users");

    // ── 2. SEED SUPPLIERS ───────────────────────────────────────────────
    const supplierData = [
      {
        supplier_name: "MedSupply India",
        contact_info: {
          phone: "+919876543210",
          email: "contact@medsupply.com",
          address: "123 Medical Street",
          city: "Chennai",
          state: "Tamil Nadu",
          pincode: "600040",
        },
        delivery_performance_score: 8.5,
        total_orders: 45,
        successful_deliveries: 42,
        medicine_categories: ["Analgesic", "Antibiotic", "Anti-inflammatory"],
        is_active: true,
      },
      {
        supplier_name: "PharmaHub Distributors",
        contact_info: {
          phone: "+919988776655",
          email: "sales@pharmahub.in",
          address: "456 Healthcare Avenue",
          city: "Chennai",
          state: "Tamil Nadu",
          pincode: "600017",
        },
        delivery_performance_score: 7.2,
        total_orders: 32,
        successful_deliveries: 28,
        medicine_categories: ["Topical", "Antacid", "Vitamin"],
        is_active: true,
      },
      {
        supplier_name: "HealthCare Solutions",
        contact_info: {
          phone: "+918765432109",
          email: "info@healthcaresol.com",
          address: "789 Wellness Road",
          city: "Chennai",
          state: "Tamil Nadu",
          pincode: "600042",
        },
        delivery_performance_score: 9.1,
        total_orders: 67,
        successful_deliveries: 65,
        medicine_categories: [
          "Cough Suppressant",
          "Antihistamine",
          "Analgesic",
        ],
        is_active: true,
      },
      {
        supplier_name: "Apollo MedSource",
        contact_info: {
          phone: "+917654321098",
          email: "orders@apollomedsource.com",
          address: "321 Medical Plaza",
          city: "Chennai",
          state: "Tamil Nadu",
          pincode: "600020",
        },
        delivery_performance_score: 8.8,
        total_orders: 54,
        successful_deliveries: 52,
        medicine_categories: ["Tablet", "Injection", "Drops"],
        is_active: true,
      },
    ];
    const suppliers = await Supplier.insertMany(supplierData);
    const supplierMap = {};
    suppliers.forEach((s) => {
      supplierMap[s.supplier_name] = s._id;
    });
    console.log(`✓ ${suppliers.length} Suppliers seeded`);

    // ── 3. SEED CUSTOMERS ───────────────────────────────────────────────
    const customerData = [
      {
        name: "Rajesh Kumar",
        phone: "9876543210",
        email: "rajesh.k@example.com",
        customerType: "regular",
        address: "123 Main St",
        city: "Chennai",
        totalPurchases: 0,
        totalSpent: 0,
      },
      {
        name: "Priya Sharma",
        phone: "9876543211",
        email: "priya.sharma@example.com",
        customerType: "regular",
        address: "456 Oak Avenue",
        city: "Chennai",
        totalPurchases: 0,
        totalSpent: 0,
      },
      {
        name: "Anita Patel",
        phone: "9876543212",
        email: "anita.p@example.com",
        customerType: "walking",
        address: "789 Pine Road",
        city: "Chennai",
        totalPurchases: 0,
        totalSpent: 0,
      },
      {
        name: "Mohammed Ali",
        phone: "9876543213",
        email: "m.ali@example.com",
        customerType: "regular",
        address: "321 Cedar Lane",
        city: "Chennai",
        totalPurchases: 0,
        totalSpent: 0,
      },
      {
        name: "Sneha Reddy",
        phone: "9876543214",
        email: "sneha.r@example.com",
        customerType: "walking",
        address: "654 Elm Street",
        city: "Chennai",
        totalPurchases: 0,
        totalSpent: 0,
      },
      {
        name: "Karthik Raja",
        phone: "9876543218",
        email: "karthik.r@example.com",
        customerType: "regular",
        address: "369 Ash Court",
        city: "Chennai",
        totalPurchases: 0,
        totalSpent: 0,
      },
      {
        name: "Meera Iyer",
        phone: "9876543221",
        email: "meera.i@example.com",
        customerType: "regular",
        address: "159 Poplar Road",
        city: "Chennai",
        totalPurchases: 0,
        totalSpent: 0,
      },
    ];
    const customers = await Customer.insertMany(customerData);
    console.log(`✓ ${customers.length} Customers seeded`);

    // ── 4. SEED MEDICINES & BATCHES ─────────────────────────────────────
    const medicineData = [
      {
        name: "Aspirin",
        category: "Analgesic",
        batches: [
          {
            batchNumber: "ASP-001",
            expiryDate: daysFutureDate(180),
            quantity: 500,
            rackNumber: "A1",
          },
        ],
        quantity: 500,
        reorderLevel: 100,
        purchasePrice: 5,
        sellingPrice: 10,
        supplier: "MedSupply India",
      },
      {
        name: "Amoxicillin",
        category: "Antibiotic",
        batches: [
          {
            batchNumber: "AMX-001",
            expiryDate: daysFutureDate(20),
            quantity: 45,
            rackNumber: "B2",
          },
        ],
        quantity: 45,
        reorderLevel: 100,
        purchasePrice: 15,
        sellingPrice: 30,
        supplier: "MedSupply India",
      },
      {
        name: "Paracetamol",
        category: "Analgesic",
        batches: [
          {
            batchNumber: "PAR-001",
            expiryDate: daysAgoDate(15),
            quantity: 200,
            rackNumber: "A2",
          },
        ],
        quantity: 200,
        reorderLevel: 80,
        purchasePrice: 2,
        sellingPrice: 5,
        supplier: "HealthCare Solutions",
      },
      {
        name: "Omeprazole",
        category: "Antacid",
        batches: [
          {
            batchNumber: "OMP-001",
            expiryDate: daysFutureDate(90),
            quantity: 80,
            rackNumber: "C1",
          },
        ],
        quantity: 80,
        reorderLevel: 100,
        purchasePrice: 8,
        sellingPrice: 18,
        supplier: "PharmaHub Distributors",
      },
      {
        name: "Cough Syrup",
        category: "Cough Suppressant",
        batches: [
          {
            batchNumber: "CS-001",
            expiryDate: daysAgoDate(45),
            quantity: 120,
            rackNumber: "D1",
          },
        ],
        quantity: 120,
        reorderLevel: 50,
        purchasePrice: 12,
        sellingPrice: 25,
        supplier: "HealthCare Solutions",
      },
      {
        name: "Ibuprofen",
        category: "Anti-inflammatory",
        batches: [
          {
            batchNumber: "IBU-001",
            expiryDate: daysFutureDate(14),
            quantity: 30,
            rackNumber: "A3",
          },
        ],
        quantity: 30,
        reorderLevel: 100,
        purchasePrice: 6,
        sellingPrice: 12,
        supplier: "MedSupply India",
      },
      {
        name: "Vitamin C",
        category: "Vitamin",
        batches: [
          {
            batchNumber: "VIT-001",
            expiryDate: daysFutureDate(365),
            quantity: 300,
            rackNumber: "E1",
          },
        ],
        quantity: 300,
        reorderLevel: 100,
        purchasePrice: 3,
        sellingPrice: 8,
        supplier: "PharmaHub Distributors",
      },
      {
        name: "Antibiotic Cream",
        category: "Topical",
        batches: [
          {
            batchNumber: "AC-001",
            expiryDate: daysFutureDate(45),
            quantity: 40,
            rackNumber: "F1",
          },
        ],
        quantity: 40,
        reorderLevel: 50,
        purchasePrice: 20,
        sellingPrice: 45,
        supplier: "PharmaHub Distributors",
      },
      {
        name: "Cetirizine",
        category: "Antihistamine",
        batches: [
          {
            batchNumber: "CET-001",
            expiryDate: daysFutureDate(150),
            quantity: 150,
            rackNumber: "B1",
          },
        ],
        quantity: 150,
        reorderLevel: 50,
        purchasePrice: 4,
        sellingPrice: 10,
        supplier: "HealthCare Solutions",
      },
      {
        name: "Metformin",
        category: "Antidiabetic",
        batches: [
          {
            batchNumber: "MET-001",
            expiryDate: daysFutureDate(400),
            quantity: 500,
            rackNumber: "C2",
          },
        ],
        quantity: 500,
        reorderLevel: 100,
        purchasePrice: 15,
        sellingPrice: 35,
        supplier: "Apollo MedSource",
      },
      {
        name: "Amlodipine",
        category: "Antihypertensive",
        batches: [
          {
            batchNumber: "AML-001",
            expiryDate: daysFutureDate(240),
            quantity: 250,
            rackNumber: "D2",
          },
        ],
        quantity: 250,
        reorderLevel: 80,
        purchasePrice: 12,
        sellingPrice: 28,
        supplier: "Apollo MedSource",
      },
      {
        name: "Azithromycin",
        category: "Antibiotic",
        batches: [
          {
            batchNumber: "AZI-001",
            expiryDate: daysFutureDate(60),
            quantity: 60,
            rackNumber: "E2",
          },
        ],
        quantity: 60,
        reorderLevel: 30,
        purchasePrice: 40,
        sellingPrice: 85,
        supplier: "MedSupply India",
      },
    ];

    const mappedMedicines = medicineData.map((m) => ({
      ...m,
      stockStatus: getStockStatus(m.quantity, m.reorderLevel),
      supplier: supplierMap[m.supplier]
        ? String(supplierMap[m.supplier])
        : m.supplier,
    }));
    const medicines = await Medicine.insertMany(mappedMedicines);
    console.log(
      `✓ ${medicines.length} Medicines seeded (via embedded Batches)`,
    );

    // ── 5. SEED ANALYTICS (Bills, InventoryHistory, & Historical Forecasts)
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
            reason: "analytics-seed",
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
      `✓ Seeded ${bills.length} Bills and ${historyRecords.length} Inventory/Sales operations`,
    );

    for (const c of customers) {
      const customerBills = bills.filter(
        (b) => String(b.customerId) === String(c._id),
      );
      const totalPurchases = customerBills.length;
      const totalSpent =
        Math.round(
          customerBills.reduce((sum, b) => sum + b.grandTotal, 0) * 100,
        ) / 100;
      await Customer.updateOne(
        { _id: c._id },
        { $set: { totalPurchases, totalSpent } },
      );
    }
    console.log("✓ Customers Analytics synced natively");

    // ── 6. SEED EXCEPTIONAL ACTIVITIES (Purchase Orders, Alerts, Reorders)

    const purchaseOrders = [];
    // Normal Purchase Orders
    for (let i = 0; i < 3; i++) {
      const med = medicines[i];
      const supplierDoc = await Supplier.findById(med.supplier).catch(
        () => suppliers[0],
      );

      purchaseOrders.push({
        order_number: `PO-${rand(1000, 9999)}`,
        medicine_id: med._id,
        medicine_name: med.name,
        supplier_id: supplierDoc._id,
        requested_quantity: rand(100, 500),
        unit_price: med.purchasePrice,
        total_amount: med.purchasePrice * rand(100, 500),
        order_status: ["Pending", "Ordered", "Shipped"][i],
        expected_delivery_date: new Date(Date.now() + 86400000 * rand(3, 10)),
        created_by: owner._id,
        approved_by: owner._id,
      });
    }

    const alerts = [];
    const notifications = [];
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

      notifications.push({
        userId: owner._id,
        recipientType: "email",
        recipient: owner.email,
        subject: `Low Stock Alert: ${med.name}`,
        message: alertDoc.message,
        relatedAlertId: alertDoc._id,
        status: "sent",
        createdAt: daysAgoDate(1),
      });

      // Reorder suggestion is natively an AI Draft PurchaseOrder now
      const sup =
        suppliers.find((s) => s._id.toString() === med.supplier) ||
        suppliers[0];
      purchaseOrders.push({
        order_number: `PO-AI-${rand(1000, 9999)}`,
        medicine_id: med._id,
        medicine_name: med.name,
        supplier_id: sup._id,
        requested_quantity: med.reorderLevel * 2,
        unit_price: med.purchasePrice,
        total_amount: med.purchasePrice * (med.reorderLevel * 2),
        order_status: "AI_Draft",
        expected_delivery_date: new Date(Date.now() + 86400000 * rand(5, 7)),
        created_by: owner._id,
        ai_forecast_reference: {
          demand_predicted: med.reorderLevel * 2.5,
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
        revenue:
          Math.round(bills.reduce((s, b) => s + b.grandTotal, 0) * 100) / 100,
      },
      generatedBy: owner._id,
    });

    console.log(
      `✓ Generated ${purchaseOrders.length} native PurchaseOrders (Regular + AI Drafts), ${alerts.length} Alerts`,
    );
    console.log(`✓ Generated custom reports`);

    // ── 7. SEED AUDIT LOGS ─────────────────────────────────────────────
    const auditEntries = [];

    // Simulating the UploadLog we deleted using AuditLogs
    auditEntries.push({
      userId: owner._id,
      username: owner.username,
      action: "EXCEL_UPLOAD",
      module: "DataImport",
      details: {
        fileName: "monthly_inventory_sheet.xlsx",
        fileSizeBytes: 2048576,
        totalRecords: 120,
        recordsSuccessful: 118,
        recordsFailed: 2,
        anomalies: [
          { row: 45, field: "sellingPrice", issue: "Invalid number format" },
        ],
      },
      ipAddress: ip(),
      httpMethod: "POST",
      endpoint: "/api/uploads/excel",
      statusCode: 200,
      timestamp: daysAgoDate(10),
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
    let medDayOffset = 29;
    for (const med of medicines) {
      auditEntries.push({
        userId: owner._id,
        username: owner.username,
        action: "MEDICINE_CREATED",
        module: "Inventory",
        details: {
          name: med.name,
          category: med.category,
          quantity: med.quantity,
        },
        ipAddress: ip(),
        httpMethod: "POST",
        endpoint: "SEED/api/inventory",
        statusCode: 201,
        timestamp: daysAgoDate(medDayOffset, rand(10, 18)),
      });
      medDayOffset = Math.max(0, medDayOffset - 1);
    }

    await AuditLog.insertMany(auditEntries, { ordered: false });
    console.log(
      `✓ Seeded ${auditEntries.length} coherent Audit Logs matching exact dataset events`,
    );

    console.log(`
      ╔═════════════════════════════════════════════════════════╗
      ║    Master Database Schema 2.0 Seeding Completed!        ║
      ╠═════════════════════════════════════════════════════════╣
      ║ Core Models                                             ║
      ║ ├─ Users              : ${users.length.toString().padEnd(30)}║
      ║ ├─ Suppliers          : ${suppliers.length.toString().padEnd(30)}║
      ║ ├─ Customers          : ${customers.length.toString().padEnd(30)}║
      ║ └─ Medicines          : ${medicines.length.toString().padEnd(30)}║
      ║                                                         ║
      ║ Analytics & Logs                                        ║
      ║ ├─ Bills              : ${bills.length.toString().padEnd(30)}║
      ║ └─ Audit Logs         : ${auditEntries.length.toString().padEnd(30)}║
      ║                                                         ║
      ║ Extensions                                              ║
      ║ ├─ PurchaseOrders     : ${purchaseOrders.length.toString().padEnd(30)}║
      ║ ├─ Alerts             : ${alerts.length.toString().padEnd(30)}║
      ║ └─ Misc (Reports)     : generated                       ║
      ╚═════════════════════════════════════════════════════════╝
        `);

    await mongoose.disconnect();
    console.log("Database Connection Closed.");
    process.exit(0);
  } catch (error) {
    console.error("Seeding error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
};

seedDatabase();
