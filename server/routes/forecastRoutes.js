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

// Recommendation CRUD
router.get('/recommendations', getRecommendations);
router.post('/recommendations', createRecommendation);
router.put('/recommendations/:id', updateRecommendation);
router.delete('/recommendations/:id', deleteRecommendation);

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
