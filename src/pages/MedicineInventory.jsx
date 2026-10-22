/**
 * @file Medicine inventory database page component for managing medicines and batches.
 * @module pages/MedicineInventory
 */
import { useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
import axiosInstance from '../utils/axiosConfig';

// MUI imports
import {
    Autocomplete,
    TextField,
    Button,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Snackbar,
    Alert,
    Box,
    Typography,
    Paper,
    Grid,
    Divider,
    InputAdornment,
    IconButton,
    Chip,
} from '@mui/material';

import { DataGrid } from '@mui/x-data-grid';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';

import {
    FaSearch,
    FaPlus,
    FaEdit,
    FaTrashAlt,
    FaTimes,
    FaPills,
} from 'react-icons/fa';

const emptyForm = {
    medicineId: '',
    name: '',
    category: '',
    purchasePrice: '',
    unitPrice: '',
    stockQuantity: '',
    rackNumber: '',
    expiryDate: null,
    supplierId: '',
};

const MedicineInventory = () => {
    // ── state ──────────────────────────────────────────────
    const [form, setForm] = useState(emptyForm);
    const [medicines, setMedicines] = useState([]);
    const [allMedicines, setAllMedicines] = useState([]); // keep full list for searches
    const [suppliers, setSuppliers] = useState([]);
    const [categories, setCategories] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedRow, setSelectedRow] = useState(null);
    const [isEditMode, setIsEditMode] = useState(false);
    const [loading, setLoading] = useState(false);

    // dialog
    const [dialog, setDialog] = useState({ open: false, type: '', title: '', message: '' });

    // snackbar
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });


    // Convert API records to the shape expected by the grid
    // The row shows (and edits) one batch: the earliest-expiring one that still has stock
    function convertRecordToRow(m) {
        const batches = m.batches || [];
        const inStock = batches.filter((b) => b.quantity > 0)
            .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
        const primaryBatch = inStock[0] || batches[0] || {};
        return {
            _id: String(m._id),
            version: m.__v,
            batchId: primaryBatch._id ? String(primaryBatch._id) : null,
            batchQuantity: primaryBatch.quantity || 0,
            batchCount: batches.length,
            medicineId: primaryBatch.batchNumber || m.medicineId || String(m._id),
            name: m.name,
            category: m.category,
            purchasePrice: m.purchasePrice,
            unitPrice: m.sellingPrice || m.unitPrice,
            stockQuantity: m.quantity || m.stockQuantity || 0,
            rackNumber: primaryBatch.rackNumber || m.rackNumber,
            expiryDate: primaryBatch.expiryDate || m.expiryDate,
            supplierId: m.supplier || null,
        };
    }

    // ── data fetchers ──────────────────────────────────────
    const fetchMedicines = useCallback(async function fetchMedicinesImpl() {
        try {
            setLoading(true);
            const res = await axiosInstance.get('/inventory');
            const data = Array.isArray(res.data.medicines) ? res.data.medicines : [];
            const rows = data.map(convertRecordToRow);
            setAllMedicines(rows);
            setMedicines(rows);
        } catch (error) {
            console.error('Failed to fetch medicines:', error);
            showSnackbar('Failed to fetch medicine inventory', 'error');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetches active suppliers from the backend database.
    const fetchSuppliers = useCallback(async function fetchSuppliersImpl() {
        try {
            const res = await axiosInstance.get('/suppliers');
            setSuppliers(Array.isArray(res.data) ? res.data : (res.data.suppliers || []));
        } catch (error) {
            console.error('Failed to fetch suppliers:', error);
            showSnackbar('Failed to fetch suppliers list', 'error');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetches dynamic medicine categories from the backend database.
    const fetchCategories = useCallback(async function fetchCategoriesImpl() {
        try {
            const res = await axiosInstance.get('/categories');
            const data = Array.isArray(res.data.categories) ? res.data.categories : [];
            const categoryNames = data.map((c) => c.name);
            setCategories(categoryNames);
        } catch (error) {
            console.error('Failed to fetch categories list:', error);
        }
    }, []);

    useEffect(() => {
        fetchMedicines();
        fetchSuppliers();
        fetchCategories();
    }, [fetchMedicines, fetchSuppliers, fetchCategories]);

    // ── helpers ────────────────────────────────────────────
    function showSnackbar(message, severity = 'success') {
        setSnackbar({ open: true, message, severity });
    }

    function resetForm() {
        setForm(emptyForm);
        setSelectedRow(null);
        setIsEditMode(false);
    }

    function handleChange(field) {
        return function (e) {
            setForm((prev) => ({ ...prev, [field]: e.target.value }));
        };
    }

    // ── search ─────────────────────────────────────────────
    async function handleSearch() {
        if (!searchQuery.trim()) {
            fetchMedicines();
            return;
        }

        try {
            setLoading(true);
            const res = await axiosInstance.get('/inventory/search', { params: { query: searchQuery } });
            const data = Array.isArray(res.data.medicines) ? res.data.medicines : [];
            const rows = data.map(convertRecordToRow);

            if (rows.length === 0) {
                showSnackbar('No medicines found matching your search', 'info');
            } else {
                showSnackbar(`Found ${rows.length} medicine(s)`, 'success');
            }
            setMedicines(rows);
        } catch (error) {
            console.error('Search failed:', error);
            showSnackbar('Error occurred while searching', 'error');
        } finally {
            setLoading(false);
        }
    }

    // ── row click → populate form ──────────────────────────
    function handleRowClick(params) {
        const row = params.row;
        setForm({
            medicineId: row.medicineId,
            name: row.name,
            category: row.category,
            purchasePrice: row.purchasePrice,
            unitPrice: row.unitPrice,
            stockQuantity: row.stockQuantity,
            rackNumber: row.rackNumber,
            expiryDate: dayjs(row.expiryDate),
            supplierId: row.supplierId || '',
        });
        setSelectedRow(row);
        setIsEditMode(true);
    }

    // ── dialog open helpers ────────────────────────────────
    function openInsertDialog() {
        if (!form.medicineId || !form.name || !form.category || !form.purchasePrice || !form.unitPrice || !form.stockQuantity || !form.rackNumber || !form.expiryDate || !form.supplierId) {
            showSnackbar('Please fill all fields', 'warning');
            return;
        }
        setDialog({
            open: true,
            type: 'insert',
            title: 'Confirm Insert',
            message: `Are you sure you want to add medicine "${form.name}" (ID: ${form.medicineId})?`,
        });
    }

    function openUpdateDialog() {
        if (!isEditMode) {
            showSnackbar('Select a record from the grid to update', 'warning');
            return;
        }
        const stockChange = Number(form.stockQuantity) - selectedRow.stockQuantity;
        if (stockChange !== 0 && !selectedRow.batchId) {
            showSnackbar('This medicine has no batch to change stock on; add stock as a new batch instead', 'warning');
            return;
        }
        if (selectedRow.batchQuantity + stockChange < 0) {
            showSnackbar(`Batch ${selectedRow.medicineId} only has ${selectedRow.batchQuantity} units; stock can drop by at most that much here`, 'warning');
            return;
        }
        setDialog({
            open: true,
            type: 'update',
            title: 'Confirm Update',
            message: `Are you sure you want to update medicine "${form.name}" (ID: ${form.medicineId})?`
                + (selectedRow.batchCount > 1
                    ? ` Batch changes apply to batch ${selectedRow.medicineId} only (1 of ${selectedRow.batchCount} batches).`
                    : ''),
        });
    }

    function openDeleteDialog() {
        if (!isEditMode) {
            showSnackbar('Select a record from the grid to delete', 'warning');
            return;
        }
        setDialog({
            open: true,
            type: 'delete',
            title: 'Confirm Delete',
            message: `Are you sure you want to delete medicine "${form.name}" (ID: ${form.medicineId})? This action cannot be undone.`,
        });
    }

    // ── dialog confirm handler ─────────────────────────────
    async function handleDialogConfirm() {
        const { type } = dialog;
        setDialog({ ...dialog, open: false });

        const standardized = {
            name: form.name,
            category: form.category,
            purchasePrice: Number(form.purchasePrice),
            sellingPrice: Number(form.unitPrice),
            quantity: Number(form.stockQuantity),
            supplier: form.supplierId,
            batches: [{
                batchNumber: form.medicineId,
                expiryDate: form.expiryDate ? dayjs(form.expiryDate).format('YYYY-MM-DD') : null,
                quantity: Number(form.stockQuantity),
                rackNumber: form.rackNumber
            }]
        };

        try {
            setLoading(true);
            if (type === 'insert') {
                await axiosInstance.post('/inventory', standardized);
                showSnackbar('Medicine added successfully');
            } else if (type === 'update') {
                // A stock change in the form lands on the batch this row shows; the total follows
                const stockChange = Number(form.stockQuantity) - selectedRow.stockQuantity;
                const { quantity, batches, ...medicineFields } = standardized;
                await axiosInstance.put(`/inventory/${selectedRow._id}`, {
                    ...medicineFields,
                    __v: selectedRow.version,
                    batches: selectedRow.batchId ? [{
                        _id: selectedRow.batchId,
                        batchNumber: batches[0].batchNumber,
                        expiryDate: batches[0].expiryDate,
                        rackNumber: batches[0].rackNumber,
                        quantity: selectedRow.batchQuantity + stockChange,
                    }] : [],
                });
                showSnackbar('Medicine updated successfully');
            } else if (type === 'delete') {
                await axiosInstance.delete(`/inventory/${selectedRow._id}`);
                showSnackbar('Medicine deleted successfully');
            }
            fetchMedicines();
            fetchCategories();
            resetForm();
        } catch (error) {
            console.error(`Operation ${type} failed:`, error);
            showSnackbar(error.response?.data?.message || `Failed to ${type} medicine`, 'error');
        } finally {
            setLoading(false);
        }
    }

    // ── DataGrid columns ──────────────────────────────────
    const columns = [
        { field: 'medicineId', headerName: 'Medicine ID', flex: 1, minWidth: 120 },
        { field: 'name', headerName: 'Name', flex: 1.3, minWidth: 140 },
        {
            field: 'category',
            headerName: 'Category',
            flex: 1,
            minWidth: 110,
            renderCell: (params) => (
                <Chip label={params.value} size="small" color="primary" variant="outlined" />
            ),
        },
        {
            field: 'unitPrice',
            headerName: 'Unit Price (₹)',
            flex: 0.8,
            minWidth: 110,
            type: 'number',
            renderCell: (params) => `₹${Number(params.value).toFixed(2)}`,
        },
        {
            field: 'stockQuantity',
            headerName: 'Stock Qty',
            flex: 0.7,
            minWidth: 90,
            type: 'number',
            renderCell: (params) => {
                const qty = params.value;
                const color = qty <= 10 ? '#ef4444' : qty <= 50 ? '#f59e0b' : '#22c55e';
                return (
                    <span style={{ fontWeight: 700, color }}>{qty}</span>
                );
            },
        },
        {
            field: 'expiryDate',
            headerName: 'Expiry Date',
            flex: 1,
            minWidth: 120,
            renderCell: (params) => dayjs(params.value).format('DD-MMM-YYYY'),
        },
        {
            field: 'supplierName',
            headerName: 'Supplier',
            flex: 1.1,
            minWidth: 130,
        },
    ];

    const rows = medicines.map((m) => {
        return {
            id: m._id,
            medicineId: m.medicineId,
            name: m.name,
            category: m.category,
            purchasePrice: m.purchasePrice,
            unitPrice: m.unitPrice,
            stockQuantity: m.stockQuantity,
            rackNumber: m.rackNumber,
            expiryDate: m.expiryDate,
            supplierName: m.supplierId,
            supplierId: m.supplierId,
            _id: m._id
        };
    });

    // ── render ─────────────────────────────────────────────
    return (
            <LocalizationProvider dateAdapter={AdapterDayjs}>
                <Box sx={{ pb: 4 }}>
                    {/* ── Header ────────────────────────────────── */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                        <FaPills size={28} color="#6366f1" />
                        <Typography variant="h4" sx={{ fontWeight: 800, color: '#1e293b' }}>
                            Medicine Inventory Management
                        </Typography>
                    </Box>

                    {/* ── Search Bar ────────────────────────────── */}
                    <Paper
                        elevation={2}
                        sx={{
                            p: 2,
                            mb: 3,
                            borderRadius: 3,
                            background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)',
                        }}
                    >
                        <Typography variant="subtitle2" sx={{ mb: 1, color: '#6366f1', fontWeight: 700 }}>
                            Search by Medicine ID
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <TextField
                                size="small"
                                fullWidth
                                placeholder="Enter Medicine ID to search..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSearch();
                                    }
                                }}
                                InputProps={{
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <FaSearch color="#94a3b8" />
                                        </InputAdornment>
                                    ),
                                    endAdornment: searchQuery && (
                                        <InputAdornment position="end">
                                            <IconButton
                                                size="small"
                                                onClick={() => {
                                                    setSearchQuery('');
                                                    fetchMedicines();
                                                }}
                                            >
                                                <FaTimes size={14} />
                                            </IconButton>
                                        </InputAdornment>
                                    ),
                                }}
                                sx={{ backgroundColor: '#fff', borderRadius: 2 }}
                            />
                            <Button
                                variant="contained"
                                onClick={handleSearch}
                                sx={{
                                    minWidth: 100,
                                    borderRadius: 2,
                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                    textTransform: 'none',
                                    fontWeight: 600,
                                }}
                            >
                                Search
                            </Button>
                        </Box>
                    </Paper>

                    {/* ── Form ──────────────────────────────────── */}
                    <Paper
                        elevation={3}
                        sx={{
                            p: 3,
                            mb: 3,
                            borderRadius: 3,
                            border: '1px solid #e2e8f0',
                        }}
                    >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                            <Typography variant="h6" sx={{ fontWeight: 700, color: '#334155' }}>
                                {isEditMode ? '✏️ Edit Medicine' : '➕ Add New Medicine'}
                            </Typography>
                            {isEditMode && (
                                <Button size="small" onClick={resetForm} sx={{ textTransform: 'none' }}>
                                    Clear / New
                                </Button>
                            )}
                        </Box>

                        <Divider sx={{ mb: 2.5 }} />

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                            {/* 1 — Medicine ID (Batch Num) */}
                            <div>
                                <TextField
                                    label="Batch No. (ID)"
                                    fullWidth
                                    size="small"
                                    required
                                    value={form.medicineId}
                                    onChange={handleChange('medicineId')}
                                    disabled={isEditMode}
                                />
                            </div>

                            {/* 2 — Medicine Name */}
                            <div>
                                <TextField
                                    label="Medicine Name"
                                    fullWidth
                                    size="small"
                                    required
                                    value={form.name}
                                    onChange={handleChange('name')}
                                />
                            </div>

                             {/* 3 — Category */}
                            <div>
                                <Autocomplete
                                    fullWidth
                                    freeSolo
                                    options={categories}
                                    value={form.category}
                                    onChange={(event, newValue) => {
                                        setForm((prev) => ({ ...prev, category: newValue || '' }));
                                    }}
                                    onInputChange={(event, newInputValue) => {
                                        setForm((prev) => ({ ...prev, category: newInputValue }));
                                    }}
                                    renderInput={(params) => (
                                        <TextField
                                            {...params}
                                            label="Category"
                                            size="small"
                                            required
                                            fullWidth
                                            placeholder="e.g., Tablet, Syrup"
                                        />
                                    )}
                                />
                            </div>

                            {/* Rack Number */}
                            <div>
                                <TextField
                                    label="Rack Number"
                                    fullWidth
                                    size="small"
                                    required
                                    value={form.rackNumber}
                                    onChange={handleChange('rackNumber')}
                                />
                            </div>

                            {/* Purchase Price */}
                            <div>
                                <TextField
                                    label="Purchase Price (₹)"
                                    fullWidth
                                    size="small"
                                    type="number"
                                    required
                                    value={form.purchasePrice}
                                    onChange={handleChange('purchasePrice')}
                                    InputProps={{
                                        startAdornment: <InputAdornment position="start">₹</InputAdornment>,
                                    }}
                                />
                            </div>

                            {/* Selling Price */}
                            <div>
                                <TextField
                                    label="Selling Price (₹)"
                                    fullWidth
                                    size="small"
                                    type="number"
                                    required
                                    value={form.unitPrice}
                                    onChange={handleChange('unitPrice')}
                                    InputProps={{
                                        startAdornment: <InputAdornment position="start">₹</InputAdornment>,
                                    }}
                                />
                            </div>

                            {/* 5 — Stock Quantity */}
                            <div>
                                <TextField
                                    label="Stock Quantity"
                                    fullWidth
                                    size="small"
                                    type="number"
                                    required
                                    value={form.stockQuantity}
                                    onChange={handleChange('stockQuantity')}
                                />
                            </div>

                            {/* 6 — Expiry Date */}
                            <div>
                                <DatePicker
                                    label="Expiry Date"
                                    value={form.expiryDate}
                                    onChange={(newVal) => setForm((prev) => ({ ...prev, expiryDate: newVal }))}
                                    slotProps={{
                                        textField: { size: 'small', fullWidth: true, required: true },
                                    }}
                                />
                            </div>

                            {/* 7 — Supplier String */}
                            <div>
                                <FormControl fullWidth size="small" required>
                                    <InputLabel>Supplier</InputLabel>
                                    <Select
                                        value={form.supplierId}
                                        label="Supplier"
                                        onChange={handleChange('supplierId')}
                                    >
                                        {suppliers.map((s) => (
                                            <MenuItem key={s.supplier_name} value={s.supplier_name}>
                                                {s.supplier_name}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </div>
                        </div>

                        {/* ── Action Buttons ──────────────────────── */}
                        <Box sx={{ display: 'flex', gap: 2, mt: 3, flexWrap: 'wrap' }}>
                            <Button
                                variant="contained"
                                startIcon={<FaPlus />}
                                onClick={openInsertDialog}
                                disabled={isEditMode}
                                sx={{
                                    borderRadius: 2,
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                                    '&:hover': { background: 'linear-gradient(135deg, #16a34a, #15803d)' },
                                }}
                            >
                                Insert
                            </Button>
                            <Button
                                variant="contained"
                                startIcon={<FaEdit />}
                                onClick={openUpdateDialog}
                                disabled={!isEditMode}
                                sx={{
                                    borderRadius: 2,
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                    '&:hover': { background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' },
                                }}
                            >
                                Update
                            </Button>
                            <Button
                                variant="contained"
                                startIcon={<FaTrashAlt />}
                                onClick={openDeleteDialog}
                                disabled={!isEditMode}
                                sx={{
                                    borderRadius: 2,
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                    '&:hover': { background: 'linear-gradient(135deg, #dc2626, #b91c1c)' },
                                }}
                            >
                                Delete
                            </Button>
                            <Button
                                variant="outlined"
                                onClick={resetForm}
                                sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
                            >
                                Clear
                            </Button>
                        </Box>
                    </Paper>

                    {/* ── Data Grid ─────────────────────────────── */}
                    <Paper elevation={3} sx={{ borderRadius: 3, overflow: 'hidden' }}>
                        <Box
                            sx={{
                                px: 3,
                                py: 2,
                                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                color: '#fff',
                            }}
                        >
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                📋 Inventory Records ({medicines.length})
                            </Typography>
                        </Box>
                        <Box sx={{ height: 480, width: '100%' }}>
                            <DataGrid
                                rows={rows}
                                columns={columns}
                                loading={loading}
                                pageSizeOptions={[5, 10, 25]}
                                initialState={{
                                    pagination: { paginationModel: { pageSize: 10 } },
                                }}
                                onRowClick={handleRowClick}
                                disableRowSelectionOnClick={false}
                                sx={{
                                    border: 'none',
                                    '& .MuiDataGrid-row': {
                                        cursor: 'pointer',
                                        '&:hover': { backgroundColor: '#eef2ff' },
                                    },
                                    '& .MuiDataGrid-columnHeaders': {
                                        backgroundColor: '#f8fafc',
                                        fontWeight: 700,
                                    },
                                }}
                            />
                        </Box>
                    </Paper>
                </Box>

                {/* ── Confirmation Dialog ─────────────────────── */}
                <Dialog
                    open={dialog.open}
                    onClose={() => setDialog({ ...dialog, open: false })}
                    PaperProps={{ sx: { borderRadius: 3, minWidth: 380 } }}
                >
                    <DialogTitle sx={{ fontWeight: 700 }}>{dialog.title}</DialogTitle>
                    <DialogContent>
                        <DialogContentText>{dialog.message}</DialogContentText>
                    </DialogContent>
                    <DialogActions sx={{ px: 3, pb: 2 }}>
                        <Button
                            onClick={() => setDialog({ ...dialog, open: false })}
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            onClick={handleDialogConfirm}
                            color={dialog.type === 'delete' ? 'error' : 'primary'}
                            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
                        >
                            OK
                        </Button>
                    </DialogActions>
                </Dialog>

                {/* ── Snackbar ────────────────────────────────── */}
                <Snackbar
                    open={snackbar.open}
                    autoHideDuration={4000}
                    onClose={() => setSnackbar({ ...snackbar, open: false })}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                >
                    <Alert
                        onClose={() => setSnackbar({ ...snackbar, open: false })}
                        severity={snackbar.severity}
                        variant="filled"
                        sx={{ width: '100%', borderRadius: 2 }}
                    >
                        {snackbar.message}
                    </Alert>
                </Snackbar>
            </LocalizationProvider>
    );
};

export default MedicineInventory;
