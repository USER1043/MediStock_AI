import express from 'express';
import {
    runForecast,
    getRecommendations,
    createRecommendation,
    updateRecommendation,
    deleteRecommendation,
    getDemandParameters,
    saveDemandParameters,
    getTrendData,
    triggerRetraining
} from '../controllers/forecastController.js';
import { protect, ownerOnly } from '../middleware/auth.js';

const router = express.Router();

// All forecast routes are protected
router.use(protect);

// Staff review, owner decides. Anyone logged in can list drafts, add a manual one and adjust a draft
// (quantity, priority, date). Approving a draft moves it to Pending, the same step as the owner-only
// PO activation in supplierRoutes, and rejecting or deleting one discards it, so those are owner-only.
// The controller also refuses to touch any purchase order that is not a forecast draft.
const decidesDraft = (req, res, next) =>
    ['approved', 'rejected'].includes(req.body?.status) ? ownerOnly(req, res, next) : next();

router.get('/recommendations', getRecommendations);
router.post('/recommendations', createRecommendation);
router.put('/recommendations/:id', decidesDraft, updateRecommendation);
router.delete('/recommendations/:id', ownerOnly, deleteRecommendation);

// Forecast execution. Both replace every AI_Draft purchase order, so both are owner-only;
// staff Excel imports skip the automatic retrain (see src/pages/ExcelUpload.jsx).
router.post('/run', ownerOnly, runForecast);
router.post('/retrain', ownerOnly, triggerRetraining);

// Parameters config
router.get('/parameters', getDemandParameters);
router.post('/parameters', ownerOnly, saveDemandParameters);

// Visualization
router.get('/trend', getTrendData);

export default router;
