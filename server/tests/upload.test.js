import request from 'supertest';
import mongoose from 'mongoose';
import app from '../server.js';
import { Medicine } from '../models/medicineModel.js';
import { AuditLog } from '../models/auditLogModel.js';
import { User } from '../models/userModel.js';
import jwt from 'jsonwebtoken';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { jest } from '@jest/globals';

describe('Integration Test: POST /api/uploads/excel', () => {
    let token;
    let testUser;
    let validFilePath;
    let anomalyFilePath;

    // Set timeout longer for DB connection and Supertest initialization
    jest.setTimeout(15000);

    beforeAll(async () => {
        // 1. Connect to a test database if not already connected
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/medistock_test_db');
        }

        // 2. Mock a QA User and explicitly generate a valid JWT token
        testUser = await User.create({
            username: 'qa_engineer',
            email: 'qa@medistock.test',
            password: 'QaEngineer#1',
            role: 'owner',
        });
        token = jwt.sign({ id: testUser._id, role: testUser.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });

        // 3. Prepare the 'Success Case' valid mock .xlsx file
        const validData = [
            {
                name: 'Amoxicillin 250mg',
                category: 'Antibiotics',
                batchNumber: 'QA-BATCH-001',
                expiryDate: '2028-12-31',
                quantity: 500,
                purchasePrice: 10,
                sellingPrice: 15,
                rackNumber: 'A-12',
                reorderLevel: 50,
                supplier: 'PharmaCorp',
            }
        ];
        const validWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(validWb, XLSX.utils.json_to_sheet(validData), 'Data');
        validFilePath = path.join(__dirname, 'valid_mock.xlsx');
        XLSX.writeFile(validWb, validFilePath);

        // 4. Prepare the 'Anomaly Case' mock .xlsx file (Negative Qty, Expired Date)
        const anomalyData = [
            {
                name: 'Expired Aspirin',
                category: 'Painkillers',
                batchNumber: 'QA-BATCH-002',
                expiryDate: '2020-01-01', // Expired date
                quantity: -100,           // Negative quantity
                purchasePrice: 5,
                sellingPrice: 8,
                rackNumber: 'B-04',
                reorderLevel: 20,
                supplier: 'PharmaCorp',
            }
        ];
        const anomalyWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(anomalyWb, XLSX.utils.json_to_sheet(anomalyData), 'Data');
        anomalyFilePath = path.join(__dirname, 'anomaly_mock.xlsx');
        XLSX.writeFile(anomalyWb, anomalyFilePath);

        await AuditLog.deleteMany({ userId: testUser._id });
        await Medicine.deleteMany({ "batches.batchNumber": { $in: ['QA-BATCH-001', 'QA-BATCH-002'] } });
    });

    afterAll(async () => {
        // Cleanup filesystem mock files
        if (fs.existsSync(validFilePath)) fs.unlinkSync(validFilePath);
        if (fs.existsSync(anomalyFilePath)) fs.unlinkSync(anomalyFilePath);

        // Wipe test data generated during these tests
        await Medicine.deleteMany({ "batches.batchNumber": { $in: ['QA-BATCH-001', 'QA-BATCH-002'] } });
        await AuditLog.deleteMany({ userId: testUser._id });
        await User.findByIdAndDelete(testUser._id);

        await mongoose.connection.close();
    });


    /* =========================================================
       TEST SUITE EXECUTION
       ========================================================= */

    it('Security: Should return 401 Unauthorized if JWT token is missing', async () => {
        const res = await request(app)
            .post('/api/uploads/excel')
            .attach('file', validFilePath); // No Authorization header piped

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toMatch(/Not authorized/i);
    });


    it('Success Case: Should process valid Excel file, return 200 OK, and record AuditLog', async () => {
        const res = await request(app)
            .post('/api/uploads/excel')
            .set('Authorization', `Bearer ${token}`)
            .attach('file', validFilePath);

        // Verify endpoint HTTP response
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify AuditLog natively recorded the success
        const logId = res.body.uploadLog._id;
        const dbLog = await AuditLog.findById(logId);

        expect(dbLog).toBeTruthy();
        expect(dbLog.details.recordsSuccessful).toBe(1);
        expect(dbLog.action).toBe('EXCEL_UPLOAD');
    });


    it('Validation Check: Should verify the data in MongoDB matches the Excel file exactly', async () => {
        // Re-query the DB for the medicine that was just created in the success case
        const savedMedicine = await Medicine.findOne({ "batches.batchNumber": 'QA-BATCH-001' });

        expect(savedMedicine).not.toBeNull();
        expect(savedMedicine.name).toBe('Amoxicillin 250mg');
        expect(savedMedicine.quantity).toBe(500);
        expect(savedMedicine.sellingPrice).toBe(15);
        expect(savedMedicine.category).toBe('Antibiotics'); // String-based category directly mapping
        expect(savedMedicine.batches[0].batchNumber).toBe('QA-BATCH-001');
    });


    it('Anomaly Case: Should flag Negative Quantities and Expired Dates in the anomalies array', async () => {
        const res = await request(app)
            .post('/api/uploads/excel')
            .set('Authorization', `Bearer ${token}`)
            .attach('file', anomalyFilePath);

        expect(res.status).toBe(200);

        // Access the anomalies tracked by detectAnomalies inside the returned UploadLog mock
        const { anomalies } = res.body.uploadLog;

        expect(anomalies).toBeDefined();
        expect(anomalies.length).toBeGreaterThan(0);

        // Stringify the anomalies array to easily check if our intentional errors were caught
        const anomalyText = JSON.stringify(anomalies).toLowerCase();

        // Validate detectAnomalies() behavior
        expect(anomalyText).toMatch(/negative/);
        expect(anomalyText).toMatch(/expir/);
    });

});
