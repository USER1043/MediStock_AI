/**
 * @file Forecast and reorder review page displaying AI predictions and approval controls.
 * @module pages/ai/ForecastReview
 */
import { useState, useEffect, useCallback } from "react";
import axiosInstance from "../../utils/axiosConfig";
import dayjs from "dayjs";
import {
  FaBrain,
  FaSearch,
  FaCheck,
  FaEdit,
  FaTrash,
  FaTimes,
  FaPlus,
  FaSync,
} from "react-icons/fa";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
} from "@mui/material";
import { toast } from "react-hot-toast";
import { useAuth } from "../../context/AuthContext";

// Renders AI Forecast and Reorder recommendations review panel.
export default function ForecastReview() {
  // Staff review and adjust drafts; approving and rejecting are the owner's call (the server enforces this too).
  const { hasRole } = useAuth();
  const isOwner = hasRole("owner");
  const [recommendations, setRecommendations] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ priority: "", status: "new" });
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Dialog states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState("add"); // add, edit
  const [formData, setFormData] = useState({
    medicineId: "",
    medicineName: "",
    optimalReorderQty: 0,
    priority: "medium",
    restockingDate: dayjs().add(7, "day").format("YYYY-MM-DD"),
  });
  const [medicines, setMedicines] = useState([]);

  // Fetches forecast recommendations and trend comparison data from backend.
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [recRes, trendRes] = await Promise.all([
        axiosInstance.get("/forecast/recommendations"),
        axiosInstance.get("/forecast/trend"),
      ]);
      setRecommendations(recRes.data?.recommendations || []);
      setTrendData(trendRes.data?.trend || []);
    } catch (error) {
      toast.error("Failed to fetch forecast data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchMedicines();
  }, [fetchData]);

  // Fetches medicine catalog for manual reorder selection.
  const fetchMedicines = async () => {
    try {
      const { data } = await axiosInstance.get("/inventory");
      setMedicines(data.medicines || []);
    } catch (error) {
      console.error("Error fetching medicines", error);
    }
  };

  // Approves or rejects a recommendation (owner only).
  const handleStatusUpdate = async (id, status) => {
    try {
      await axiosInstance.put(`/forecast/recommendations/${id}`, { status });
      toast.success(`Recommendation ${status}`);
      fetchData();
    } catch (error) {
      toast.error("Failed to update recommendation");
    }
  };

  // Deletes an AI draft recommendation.
  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this recommendation?"))
      return;
    try {
      await axiosInstance.delete(`/forecast/recommendations/${id}`);
      toast.success("Recommendation deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete recommendation");
    }
  };

  // Submits manual recommendation create or edit dialog.
  const handleModalSubmit = async () => {
    try {
      if (modalType === "add") {
        const med = medicines.find((m) => m._id === formData.medicineId);
        await axiosInstance.post("/forecast/recommendations", {
          ...formData,
          medicineName: med ? med.name : formData.medicineName,
        });
        toast.success("Manual recommendation added");
      } else {
        await axiosInstance.put(
          `/forecast/recommendations/${formData._id}`,
          {
            quantity: formData.optimalReorderQty,
            priority: formData.priority,
            restockingDate: formData.restockingDate,
          },
        );
        toast.success("Recommendation adjusted");
      }
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      toast.error("Action failed");
    }
  };

  // Opens modal pre-populated for editing recommendation.
  const openEditModal = (rec) => {
    setModalType("edit");
    setFormData({
      ...rec,
      priority: (rec.priority || "medium").toLowerCase(),
      restockingDate: dayjs(rec.restockingDate).format("YYYY-MM-DD"),
    });
    setIsModalOpen(true);
  };

  // Maps priority level to MUI Chip color palette.
  const getPriorityColor = (p) => {
    switch (p?.toLowerCase()) {
      case "critical":
        return "error";
      case "high":
        return "warning";
      case "medium":
        return "primary";
      default:
        return "default";
    }
  };

  // Filter recommendations based on search term, priority, and status
  const filteredRecommendations = recommendations.filter((rec) => {
    const matchesSearch =
      !search ||
      rec.medicineName?.toLowerCase().includes(search.toLowerCase()) ||
      rec.category?.toLowerCase().includes(search.toLowerCase());

    const matchesPriority =
      !filters.priority ||
      rec.priority?.toLowerCase() === filters.priority.toLowerCase();

    const matchesStatus =
      !filters.status ||
      rec.status?.toLowerCase() === filters.status.toLowerCase();

    return matchesSearch && matchesPriority && matchesStatus;
  });

  return (
    <Box sx={{ mb: 4 }}>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <FaBrain size={30} color="#6366f1" />
          <Typography variant="h4" fontWeight={800}>
            Forecast & Reorder Review
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<FaPlus />}
            onClick={() => {
              setModalType("add");
              setFormData({
                medicineId: "",
                optimalReorderQty: 0,
                priority: "medium",
                restockingDate: dayjs().add(7, "day").format("YYYY-MM-DD"),
              });
              setIsModalOpen(true);
            }}
          >
            Add Manual Override
          </Button>
          <Button
            variant="contained"
            startIcon={<FaSync />}
            onClick={fetchData}
            sx={{ backgroundColor: "#6366f1", "&:hover": { backgroundColor: "#4f46e5" } }}
          >
            Refresh Data
          </Button>
        </Box>
      </Box>

      {/* Trend Chart */}
      <Paper sx={{ p: 3, mb: 4, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
          Predicted vs Actual Demand (Last 14 Days)
        </Typography>
        <Box sx={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="predicted" name="Predicted Units" fill="#a78bfa" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name="Actual Units" fill="#34d399" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Paper>

      {/* Recommendations & Horizontal Filters Container */}
      <Paper sx={{ p: 3, borderRadius: 3 }}>
        {/* Horizontal Filters Bar */}
        <Box
          sx={{
            display: "flex",
            gap: 2,
            mb: 3,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box sx={{ display: "flex", gap: 2, flex: 1, minWidth: 280, flexWrap: "wrap" }}>
            <TextField
              size="small"
              placeholder="Search medicine name or category..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              InputProps={{
                startAdornment: <FaSearch style={{ marginRight: 8, color: "#94a3b8" }} />,
              }}
              sx={{ minWidth: 240, flex: 1 }}
            />
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Priority</InputLabel>
              <Select
                value={filters.priority}
                label="Priority"
                onChange={(e) => {
                  setFilters({ ...filters, priority: e.target.value });
                  setPage(0);
                }}
              >
                <MenuItem value="">All Priorities</MenuItem>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="low">Low</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={filters.status}
                label="Status"
                onChange={(e) => {
                  setFilters({ ...filters, status: e.target.value });
                  setPage(0);
                }}
              >
                <MenuItem value="">All Statuses</MenuItem>
                <MenuItem value="new">New</MenuItem>
                <MenuItem value="approved">Approved</MenuItem>
                <MenuItem value="adjusted">Adjusted</MenuItem>
                <MenuItem value="rejected">Rejected</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Box>

        {/* Recommendations Table */}
        <TableContainer>
          <Table>
            <TableHead sx={{ backgroundColor: "#f8fafc" }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Medicine</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Current Stock</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>AI Suggested Qty</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Est. Cost</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Priority</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    Loading forecast review data...
                  </TableCell>
                </TableRow>
              ) : filteredRecommendations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    No recommendations matching your filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRecommendations
                  .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                  .map((row) => {
                    const price = row.medicineId?.purchasePrice || row.purchasePrice || 15;
                    const estCost = (row.optimalReorderQty || 0) * price;

                    return (
                      <TableRow key={row._id} hover>
                        <TableCell sx={{ fontWeight: 600 }}>
                          {row.medicineName || row.medicineId?.name || "Manual Item"}
                          <Typography variant="caption" color="text.secondary" display="block">
                            {row.category || row.medicineId?.category || "General"}
                          </Typography>
                        </TableCell>
                        <TableCell>{row.currentStock ?? row.medicineId?.quantity ?? 0}</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: "#6366f1" }}>
                          {row.optimalReorderQty}
                        </TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>
                          ₹{estCost.toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={(row.priority || "medium").toUpperCase()}
                            color={getPriorityColor(row.priority)}
                            size="small"
                            sx={{ fontWeight: 700, fontSize: 10 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={row.status.toUpperCase()}
                            variant="outlined"
                            color={
                              row.status === "approved"
                                ? "success"
                                : row.status === "rejected"
                                  ? "error"
                                  : row.status === "adjusted"
                                    ? "secondary"
                                    : "warning"
                            }
                            size="small"
                            sx={{ fontWeight: 700, fontSize: 10 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {/* Only drafts under review can be changed; approved and rejected rows are history */}
                          {row.status === "new" || row.status === "adjusted" ? (
                            <>
                              {isOwner && (
                                <IconButton
                                  color="success"
                                  onClick={() =>
                                    handleStatusUpdate(row._id, "approved")
                                  }
                                  title="Approve Recommendation"
                                >
                                  <FaCheck />
                                </IconButton>
                              )}
                              <IconButton
                                color="primary"
                                onClick={() => openEditModal(row)}
                                title="Edit / Adjust Quantity & Priority"
                              >
                                <FaEdit />
                              </IconButton>
                              {isOwner && (
                                <>
                                  <IconButton
                                    color="warning"
                                    onClick={() =>
                                      handleStatusUpdate(row._id, "rejected")
                                    }
                                    title="Reject Recommendation"
                                  >
                                    <FaTimes />
                                  </IconButton>
                                  <IconButton
                                    color="error"
                                    onClick={() => handleDelete(row._id)}
                                    title="Delete Draft"
                                  >
                                    <FaTrash />
                                  </IconButton>
                                </>
                              )}
                            </>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              {row.status === "approved" ? "Sent to purchase orders" : "Closed"}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={filteredRecommendations.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(e, newPage) => setPage(newPage)}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
        />
      </Paper>

      {/* Manual Entry / Edit Modal */}
      <Dialog open={isModalOpen} onClose={() => setIsModalOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 700 }}>
          {modalType === "add"
            ? "Add Manual Recommendation"
            : "Adjust AI Recommendation"}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Grid container spacing={3} sx={{ mt: 0.5 }}>
            {modalType === "add" && (
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Select Medicine</InputLabel>
                  <Select
                    value={formData.medicineId}
                    label="Select Medicine"
                    onChange={(e) =>
                      setFormData((f) => ({ ...f, medicineId: e.target.value }))
                    }
                  >
                    {medicines.map((m) => (
                      <MenuItem key={m._id} value={m._id}>
                        {m.name} (Stock: {m.quantity})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid item xs={12} sm={6}>
              <TextField
                label="Suggested Quantity"
                type="number"
                fullWidth
                value={formData.optimalReorderQty}
                inputProps={{ min: 1, step: 1 }}
                error={!(formData.optimalReorderQty >= 1)}
                helperText={
                  formData.optimalReorderQty >= 1 ? " " : "Enter a quantity of at least 1"
                }
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    optimalReorderQty: parseInt(e.target.value, 10) || 0,
                  }))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Priority</InputLabel>
                <Select
                  value={(formData.priority || "medium").toLowerCase()}
                  label="Priority"
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, priority: e.target.value }))
                  }
                >
                  <MenuItem value="low">Low</MenuItem>
                  <MenuItem value="medium">Medium</MenuItem>
                  <MenuItem value="high">High</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Restocking Date"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={formData.restockingDate}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, restockingDate: e.target.value }))
                }
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setIsModalOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleModalSubmit}
            disabled={!(formData.optimalReorderQty >= 1)}
          >
            {modalType === "add" ? "Create" : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

