/**
 * @file Machine learning demand forecasting algorithm combining Holt-Winters & LSTM models.
 * @module ml/demandForecast
 */
import { Bill } from '../models/billModel.js';
import { InventoryHistory } from '../models/inventoryHistoryModel.js';
import { lstmForecast } from './lstmModel.js';
import { isLowStock } from '../utils/stockLevel.js';

/**
 * Holt-Winters Double Exponential Smoothing (Trend-adjusted)
 * Suitable for data with trend but without significant seasonality in small datasets.
 * We will then overlay manual seasonal multipliers as requested.
 */
const holtWintersForecast = (data, alpha, beta, horizon) => {
    if (data.length < 2) return Array(horizon).fill(data[0] || 0);

    let level = data[0];
    let trend = data[1] - data[0];

    for (let i = 1; i < data.length; i++) {
        const lastLevel = level;
        level = alpha * data[i] + (1 - alpha) * (level + trend);
        trend = beta * (level - lastLevel) + (1 - beta) * trend;
    }

    const forecast = [];
    for (let h = 1; h <= horizon; h++) {
        forecast.push(Math.max(0, level + h * trend));
    }
    return forecast;
};

/**
 * Pull and clean historical sales records
 * Combines data from Bills and InventoryHistory (sales)
 */
export const prepareHistoricalData = async (medicineId) => {
    // Get sales from Bills
    const bills = await Bill.find({
        'items.medicineId': medicineId,
        paymentStatus: 'completed'
    }).sort({ createdAt: 1 }).lean();

    const billSales = bills.map(bill => {
        const item = bill.items.find(i => i.medicineId.toString() === medicineId.toString());
        return {
            date: bill.createdAt,
            quantity: item ? item.quantity : 0
        };
    });

    // Get sales from InventoryHistory (in case some sales bypassed the Bill module)
    const history = await InventoryHistory.find({
        medicineId,
        action: 'sale'
    }).sort({ createdAt: 1 }).lean();

    const historySales = history.map(h => ({
        date: h.createdAt,
        quantity: Math.abs(h.quantityChanged)
    }));

    // Merge and group by day
    const merged = [...billSales, ...historySales];
    const byDay = {};

    merged.forEach(s => {
        const day = new Date(s.date).toISOString().split('T')[0];
        byDay[day] = (byDay[day] || 0) + s.quantity;
    });

    // Convert to sorted array of quantities (last 90 days)
    const sortedDays = Object.keys(byDay).sort();
    if (sortedDays.length === 0) return [];

    const firstDate = new Date(sortedDays[0]);
    const lastDate = new Date();
    const dayCount = Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24)) + 1;

    const fullSeries = [];
    for (let i = 0; i < dayCount; i++) {
        const d = new Date(firstDate);
        d.setDate(d.getDate() + i);
        const key = d.toISOString().split('T')[0];
        fullSeries.push(byDay[key] || 0);
    }

    return fullSeries.slice(-90); // Use last 90 days
};

/**
 * Get seasonal multiplier based on month
 */
export const getSeasonalMultiplier = (month, params) => {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthKey = months[month].toLowerCase();
    return params.seasonalMultipliers[monthKey] || 1.0;
};

/**
 * Classify medicine based on movement
 */
export const classifyMedicineMovements = (series, currentStock, reorderLevel) => {
    const totalSales = series.reduce((a, b) => a + b, 0);
    const avgSales = totalSales / (series.length || 1);

    let movement = 'normal';
    if (avgSales > 10 || totalSales > 100) movement = 'fast_moving';
    if (avgSales < 1 && totalSales < 10) movement = 'slow_moving';

    let priority = 'medium';
    if (movement === 'fast_moving') priority = 'high';
    if (isLowStock(currentStock, reorderLevel)) priority = 'high';
    if (movement === 'slow_moving' && currentStock > reorderLevel * 2) priority = 'low';

    return { movement, priority };
};

/**
 * Compute forecast for a single medicine
 */
export const computeForecast = async (medicine, params) => {
    const series = await prepareHistoricalData(medicine._id);

    // If no historical data, use a fallback based on current reorder level
    if (series.length < 7) {
        const dailyReorder = medicine.reorderLevel / 30; // Approx daily need
        const predicted = dailyReorder * 7 * params.forecastHorizon;
        const currentMonth = new Date().getMonth();
        const seasonalFactor = getSeasonalMultiplier(currentMonth, params);

        const adjustedPredicted = predicted * seasonalFactor;
        const { priority } = classifyMedicineMovements(series, medicine.quantity, medicine.reorderLevel);

        // Optimal Reorder Qty = (Lead Time Demand + Safety Stock) - Current Inventory
        const leadTimeDemand = dailyReorder * params.leadTimeDays;
        const safetyStock = (params.safetyStockPercent / 100) * adjustedPredicted;
        const optimalQty = Math.max(0, Math.ceil((leadTimeDemand + safetyStock + adjustedPredicted / 4) - medicine.quantity));

        return {
            medicineId: medicine._id,
            medicineName: medicine.name,
            category: medicine.category?.name || 'Uncategorized',
            currentStock: medicine.quantity,
            predictedDemand: Math.ceil(adjustedPredicted),
            optimalReorderQty: optimalQty > 0 ? optimalQty : 0,
            restockingDate: new Date(Date.now() + params.leadTimeDays * 24 * 60 * 60 * 1000),
            priority,
            seasonalFactor
        };
    }

    // Run LSTM Forecast
    const horizonDays = params.forecastHorizon * 7;
    const rawForecast = await lstmForecast(series, horizonDays);
    const predictedSum = rawForecast.reduce((a, b) => a + b, 0);

    const currentMonth = new Date().getMonth();
    const seasonalFactor = getSeasonalMultiplier(currentMonth, params);
    const adjustedPredicted = predictedSum * seasonalFactor;

    const { priority } = classifyMedicineMovements(series, medicine.quantity, medicine.reorderLevel);

    // Optimal Reorder Calculation
    const avgDaily = predictedSum / horizonDays;
    const leadTimeDemand = avgDaily * params.leadTimeDays;
    const safetyStock = (params.safetyStockPercent / 100) * adjustedPredicted;

    // Simple reorder point logic
    const optimalQty = Math.max(0, Math.ceil((leadTimeDemand + safetyStock + (adjustedPredicted / params.forecastHorizon)) - medicine.quantity));

    return {
        medicineId: medicine._id,
        medicineName: medicine.name,
        category: medicine.category?.name || 'Uncategorized',
        currentStock: medicine.quantity,
        predictedDemand: Math.ceil(adjustedPredicted),
        optimalReorderQty: optimalQty,
        restockingDate: new Date(Date.now() + params.leadTimeDays * 24 * 60 * 60 * 1000),
        priority,
        seasonalFactor
    };
};
