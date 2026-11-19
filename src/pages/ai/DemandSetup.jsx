/**
 * @file AI demand forecasting configuration setup page.
 * @module pages/ai/DemandSetup
 */
import { useState, useEffect } from 'react';
import axiosInstance from '../../utils/axiosConfig';
import { FaBrain, FaSave, FaPlay, FaRegCalendarAlt } from 'react-icons/fa';
import { toast } from 'react-hot-toast';

export default function DemandSetup() {
    const [params, setParams] = useState({
        forecastHorizon: 4,
        leadTimeDays: 7,
        safetyStockPercent: 20,
        seasonalMultipliers: {
            jan: 1.0, feb: 1.0, mar: 1.1, apr: 1.2, may: 1.2, jun: 1.1,
            jul: 1.3, aug: 1.3, sep: 1.2, oct: 1.4, nov: 1.4, dec: 1.2,
        },
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);

    useEffect(() => {
        fetchParams();
    }, []);

    const fetchParams = async () => {
        try {
            const { data } = await axiosInstance.get('/forecast/parameters');
            if (data.success && data.parameters) {
                setParams(data.parameters);
            }
        } catch (error) {
            console.error('Error fetching parameters:', error);
            toast.error(error.response?.data?.message || 'Failed to load forecast parameters');
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setParams({ ...params, [name]: parseFloat(value) });
    };

    const handleSeasonalChange = (month, value) => {
        setParams({
            ...params,
            seasonalMultipliers: {
                ...params.seasonalMultipliers,
                [month]: parseFloat(value),
            },
        });
    };

    const saveParams = async () => {
        setSaving(true);
        try {
            await axiosInstance.post('/forecast/parameters', params);
            toast.success('Parameters saved successfully');
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to save parameters');
        } finally {
            setSaving(false);
        }
    };

    const runForecast = async () => {
        setRunning(true);
        try {
            const { data } = await axiosInstance.post('/forecast/run');
            toast.success(data.message || 'Forecast complete');
        } catch (error) {
            toast.error(error.response?.data?.message || 'Error running forecast');
        } finally {
            setRunning(false);
        }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-3 mb-6">
                    <FaBrain className="text-3xl text-blue-600" />
                    <h1 className="text-2xl font-bold text-gray-800">Demand Parameter Setup</h1>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Base Configuration */}
                    <div className="bg-white p-6 rounded-xl shadow-md space-y-4">
                        <h2 className="text-lg font-semibold flex items-center gap-2 border-b pb-2 mb-4">
                            <FaRegCalendarAlt className="text-blue-500" /> Base Configuration
                        </h2>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Order Planning Horizon (Weeks)
                            </label>
                            <input
                                type="number"
                                name="forecastHorizon"
                                value={params.forecastHorizon}
                                onChange={handleInputChange}
                                className="w-full border p-2 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
                                min="1" max="12"
                            />
                            <p className="text-xs text-gray-400 mt-1">How many weeks into the future do you want to plan your stock for?</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Supplier Shipping Delay (Days)
                            </label>
                            <input
                                type="number"
                                name="leadTimeDays"
                                value={params.leadTimeDays}
                                onChange={handleInputChange}
                                className="w-full border p-2 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
                                min="1" max="60"
                            />
                            <p className="text-xs text-gray-400 mt-1">Average number of days it takes for a box to arrive after ordering.</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Emergency Buffer Stock (%)
                            </label>
                            <input
                                type="number"
                                name="safetyStockPercent"
                                value={params.safetyStockPercent}
                                onChange={handleInputChange}
                                className="w-full border p-2 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
                                min="0" max="100"
                            />
                            <p className="text-xs text-gray-400 mt-1">Extra buffer percentage to keep on shelves for sudden demand spikes or late shipments.</p>
                        </div>

                        <div className="pt-4 flex gap-3">
                            <button
                                onClick={saveParams}
                                disabled={saving}
                                className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 transition flex items-center justify-center gap-2 disabled:bg-blue-300"
                            >
                                <FaSave /> {saving ? 'Saving...' : 'Save Parameters'}
                            </button>
                            <button
                                onClick={runForecast}
                                disabled={running}
                                className="flex-1 bg-green-600 text-white py-2 rounded-lg font-semibold hover:bg-green-700 transition flex items-center justify-center gap-2 disabled:bg-green-300"
                            >
                                <FaPlay /> {running ? 'Running...' : 'Run Forecast'}
                            </button>
                        </div>
                    </div>

                    {/* Seasonal Multipliers */}
                    <div className="bg-white p-6 rounded-xl shadow-md">
                        <h2 className="text-lg font-semibold flex items-center gap-2 border-b pb-2 mb-4">
                            <FaBrain className="text-purple-500" /> Seasonal Multipliers
                        </h2>
                        <p className="text-xs text-gray-500 mb-4">
                            Teach the AI when to expect seasonal disease spikes (e.g., flu season, monsoon allergies). <br />
                            <strong>1.0x</strong> = Normal Month,  <strong>1.4x</strong> = 40% more patients expected.
                        </p>

                        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                            {Object.entries(params.seasonalMultipliers).map(([month, val]) => (
                                <div key={month} className="flex flex-col">
                                    <div className="flex justify-between text-xs font-semibold uppercase text-gray-500 mb-1">
                                        <span>{month}</span>
                                        <span className="text-blue-600">{val.toFixed(1)}x</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0.5"
                                        max="2.5"
                                        step="0.1"
                                        value={val}
                                        onChange={(e) => handleSeasonalChange(month, e.target.value)}
                                        className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-8 bg-blue-50 border border-blue-200 p-4 rounded-xl">
                    <div className="flex gap-3">
                        <FaBrain className="text-blue-500 text-xl shrink-0 mt-1" />
                        <div>
                            <p className="font-semibold text-blue-900">How the AI engine works</p>
                            <p className="text-sm text-blue-700 leading-relaxed">
                                The forecasting engine uses a <strong>TensorFlow Long Short-Term Memory (LSTM) Neural Network</strong> to analyze your historical sales data.
                                It identifies complex sequential patterns spanning 90 days and overlays your <strong>Seasonal Multipliers</strong> to predict future demand.
                                The "Run Forecast" action will compile the model and generate precise reorder recommendations based on dynamically learned outflow.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
    );
}
