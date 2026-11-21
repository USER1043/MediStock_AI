import express from 'express';
import { protect, authorize, ownerOnly } from '../middleware/auth.js';
import {
  createSupplier,
  getAllSuppliers,
  updateSupplier,
  getReorderSuggestions,
  createPurchaseOrder,
  getAllPurchaseOrders,
  updatePurchaseOrderStatus,
} from '../controllers/supplierController.js';

const router = express.Router();

// Supplier routes (Owner/Staff can view, only owner can create/update)
router.post('/suppliers', protect, ownerOnly, createSupplier);
router.get('/suppliers', protect, authorize('owner', 'staff'), getAllSuppliers);
router.put('/suppliers/:id', protect, ownerOnly, updateSupplier);

// Reorder drafts (AI_Draft POs from the forecast run): owner and staff can view
router.get('/reorder/suggestions', protect, authorize('owner', 'staff'), getReorderSuggestions);

// Purchase order routes (Owner approves, staff can view)
router.post('/purchase-orders', protect, ownerOnly, createPurchaseOrder); // Owner only
router.get('/purchase-orders', protect, authorize('owner', 'staff'), getAllPurchaseOrders);
router.put('/purchase-orders/:id', protect, authorize('owner', 'staff'), updatePurchaseOrderStatus);

// Legacy routes for backwards compatibility
router.get('/', protect, getAllSuppliers);
router.post('/', protect, ownerOnly, createSupplier);

export default router;
