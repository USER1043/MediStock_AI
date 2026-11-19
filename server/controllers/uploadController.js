import XLSX from 'xlsx';
import fs from 'fs';
import { Medicine } from '../models/medicineModel.js';
import { AuditLog } from '../models/auditLogModel.js';
import { detectAnomalies, addStockToBatches, requestPath } from '../utils/helpers.js';
import { buildSupplierLookup, supplierDisplayNames } from '../utils/supplierRef.js';
import log from '../utils/logger.js';

// Row errors kept in the audit entry (the response carries all of them)
const MAX_STORED_ROW_ERRORS = 100;

// Upload Excel file
export const uploadExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    // Read Excel file
    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    // Detect anomalies
    const anomalies = detectAnomalies(data);

    let recordsSuccessful = 0;
    let recordsFailed = 0;
    const rowErrors = []; // { row, message }, row numbered like the anomalies (1 = first data row)

    // Suppliers are matched in memory: one query for the whole import
    const suppliers = await buildSupplierLookup();

    // Process records
    for (const [index, row] of data.entries()) {
      try {
        // Resolve the supplier first so a bad one fails the row before any stock changes
        const supplier = suppliers.resolve(row.supplier);
        if (supplier.notFound || supplier.ambiguous) {
          throw new Error(
            supplier.notFound
              ? `supplier '${supplier.text}' not found — add it on the Suppliers page first`
              : `supplier '${supplier.text}' matches more than one supplier — use the supplier id instead`
          );
        }

        const categoryString = row.category || 'Uncategorized';

        // Check if medicine already exists based on parent name
        const existingMedicine = await Medicine.findOne({
          name: row.name,
        });

        if (existingMedicine) {
          // Add to the batch with the same batch number and expiry, or start a new batch
          addStockToBatches(existingMedicine.batches, {
            batchNumber: String(row.batchNumber),
            expiryDate: row.expiryDate,
            quantity: parseInt(row.quantity) || 0,
            rackNumber: row.rackNumber
          });
          // Update total quantity
          existingMedicine.quantity += parseInt(row.quantity) || 0;
          // A blank supplier cell keeps the current supplier
          if (supplier.id) existingMedicine.supplier = supplier.id;
          // Bump __v so concurrent bills/adjustments (which check it) see this stock change
          existingMedicine.increment();
          await existingMedicine.save();
        } else {
          // Create new parent drug with first batch
          await Medicine.create({
            name: row.name,
            category: categoryString,
            quantity: parseInt(row.quantity) || 0,
            reorderLevel: row.reorderLevel || 50,
            purchasePrice: row.purchasePrice,
            sellingPrice: row.sellingPrice,
            ...(supplier.id ? { supplier: supplier.id } : {}),
            batches: [{
              batchNumber: String(row.batchNumber),
              expiryDate: row.expiryDate,
              quantity: parseInt(row.quantity) || 0,
              rackNumber: row.rackNumber || 'N/A'
            }]
          });
        }
        recordsSuccessful++;
      } catch (error) {
        recordsFailed++;
        rowErrors.push({ row: index + 1, message: `Row ${index + 1}: ${error.message}` });
        log('WARN', 'Failed to process row', { row: index + 1, error: error.message });
      }
    }

    // Log upload directly to AuditLog (replacing UploadLog)
    const auditRecord = await AuditLog.create({
      userId: req.user?.id,
      username: req.user?.username,
      action: 'EXCEL_UPLOAD',
      module: 'DataImport',
      details: {
        fileName: req.file.originalname,
        fileSizeBytes: req.file.size,
        totalRecords: data.length,
        recordsSuccessful,
        recordsFailed,
        anomalies,
        errors: rowErrors.slice(0, MAX_STORED_ROW_ERRORS),
      },
      ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown',
      httpMethod: 'POST',
      endpoint: requestPath(req), // the audit middleware skips this route, so this is the only entry
      statusCode: 200,
    });

    // Clean up file
    fs.unlinkSync(filePath);

    log('INFO', 'Excel file uploaded and processed', {
      fileName: req.file.originalname,
      recordsSuccessful,
      recordsFailed,
    });

    // Mock UploadLog shape for frontend/tests compatibility
    const mockUploadLog = {
      _id: auditRecord._id,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      recordsProcessed: data.length,
      recordsSuccessful,
      recordsFailed,
      status: recordsFailed === 0 ? 'success' : 'partial',
      anomalies,
      errors: rowErrors,
    };

    res.status(200).json({
      success: true,
      message: 'File uploaded and processed successfully',
      uploadLog: mockUploadLog,
    });
  } catch (error) {
    log('ERROR', 'Upload Excel error', { error: error.message });

    // Clean up file on error
    if (req.file && req.file.path) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: error.message,
    });
  }
};

// Get upload history
export const getUploadHistory = async (req, res) => {
  try {
    const auditLogs = await AuditLog.find({ action: 'EXCEL_UPLOAD' })
      .populate('userId', 'username email')
      .sort({ timestamp: -1 });

    const uploadLogs = auditLogs.map(log => ({
      _id: log._id,
      fileName: log.details?.fileName || 'Unknown File',
      fileSize: log.details?.fileSizeBytes || 0,
      recordsProcessed: log.details?.totalRecords || 0,
      recordsSuccessful: log.details?.recordsSuccessful || 0,
      recordsFailed: log.details?.recordsFailed || 0,
      uploadedBy: log.userId,
      status: log.details?.recordsFailed === 0 ? 'success' : 'partial',
      createdAt: log.timestamp
    }));

    res.status(200).json({
      success: true,
      count: uploadLogs.length,
      uploadLogs,
    });
  } catch (error) {
    log('ERROR', 'Get upload history error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching upload history',
      error: error.message,
    });
  }
};

// Get single upload log
export const getUploadLog = async (req, res) => {
  try {
    const auditLog = await AuditLog.findById(req.params.id).populate(
      'userId',
      'username email'
    );

    if (!auditLog) {
      return res.status(404).json({
        success: false,
        message: 'Upload log not found',
      });
    }

    const uploadLog = {
      _id: auditLog._id,
      fileName: auditLog.details?.fileName || 'Unknown File',
      fileSize: auditLog.details?.fileSizeBytes || 0,
      recordsProcessed: auditLog.details?.totalRecords || 0,
      recordsSuccessful: auditLog.details?.recordsSuccessful || 0,
      recordsFailed: auditLog.details?.recordsFailed || 0,
      anomalies: auditLog.details?.anomalies || [],
      errors: auditLog.details?.errors || [],
      uploadedBy: auditLog.userId,
      status: auditLog.details?.recordsFailed === 0 ? 'success' : 'partial',
      createdAt: auditLog.timestamp
    };

    res.status(200).json({
      success: true,
      uploadLog,
    });
  } catch (error) {
    log('ERROR', 'Get upload log error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching upload log',
      error: error.message,
    });
  }
};

// Export inventory to Excel
export const exportExcel = async (req, res) => {
  try {
    const medicines = await Medicine.find().lean();

    // Medicine.supplier holds a Supplier _id; the sheet shows (and re-imports) the supplier name
    const supplierName = await supplierDisplayNames(medicines.map(m => m.supplier));

    // Flatten batches into rows for export
    const rows = [];
    medicines.forEach(m => {
      // If there are no batches, just output the parent structure
      if (!m.batches || m.batches.length === 0) {
        rows.push({
          name: m.name,
          category: m.category,
          batchNumber: 'N/A',
          expiryDate: 'N/A',
          quantity: m.quantity,
          purchasePrice: m.purchasePrice,
          sellingPrice: m.sellingPrice,
          rackNumber: 'N/A',
          reorderLevel: m.reorderLevel,
          supplier: supplierName(m.supplier),
          stockStatus: m.stockStatus || 'low',
        });
      } else {
        m.batches.forEach(b => {
          rows.push({
            name: m.name,
            category: m.category,
            batchNumber: b.batchNumber,
            expiryDate: b.expiryDate,
            quantity: b.quantity, // Individual batch quantity
            purchasePrice: m.purchasePrice,
            sellingPrice: m.sellingPrice,
            rackNumber: b.rackNumber,
            reorderLevel: m.reorderLevel,
            supplier: supplierName(m.supplier),
            stockStatus: m.stockStatus || 'low',
          });
        });
      }
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Auto-fit column widths
    const colWidths = Object.keys(rows[0] || {}).map(key => ({
      wch: Math.max(key.length, ...rows.map(r => String(r[key] ?? '').length)) + 2,
    }));
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `inventory_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);

    log('INFO', 'Inventory exported to Excel', { rows: rows.length });
  } catch (error) {
    log('ERROR', 'Export Excel error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error exporting inventory',
      error: error.message,
    });
  }
};
