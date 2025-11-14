"use client";

import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import Badge from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMemo, useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import toast from "react-hot-toast";
import { supabase } from "@/components/supabase";
import { Loader2, AlertCircle, Edit, Trash2, X } from "lucide-react";
import { useUser } from "@/components/UserContext";
import { useData } from "@/components/DataContext";

// Accurate date formatter - shows local time without timezone shifts
const formatHistoryDate = (dateString: string): string => {
	try {
		const date = new Date(dateString);
		if (isNaN(date.getTime())) return 'Invalid Date';
		
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const month = monthNames[date.getMonth()];
		const day = date.getDate();
		const year = date.getFullYear();
		
		let hours = date.getHours();
		const minutes = date.getMinutes();
		const ampm = hours >= 12 ? 'PM' : 'AM';
		hours = hours % 12;
		hours = hours ? hours : 12; // 0 should be 12
		const minutesStr = minutes < 10 ? `0${minutes}` : minutes;
		
		return `${month} ${day}, ${year} - ${hours}:${minutesStr} ${ampm}`;
	} catch {
		return 'Invalid Date';
	}
};

export default function HistoryPage() {
	const [dateRangeType, setDateRangeType] = useState<'daily' | 'weekly' | 'monthly' | 'custom' | 'none'>('none');
	const [startDate, setStartDate] = useState<string>("");
	const [endDate, setEndDate] = useState<string>("");
	const [showAll, setShowAll] = useState(false);
	const [detailIdx, setDetailIdx] = useState<number | null>(null);
	const [editIdx, setEditIdx] = useState<number | null>(null);
	const [deleteIdx, setDeleteIdx] = useState<number | null>(null);
	const [editForm, setEditForm] = useState({ expert_validation: "", status: "" });
	const [editLoading, setEditLoading] = useState(false);
	const { user } = useUser();
	const { scans, validationHistory, loading, error, refreshData } = useData();

	// Helper function to get date range based on type
	const getDateRange = useCallback((type: typeof dateRangeType) => {
		if (type === 'none') return { start: null, end: null };
		
		const now = new Date();
		now.setHours(23, 59, 59, 999);
		
		if (type === 'daily') {
			const start = new Date(now);
			start.setHours(0, 0, 0, 0);
			return { start, end: now };
		}
		
		if (type === 'weekly') {
			const start = new Date(now);
			const dayOfWeek = start.getDay();
			start.setDate(start.getDate() - dayOfWeek);
			start.setHours(0, 0, 0, 0);
			return { start, end: now };
		}
		
		if (type === 'monthly') {
			const start = new Date(now.getFullYear(), now.getMonth(), 1);
			start.setHours(0, 0, 0, 0);
			return { start, end: now };
		}
		
		// Custom range
		if (startDate && endDate) {
			const start = new Date(startDate);
			start.setHours(0, 0, 0, 0);
			const end = new Date(endDate);
			end.setHours(23, 59, 59, 999);
			return { start, end };
		}
		
		return { start: null, end: null };
	}, [startDate, endDate]);

	// Filter validation history based on date range
	const filtered = useMemo(() => {
		if (dateRangeType === 'none') {
			return validationHistory;
		}
		
		const { start, end } = getDateRange(dateRangeType);
		if (!start || !end) {
			return validationHistory;
		}
		
		return validationHistory.filter(record => {
			const recordDate = new Date(record.validated_at);
			return recordDate >= start && recordDate <= end;
		});
	}, [validationHistory, dateRangeType, getDateRange]);

	// Memoized helper functions to prevent recreation on every render
	const formatScanType = useCallback((type: string) => {
		return type === 'leaf_disease' ? 'Leaf Disease' : 'Fruit Maturity';
	}, []);

	// Memoized date formatter - uses accurate local time
	const formatDate = useCallback((dateString: string) => {
		return formatHistoryDate(dateString);
	}, []);

	// Reset showAll when filter changes
	useEffect(() => {
		setShowAll(false);
	}, [dateRangeType, startDate, endDate]);

	// Paginated records - show 5 by default, all when "See More" is clicked
	const displayedRecords = useMemo(() => {
		if (showAll) {
			return filtered;
		}
		return filtered.slice(0, 5);
	}, [filtered, showAll]);

	const hasMoreRecords = useMemo(() => {
		return filtered.length > 5;
	}, [filtered]);

	// CSV escaping function to handle commas, quotes, and newlines
	const escapeCSV = useCallback((value: string | number | null | undefined): string => {
		if (value === null || value === undefined) return '';
		const str = String(value);
		// If value contains comma, quote, or newline, wrap in quotes and escape quotes
		if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
			return `"${str.replace(/"/g, '""')}"`;
		}
		return str;
	}, []);

	const getStatusColor = useCallback((status: string) => {
		switch (status) {
			case 'Pending Validation':
				return 'amber';
			case 'Validated':
				return 'green';
			case 'Corrected':
				return 'blue';
			default:
				return 'gray';
		}
	}, []);

	// Handle edit validation record
	const handleEdit = useCallback(async () => {
		if (editIdx === null) return;
		const record = filtered[editIdx];
		if (!record || !user) return;

		// Check if user is the expert who created this validation
		if (record.expert_id !== user.id) {
			toast.error("You can only edit your own validations.");
			return;
		}

		setEditLoading(true);
		try {
			const { error: updateError } = await supabase
				.from('validation_history')
				.update({
					expert_validation: editForm.expert_validation,
					status: editForm.status as 'Validated' | 'Corrected'
				})
				.eq('id', record.id);

			if (updateError) throw updateError;

			// Also update the associated scan if it exists
			if (record.scan_id) {
				await supabase
					.from('scans')
					.update({
						status: editForm.status,
						expert_comment: editForm.expert_validation,
						updated_at: new Date().toISOString()
					})
					.eq('id', record.scan_id);
			}

			toast.success("Validation record updated successfully");
			setEditIdx(null);
			setEditForm({ expert_validation: "", status: "" });
			await refreshData();
		} catch (err: unknown) {
			console.error('Error updating validation:', err);
			toast.error('Failed to update validation record');
		} finally {
			setEditLoading(false);
		}
	}, [editIdx, filtered, user, editForm, refreshData]);

	// Handle delete validation record
	const handleDelete = useCallback(async () => {
		if (deleteIdx === null) return;
		const record = filtered[deleteIdx];
		if (!record || !user) return;

		// Check if user is the expert who created this validation
		if (record.expert_id !== user.id) {
			toast.error("You can only delete your own validations.");
			setDeleteIdx(null);
			return;
		}

		setEditLoading(true);
		try {
			const { error: deleteError } = await supabase
				.from('validation_history')
				.delete()
				.eq('id', record.id);

			if (deleteError) throw deleteError;

			// Optionally revert scan status to pending if it was validated
			if (record.scan_id && (record.status === 'Validated' || record.status === 'Corrected')) {
				await supabase
					.from('scans')
					.update({
						status: 'Pending Validation',
						expert_comment: null,
						updated_at: new Date().toISOString()
					})
					.eq('id', record.scan_id);
			}

			toast.success("Validation record deleted successfully");
			setDeleteIdx(null);
			await refreshData();
		} catch (err: unknown) {
			console.error('Error deleting validation:', err);
			toast.error('Failed to delete validation record');
		} finally {
			setEditLoading(false);
		}
	}, [deleteIdx, filtered, user, refreshData]);

	// Open edit dialog
	const openEditDialog = useCallback((idx: number) => {
		const record = filtered[idx];
		if (record) {
			setEditIdx(idx);
			setEditForm({
				expert_validation: record.expert_validation || "",
				status: record.status
			});
		}
	}, [filtered]);

	// Calculate statistics from real data
	// Total Records: Total number of scans in the database
	const totalRecords = scans.length;
	
	// Avg Confidence: Average confidence of all scans (rounded to 2 decimal places)
	const avgConfidence = useMemo(() => {
		const confidences = scans
			.map(scan => scan.confidence)
			.filter((conf): conf is number | string => conf !== null && conf !== undefined)
			.map(conf => typeof conf === 'number' ? conf : parseFloat(String(conf)))
			.filter(conf => !isNaN(conf));
		
		if (confidences.length === 0) return '0.00';
		const sum = confidences.reduce((acc, val) => acc + val, 0);
		const average = sum / confidences.length;
		// Return value rounded to exactly 2 decimal places
		return average.toFixed(2);
	}, [scans]);
	
	// Validation Rate: Percentage of scans that have been validated
	// Formula: (Number of Validated Scans / Total Records) × 100
	const validatedScans = scans.filter(scan => scan.status === 'Validated').length;
	const validationRate = totalRecords > 0 ? (((validatedScans / totalRecords) * 100).toFixed(1)) : '0.0';
	
	// Expert Corrections: Number of scans that were corrected by experts
	const correctedRecords = scans.filter(scan => scan.status === 'Corrected').length;

	return (
		<AuthGuard>
			<AppShell>
				<div className="space-y-6">
					<div className="no-print">
						<h2 className="text-2xl font-semibold text-gray-900">History</h2>
					</div>
					<div className="print-only" style={{ display: 'none' }}>
						<h1 className="text-2xl font-bold mb-2">Validation History Report</h1>
						<p className="text-sm text-gray-600 mb-4">
							Generated on {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
							{dateRangeType !== 'none' && (
								<span>
									{dateRangeType === 'custom' && startDate && endDate
										? ` • Filtered: ${startDate} to ${endDate}`
										: ` • Filtered: ${dateRangeType.charAt(0).toUpperCase() + dateRangeType.slice(1)}`
									}
								</span>
							)}
						</p>
					</div>

					{/* Stats */}
					<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
						<Card className="shadow-sm hover:shadow-md transition-shadow">
							<CardHeader className="pb-2">
								<CardTitle>Total Records</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-3xl font-semibold">{totalRecords.toLocaleString("en-US")}</p>
							</CardContent>
						</Card>
						<Card className="shadow-sm hover:shadow-md transition-shadow">
							<CardHeader className="pb-2">
								<CardTitle>Avg Confidence</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-3xl font-semibold">{avgConfidence}%</p>
							</CardContent>
						</Card>
						<Card className="shadow-sm hover:shadow-md transition-shadow">
							<CardHeader className="pb-2">
								<CardTitle>Validation Rate</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-3xl font-semibold">{validationRate}%</p>
							</CardContent>
						</Card>
						<Card className="shadow-sm hover:shadow-md transition-shadow">
							<CardHeader className="pb-2">
								<CardTitle>Expert Corrections</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-3xl font-semibold">{correctedRecords.toLocaleString("en-US")}</p>
							</CardContent>
						</Card>
					</div>

					{/* Date Range Filter */}
					<div className="flex flex-wrap items-center gap-3 no-print">
						<label className="text-sm font-medium text-gray-700 whitespace-nowrap">
							Filter by Date:
						</label>
						<div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
							<button 
								className={`px-4 py-2 text-xs font-medium transition-all ${
									dateRangeType === 'daily' 
										? 'bg-[var(--primary)] text-white' 
										: 'text-gray-700 hover:bg-gray-50'
								}`}
								onClick={() => {
									setDateRangeType('daily');
									setStartDate("");
									setEndDate("");
								}}
							>
								Daily
							</button>
							<button 
								className={`px-4 py-2 text-xs font-medium transition-all ${
									dateRangeType === 'weekly' 
										? 'bg-[var(--primary)] text-white' 
										: 'text-gray-700 hover:bg-gray-50'
								}`}
								onClick={() => {
									setDateRangeType('weekly');
									setStartDate("");
									setEndDate("");
								}}
							>
								Weekly
							</button>
							<button 
								className={`px-4 py-2 text-xs font-medium transition-all ${
									dateRangeType === 'monthly' 
										? 'bg-[var(--primary)] text-white' 
										: 'text-gray-700 hover:bg-gray-50'
								}`}
								onClick={() => {
									setDateRangeType('monthly');
									setStartDate("");
									setEndDate("");
								}}
							>
								Monthly
							</button>
							<button 
								className={`px-4 py-2 text-xs font-medium transition-all ${
									dateRangeType === 'custom' 
										? 'bg-[var(--primary)] text-white' 
										: 'text-gray-700 hover:bg-gray-50'
								}`}
								onClick={() => {
									setDateRangeType('custom');
									if (!startDate || !endDate) {
										const today = new Date().toISOString().split('T')[0];
										const weekAgo = new Date();
										weekAgo.setDate(weekAgo.getDate() - 7);
										setStartDate(weekAgo.toISOString().split('T')[0]);
										setEndDate(today);
									}
								}}
							>
								Custom
							</button>
						</div>
						{dateRangeType === 'custom' && (
							<div className="flex items-center gap-2">
								<input 
									type="date" 
									value={startDate}
									onChange={(e) => setStartDate(e.target.value)}
									max={endDate || undefined}
									className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
								/>
								<span className="text-sm text-gray-600">to</span>
								<input 
									type="date" 
									value={endDate}
									onChange={(e) => setEndDate(e.target.value)}
									min={startDate || undefined}
									max={new Date().toISOString().split('T')[0]}
									className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
								/>
							</div>
						)}
						{dateRangeType !== 'none' && (
							<Button 
								variant="ghost" 
								size="sm"
								onClick={() => {
									setDateRangeType('none');
									setStartDate("");
									setEndDate("");
								}}
								className="text-gray-600 hover:text-gray-900"
							>
								Clear
							</Button>
						)}
					</div>

					<Card className="shadow-sm print-table-container">
						<CardHeader className="pb-4 flex items-center justify-between border-b">
							<CardTitle className="text-lg font-semibold text-gray-900">Validation Records</CardTitle>
							<div className="flex gap-2 no-print">
								<Button 
									variant="outline" 
									size="sm"
									onClick={() => {
										try {
											// CSV Headers matching table columns
											const headers = [
												'Farmer Name',
												'Farmer Email',
												'Expert Name',
												'Scan Type',
												'AI Prediction',
												'Expert Validation',
												'Status',
												'Validated At'
											];

											// Build CSV rows with proper escaping (use all filtered records, not just displayed)
											const rows = filtered.map(record => {
												const farmerName = record.scan?.farmer_profile?.full_name || record.scan?.farmer_profile?.username || 'Unknown';
												const farmerEmail = record.scan?.farmer_profile?.email || record.scan?.farmer_id || 'N/A';
												const expertName = record.expert_profile?.full_name || record.expert_profile?.username || 'Unknown Expert';
												const scanType = record.scan ? formatScanType(record.scan.scan_type) : 'N/A';
												const aiPrediction = record.ai_prediction || 'N/A';
												const expertValidation = record.expert_validation || 'N/A';
												const status = record.status || 'N/A';
												const validatedAt = formatDate(record.validated_at);

												return [
													escapeCSV(farmerName),
													escapeCSV(farmerEmail),
													escapeCSV(expertName),
													escapeCSV(scanType),
													escapeCSV(aiPrediction),
													escapeCSV(expertValidation),
													escapeCSV(status),
													escapeCSV(validatedAt)
												].join(',');
											});

											// Combine headers and rows
											const csvContent = [headers.join(','), ...rows].join('\n');
											
											// Add BOM for UTF-8 to ensure proper Excel compatibility
											const BOM = '\uFEFF';
											const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
											const url = URL.createObjectURL(blob);
											const a = document.createElement('a');
											a.href = url;
											a.download = `validation-history-${new Date().toISOString().split('T')[0]}.csv`;
											document.body.appendChild(a);
											a.click();
											document.body.removeChild(a);
											URL.revokeObjectURL(url);
											toast.success(`CSV exported (${filtered.length} records)`);
										} catch (error: unknown) {
											console.error('Error exporting CSV:', error);
											toast.error('Failed to export CSV');
										}
									}}
								>
									Export CSV
								</Button>
								<Button 
									size="sm"
									onClick={() => {
										// Add print-specific class to body
										document.body.classList.add('printing');
										window.print();
										// Remove class after print dialog closes
										setTimeout(() => {
											document.body.classList.remove('printing');
										}, 1000);
									}}
								>
									Export PDF
								</Button>
							</div>
						</CardHeader>
						<CardContent>
							{error ? (
								<div className="flex items-center justify-center py-8">
									<div className="text-center">
										<AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
										<p className="text-red-600 font-medium">{error}</p>
										<Button 
											variant="outline" 
											onClick={() => refreshData(true)}
											className="mt-4"
										>
										Try Again
										</Button>
									</div>
								</div>
							) : loading ? (
								<div className="flex items-center justify-center py-8">
									<div className="text-center">
										<Loader2 className="h-8 w-8 animate-spin text-gray-500 mx-auto mb-4" />
										<p className="text-gray-600">Loading scans...</p>
									</div>
								</div>
							) : filtered.length === 0 ? (
								<div className="flex items-center justify-center py-8">
									<div className="text-center">
										<p className="text-gray-500 font-medium">No scans found.</p>
										<p className="text-gray-400 text-sm mt-1">Try adjusting your search criteria.</p>
									</div>
								</div>
							) : (
								<>
									<div className="overflow-x-auto print-table-wrapper">
										<Table className="w-full print-table">
											<Thead>
												<Tr>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Farmer</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Expert</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Scan Type</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">AI Prediction</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Expert Validation</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Status</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Validated At</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700 no-print">Actions</Th>
												</Tr>
											</Thead>
											<Tbody>
												{displayedRecords.map((record, idx) => {
													// Find the original index in filtered array for edit/delete operations
													const originalIdx = filtered.findIndex(r => r.id === record.id);
													return (
												<Tr 
													key={record.id}
													className="hover:bg-gray-50 cursor-pointer transition-colors"
													onClick={() => {
														if (originalIdx >= 0) {
															setDetailIdx(originalIdx);
														}
													}}
												>
													<Td className="whitespace-nowrap py-4 px-4">
														<div className="flex items-center gap-2">
															{record.scan?.farmer_profile?.profile_picture ? (
																<img 
																	src={record.scan.farmer_profile.profile_picture} 
																	alt="Profile" 
																	className="w-8 h-8 rounded-full object-cover"
																	onError={(e) => {
																		e.currentTarget.style.display = 'none';
																	}}
																/>
															) : (
																<div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
																	{record.scan?.farmer_profile?.full_name?.charAt(0) || record.scan?.farmer_profile?.username?.charAt(0) || '?'}
																</div>
															)}
															<div className="font-medium text-sm text-gray-900">
																{record.scan?.farmer_profile?.full_name || record.scan?.farmer_profile?.username || 'Unknown Farmer'}
															</div>
														</div>
													</Td>
													<Td className="whitespace-nowrap py-4 px-4">
														<div className="font-medium text-sm text-gray-900">
															{record.expert_profile?.full_name || record.expert_profile?.username || 'Unknown Expert'}
														</div>
													</Td>
													<Td className="py-4 px-4 text-sm text-gray-700">{record.scan ? formatScanType(record.scan.scan_type) : 'N/A'}</Td>
													<Td className="py-4 px-4 max-w-xs truncate text-sm text-gray-700">{record.ai_prediction}</Td>
													<Td className="py-4 px-4 max-w-xs truncate text-sm text-gray-700">{record.expert_validation || 'N/A'}</Td>
													<Td className="py-4 px-4">
														<Badge color={getStatusColor(record.status)}>{record.status}</Badge>
													</Td>
													<Td className="whitespace-nowrap py-4 px-4 text-sm text-gray-700">{formatDate(record.validated_at)}</Td>
													<Td className="py-4 px-4 no-print" onClick={(e) => e.stopPropagation()}>
														<div className="flex items-center gap-2">
															<Button 
																variant="outline" 
																size="sm" 
																onClick={(e) => {
																	e.stopPropagation();
																	if (originalIdx >= 0) {
																		setDetailIdx(originalIdx);
																	}
																}}
																className="text-xs"
															>
																View Details
															</Button>
															{user && record.expert_id === user.id && (
																<>
																	<Button 
																		variant="outline" 
																		size="sm" 
																		onClick={(e) => {
																			e.stopPropagation();
																			if (originalIdx >= 0) {
																				openEditDialog(originalIdx);
																			}
																		}}
																		className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
																		title="Edit"
																	>
																		<Edit className="h-4 w-4" />
																	</Button>
																	<Button 
																		variant="outline" 
																		size="sm" 
																		onClick={(e) => {
																			e.stopPropagation();
																			if (originalIdx >= 0) {
																				setDeleteIdx(originalIdx);
																			}
																		}}
																		className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
																		title="Delete"
																	>
																		<Trash2 className="h-4 w-4" />
																	</Button>
																</>
															)}
														</div>
													</Td>
												</Tr>
													);
												})}
											</Tbody>
										</Table>
									</div>
									{/* See More Button */}
									{hasMoreRecords && !showAll && (
										<div className="flex justify-center mt-4 no-print">
											<Button
												variant="outline"
												onClick={() => setShowAll(true)}
												className="text-black border-gray-300 bg-white shadow-sm"
											>
												See More ({filtered.length - 5} more records)
											</Button>
										</div>
									)}
									{showAll && hasMoreRecords && (
										<div className="flex justify-center mt-4 no-print">
											<Button
												variant="outline"
												onClick={() => {
													setShowAll(false);
													// Scroll to top of table smoothly
													window.scrollTo({ top: 0, behavior: 'smooth' });
												}}
												className="text-black border-gray-300 bg-white shadow-sm"
											>
												Show Less
											</Button>
										</div>
									)}
								</>
							)}
						</CardContent>
					</Card>

					{/* Edit Dialog */}
					<Dialog open={editIdx !== null} onOpenChange={() => {
						setEditIdx(null);
						setEditForm({ expert_validation: "", status: "" });
					}}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Edit Validation Record</DialogTitle>
							</DialogHeader>
							{editIdx !== null && filtered[editIdx] && (
								<div className="space-y-4 py-4">
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-2">Expert Validation</label>
										<textarea
											value={editForm.expert_validation}
											onChange={(e) => setEditForm({ ...editForm, expert_validation: e.target.value })}
											placeholder="Enter validation result..."
											className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
											rows={3}
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
										<select
											value={editForm.status}
											onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
											className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
										>
											<option value="Validated">Validated</option>
											<option value="Corrected">Corrected</option>
										</select>
									</div>
								</div>
							)}
							<DialogFooter>
								<Button variant="outline" onClick={() => {
									setEditIdx(null);
									setEditForm({ expert_validation: "", status: "" });
								}} disabled={editLoading}>
									Cancel
								</Button>
								<Button onClick={handleEdit} disabled={editLoading}>
									{editLoading ? "Updating..." : "Update"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>

					{/* Delete Confirmation Dialog */}
					<Dialog open={deleteIdx !== null} onOpenChange={() => setDeleteIdx(null)}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Delete Validation Record</DialogTitle>
							</DialogHeader>
							<div className="py-4">
								<p className="text-gray-600">
									Are you sure you want to delete this validation record? This action cannot be undone.
									{deleteIdx !== null && filtered[deleteIdx]?.scan_id && (
										<span className="block mt-2 text-sm text-amber-600">
											The associated scan will be reverted to &quot;Pending Validation&quot; status.
										</span>
									)}
								</p>
							</div>
							<DialogFooter>
								<Button variant="outline" onClick={() => setDeleteIdx(null)} disabled={editLoading}>
									Cancel
								</Button>
								<Button 
									onClick={handleDelete} 
									disabled={editLoading}
									className="bg-red-600 hover:bg-red-700"
								>
									{editLoading ? "Deleting..." : "Delete"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>

					<Dialog open={detailIdx !== null} onOpenChange={()=>setDetailIdx(null)}>
						<DialogContent className="sm:max-w-2xl p-0 overflow-hidden bg-white">
							<div className="flex flex-col max-h-[85vh]">
								<div className="flex items-start justify-between px-6 py-5 border-b border-gray-200">
									<DialogHeader className="p-0">
										<DialogTitle className="text-lg font-semibold text-black">Validation Details</DialogTitle>
									</DialogHeader>
									<button 
										aria-label="Close" 
										onClick={() => setDetailIdx(null)} 
										className="rounded-md p-1.5 text-black hover:bg-gray-100 transition-colors"
									>
										<X className="h-5 w-5" />
									</button>
								</div>
								<div className="px-6 py-6 overflow-y-auto bg-white">
									{detailIdx !== null && filtered[detailIdx] && (() => {
										const record = filtered[detailIdx];
										return (
											<div className="space-y-6">
												{/* Scan Result Details */}
												{record.scan && (
													<div className="space-y-6 bg-white">
														{/* Disease */}
														<div className="space-y-2">
															<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Disease</h3>
															<p className="text-base text-black font-normal leading-relaxed">{record.ai_prediction}</p>
														</div>

														{/* Confidence Level */}
														{record.scan.confidence !== null && record.scan.confidence !== undefined && (
															<div className="space-y-2">
																<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Confidence Level</h3>
																<p className="text-base text-black font-normal">
																	Confidence: {typeof record.scan.confidence === 'number' 
																		? `${record.scan.confidence.toFixed(1)}%` 
																		: `${parseFloat(String(record.scan.confidence)).toFixed(1)}%`}
																</p>
															</div>
														)}

														{/* Treatment / Solution */}
														{record.scan.solution && (
															<div className="space-y-2">
																<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Treatment / Solution</h3>
																<p className="text-base text-black font-normal leading-relaxed whitespace-pre-wrap">{record.scan.solution}</p>
															</div>
														)}

														{/* Recommended Products */}
														{record.scan.recommended_products && (
															<div className="space-y-2">
																<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Recommended Products</h3>
																<p className="text-base text-black font-normal leading-relaxed">{record.scan.recommended_products}</p>
															</div>
														)}
													</div>
												)}

												{/* Divider */}
												<div className="border-t border-gray-200"></div>

												{/* Scan Image */}
												{record.scan?.image_url && (
													<div className="space-y-2">
														<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Scan Image</h3>
														<div className="mt-2">
															<img 
																src={record.scan.image_url} 
																alt="Scan preview" 
																className="w-full max-h-80 md:max-h-96 object-contain rounded border border-gray-200"
																onError={(e) => { e.currentTarget.style.display = 'none'; }}
															/>
														</div>
													</div>
												)}

												{/* Divider */}
												<div className="border-t border-gray-200"></div>

												{/* Farmer Information */}
												<div className="space-y-3">
													<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Farmer Information</h3>
													<div className="flex items-center gap-3">
														{record.scan?.farmer_profile?.profile_picture ? (
															<img 
																src={record.scan.farmer_profile.profile_picture} 
																alt="Profile" 
																className="w-10 h-10 rounded-full object-cover"
																onError={(e) => { e.currentTarget.style.display = 'none'; }}
															/>
														) : (
															<div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-black">
																{record.scan?.farmer_profile?.full_name?.charAt(0) || record.scan?.farmer_profile?.username?.charAt(0) || '?'}
															</div>
														)}
														<div>
															<p className="text-base text-black font-normal">
																{record.scan?.farmer_profile?.full_name || record.scan?.farmer_profile?.username || 'Unknown Farmer'}
															</p>
															<p className="text-sm text-black font-normal opacity-70">
																{record.scan ? formatDate(record.scan.created_at) : formatDate(record.validated_at)}
															</p>
														</div>
													</div>
												</div>

												{/* Expert Information */}
												<div className="space-y-3">
													<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Expert Information</h3>
													<div className="flex items-center gap-3">
														<div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-black">
															{record.expert_profile?.full_name?.charAt(0) || record.expert_profile?.username?.charAt(0) || '?'}
														</div>
														<div>
															<p className="text-base text-black font-normal">
																{record.expert_profile?.full_name || record.expert_profile?.username || 'Unknown Expert'}
															</p>
															<p className="text-sm text-black font-normal opacity-70">{formatDate(record.validated_at)}</p>
														</div>
													</div>
												</div>

												{/* Expert Validation */}
												{record.expert_validation && (
													<>
														<div className="border-t border-gray-200"></div>
														<div className="space-y-2">
															<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Expert Validation</h3>
															<p className="text-base text-black font-normal leading-relaxed whitespace-pre-wrap">{record.expert_validation}</p>
														</div>
													</>
												)}

												{/* Status */}
												<div className="border-t border-gray-200"></div>
												<div className="space-y-2">
													<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Status</h3>
													<Badge color={getStatusColor(record.status)}>{record.status}</Badge>
												</div>
											</div>
										);
									})()}
								</div>
								<div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end bg-white">
									<Button 
										variant="outline" 
										onClick={() => setDetailIdx(null)}
										className="text-black border-gray-300 hover:bg-gray-50"
									>
										Close
									</Button>
								</div>
							</div>
						</DialogContent>
					</Dialog>
				</div>
			</AppShell>
		</AuthGuard>
	);
}


