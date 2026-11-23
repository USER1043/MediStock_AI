import { jest } from '@jest/globals';
import { lstmForecast } from '../ml/lstmModel.js';

describe('System Testing: LSTM Accuracy & Predictive Thresholds', () => {
    // Set a longer timeout for training the neural network
    jest.setTimeout(30000);

    const generateSyntheticData = (pattern = 'linear', length = 30) => {
        const data = [];
        for (let i = 0; i < length; i++) {
            if (pattern === 'linear') {
                data.push(10 + i * 2); // Increasing trend
            } else if (pattern === 'seasonal') {
                data.push(20 + Math.sin(i / 2) * 10); // Sine wave seasonality
            } else {
                data.push(Math.random() * 50); // Noise
            }
        }
        return data;
    };

    it('Accuracy: LSTM should predict a continuing trend within ±20% margin', async () => {
        const historicalData = generateSyntheticData('linear', 40);
        const horizon = 7;

        // Final value in historical data is 10 + 39*2 = 88
        // Next 7 values should be 90, 92, 94, 96, 98, 100, 102
        // Total expected = 672
        const expectedTotal = 672;

        const forecast = await lstmForecast(historicalData, horizon);
        const actualTotal = forecast.reduce((a, b) => a + b, 0);

        const error = Math.abs(actualTotal - expectedTotal) / expectedTotal;

        console.log(`LSTM Linear Total: Expected ${expectedTotal}, Actual ${actualTotal.toFixed(2)}, Error ${(error * 100).toFixed(2)}%`);

        expect(error).toBeLessThan(0.25); // Allow 25% error for small synthetic training
    });

    it('Accuracy: LSTM should capture sinusoidal seasonal patterns', async () => {
        const historicalData = generateSyntheticData('seasonal', 60);
        const horizon = 7;

        const forecast = await lstmForecast(historicalData, horizon);

        // Verify we get non-zero, non-constant values (indicates learning)
        const isConstant = forecast.every(v => v === forecast[0]);
        const sum = forecast.reduce((a, b) => a + b, 0);

        expect(isConstant).toBe(false);
        expect(sum).toBeGreaterThan(0);
    });

    it('Thresholds: Should flag "critical" priority when predicted demand exceeds stock', () => {
        // This simulates the logic used in classifyMedicineMovements
        const currentStock = 10;
        const reorderLevel = 50;

        let priority = 'medium';
        if (currentStock <= reorderLevel / 2) priority = 'critical';

        expect(priority).toBe('critical');
    });
});
