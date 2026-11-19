/**
 * @file Bulk Excel import and inventory export page component.
 * @module pages/ExcelUpload
 */
import { useState, useEffect, useRef } from 'react';
import axiosInstance from '../utils/axiosConfig';
import { useAuth } from '../context/AuthContext';
import { FaFileExcel, FaUpload, FaDownload, FaCheckCircle, FaTimesCircle, FaExclamationTriangle, FaInfoCircle, FaSpinner } from 'react-icons/fa';

const TEMPLATE_HEADERS = ['name', 'category', 'batchNumber', 'expiryDate', 'quantity', 'purchasePrice', 'sellingPrice', 'rackNumber', 'reorderLevel', 'supplier'];

const ExcelUpload = () => {
  const { hasRole } = useAuth();
  // Retraining replaces every AI draft purchase order, so the API allows it for owners only
  const canRetrain = hasRole('owner');
  const [activeTab, setActiveTab] = useState('import');
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      setHistoryLoading(true);
      const res = await axiosInstance.get('/uploads');
      setHistory(res.data.uploadLogs || []);
    } catch (err) {
      console.error('Failed to fetch upload history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      setSelectedFile(file);
      setUploadResult(null);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setUploadResult(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadResult(null);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const res = await axiosInstance.post('/uploads/excel', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadResult({ success: true, log: res.data.uploadLog, forecastsDeferred: !canRetrain });
      setSelectedFile(null);
      fetchHistory();
      // Continuous Learning: owners retrain the AI forecast after each import; staff imports leave
      // the current AI drafts alone until an owner runs the forecast
      if (canRetrain) {
        axiosInstance.post('/forecast/retrain').catch(e => console.error('AI Retrain trigger failed:', e));
      }

    } catch (err) {
      setUploadResult({
        success: false,
        message: err.response?.data?.message || 'Upload failed',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await axiosInstance.get('/uploads/export', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setExporting(false);
    }
  };

  const downloadTemplate = () => {
    const csvContent = TEMPLATE_HEADERS.join(',') + '\n' +
      'Paracetamol 500mg,Analgesic,BATCH001,2026-12-31,100,5.00,10.00,A-01,50,MedCorp';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventory_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (d) => d ? new Date(d).toLocaleString('en-IN') : '-';

  const statusBadge = (status) => {
    const map = {
      success: 'bg-green-100 text-green-700',
      partial: 'bg-yellow-100 text-yellow-700',
      failed: 'bg-red-100 text-red-700',
    };
    return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${map[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
  };

  return (
    <div>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <FaFileExcel className="text-green-600 text-3xl" />
            <h1 className="text-3xl font-bold text-gray-900">Excel Import / Export</h1>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
          >
            {exporting ? <FaSpinner className="animate-spin" /> : <FaDownload />}
            {exporting ? 'Exporting…' : 'Export Inventory'}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200">
          {['import', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 font-semibold capitalize text-sm border-b-2 transition-colors ${activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              {tab === 'import' ? 'Import Excel' : 'Upload History'}
            </button>
          ))}
        </div>

        {activeTab === 'import' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Upload area */}
            <div className="lg:col-span-2 space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${dragOver
                  ? 'border-blue-500 bg-blue-50'
                  : selectedFile
                    ? 'border-green-400 bg-green-50'
                    : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50'
                  }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {selectedFile ? (
                  <div className="flex flex-col items-center gap-2">
                    <FaFileExcel className="text-green-500 text-5xl" />
                    <p className="font-semibold text-gray-800">{selectedFile.name}</p>
                    <p className="text-sm text-gray-500">{formatBytes(selectedFile.size)}</p>
                    <span className="text-xs text-blue-500">Click to change file</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-gray-500">
                    <FaUpload className="text-4xl text-gray-400" />
                    <p className="text-lg font-semibold">Drop your Excel file here</p>
                    <p className="text-sm">or click to browse</p>
                    <p className="text-xs text-gray-400">Supported: .xlsx, .xls</p>
                  </div>
                )}
              </div>

              {selectedFile && (
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
                >
                  {uploading ? <FaSpinner className="animate-spin" /> : <FaUpload />}
                  {uploading ? 'Uploading and Processing…' : 'Upload & Import'}
                </button>
              )}

              {/* Result */}
              {uploadResult && (
                <div className={`p-5 rounded-xl border ${uploadResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  {uploadResult.success ? (
                    <div className="flex items-start gap-3">
                      <FaCheckCircle className="text-green-500 text-xl mt-0.5" />
                      <div>
                        <p className="font-semibold text-green-800">Import Successful</p>
                        <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                          <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                            <p className="text-2xl font-bold text-gray-800">{uploadResult.log.recordsProcessed}</p>
                            <p className="text-gray-500 text-xs">Total Records</p>
                          </div>
                          <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                            <p className="text-2xl font-bold text-green-600">{uploadResult.log.recordsSuccessful}</p>
                            <p className="text-gray-500 text-xs">Successful</p>
                          </div>
                          <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                            <p className="text-2xl font-bold text-red-500">{uploadResult.log.recordsFailed}</p>
                            <p className="text-gray-500 text-xs">Failed</p>
                          </div>
                        </div>
                        {uploadResult.log.anomalies?.length > 0 && (
                          <div className="mt-3 flex items-center gap-2 text-yellow-700 text-sm">
                            <FaExclamationTriangle />
                            <span>{uploadResult.log.anomalies.length} anomalies detected</span>
                          </div>
                        )}
                        {uploadResult.forecastsDeferred && (
                          <div className="mt-3 flex items-center gap-2 text-blue-700 text-sm">
                            <FaInfoCircle />
                            <span>AI forecasts will update when an owner runs the forecast.</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <FaTimesCircle className="text-red-500 text-xl" />
                      <p className="text-red-700 font-semibold">{uploadResult.message}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Instructions panel */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl shadow-md p-5">
                <h3 className="font-bold text-gray-800 mb-3">Required Columns</h3>
                <ul className="space-y-1.5">
                  {TEMPLATE_HEADERS.map(col => (
                    <li key={col} className="text-sm text-gray-600 flex items-center gap-2">
                      <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                      <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{col}</code>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-white rounded-xl shadow-md p-5">
                <h3 className="font-bold text-gray-800 mb-3">Tips</h3>
                <ul className="space-y-2 text-sm text-gray-600 list-disc list-inside">
                  <li>Use YYYY-MM-DD format for expiry dates</li>
                  <li>Prices should be numbers (no ₹ symbol)</li>
                  <li>If a medicine+batch already exists, its quantity will be added</li>
                  <li>Max file size: 5 MB</li>
                </ul>
              </div>

              <button
                onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-green-500 text-green-600 rounded-xl font-semibold hover:bg-green-50 transition-colors"
              >
                <FaDownload />
                Download Template
              </button>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['File Name', 'Size', 'Records', 'Successful', 'Failed', 'Status', 'Uploaded By', 'Date'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {historyLoading ? (
                  <tr>
                    <td colSpan="8" className="px-5 py-10 text-center text-gray-400">
                      <FaSpinner className="animate-spin inline mr-2" />Loading history…
                    </td>
                  </tr>
                ) : history.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-5 py-10 text-center text-gray-400">No uploads yet</td>
                  </tr>
                ) : history.map(log => (
                  <tr key={log._id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm font-medium text-gray-800 flex items-center gap-2">
                      <FaFileExcel className="text-green-500" />{log.fileName}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">{formatBytes(log.fileSize)}</td>
                    <td className="px-5 py-3 text-sm text-gray-700 font-semibold">{log.recordsProcessed}</td>
                    <td className="px-5 py-3 text-sm text-green-600 font-semibold">{log.recordsSuccessful}</td>
                    <td className="px-5 py-3 text-sm text-red-500 font-semibold">{log.recordsFailed}</td>
                    <td className="px-5 py-3">{statusBadge(log.status)}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{log.uploadedBy?.username || '-'}</td>
                    <td className="px-5 py-3 text-sm text-gray-500">{formatDate(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
  );
};

export default ExcelUpload;
