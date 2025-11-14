"use client";

import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/components/supabase";
import { Loader2, AlertCircle, X, Eye } from "lucide-react";
import { Scan, SupabaseApiError, isSupabaseApiError } from "@/types";
import { useUser } from "@/components/UserContext";
import { useData } from "@/components/DataContext";

// Accurate date formatter - shows local time without timezone shifts
const formatScanDate = (dateString: string): string => {
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

const buildSupabaseErrorMessage = (error: SupabaseApiError | null): string => {
	if (!error) return "Unknown error";
	const parts = [error.message, error.details, error.hint].filter(Boolean);
	return parts.length ? parts.join(" • ") : JSON.stringify(error);
};

export default function ValidatePage() {
	const [tab, setTab] = useState<'leaf' | 'fruit'>('leaf');
	const [notes, setNotes] = useState<Record<string, string>>({});
	const [decision, setDecision] = useState<Record<string, string>>({});
	const [dateRangeType, setDateRangeType] = useState<'daily' | 'weekly' | 'monthly' | 'custom' | 'none'>('none');
	const [startDate, setStartDate] = useState<string>("");
	const [endDate, setEndDate] = useState<string>("");
	const [detailId, setDetailId] = useState<string | null>(null);
	const [processingScanId, setProcessingScanId] = useState<number | null>(null);
	const { user } = useUser();
	const { scans, loading, error, removeScanFromState, refreshData } = useData();

	// Helper function to check if a decision is selected for a scan
	const hasDecision = useCallback((scanId: number): boolean => {
		const decisionValue = decision[scanId.toString()];
		return decisionValue !== undefined && decisionValue !== null && decisionValue.trim() !== '';
	}, [decision]);

	const handleValidation = useCallback(async (scanId: number, action: "confirm" | "correct") => {
		if (processingScanId === scanId) return;

		const selectedScan = scans.find(scan => scan.id === scanId);
		if (!selectedScan) {
			toast.error("Scan not found");
			return;
		}

		if (!user?.id) {
			toast.error("You must be signed in to validate scans.");
			return;
		}

		const scanKey = scanId.toString();
		const noteInput = notes[scanKey];
		const note = noteInput && noteInput.trim().length > 0 ? noteInput.trim() : null;
		const correctedInput = decision[scanKey];
		const corrected = correctedInput && correctedInput.trim().length > 0 ? correctedInput.trim() : "";

		if (action === "correct" && !corrected) {
			toast.error("Please select or enter the corrected result.");
			return;
		}

		const expertValidation = action === "confirm" ? selectedScan.ai_prediction : corrected || selectedScan.ai_prediction;
		if (!expertValidation) {
			toast.error("Unable to determine validation result.");
			return;
		}

		const status = action === "confirm" ? "Validated" : "Corrected";
		const timestamp = new Date().toISOString();
		const originalStatus = selectedScan.status;
		let scanUpdated = false;

		const applyScanUpdate = async (payload: Record<string, unknown>) => {
			const { error } = await supabase.from("scans").update(payload).eq("id", scanId);

			if (error) {
				throw error;
			}
		};

		setProcessingScanId(scanId);

		try {
			const updatePayload: Record<string, unknown> = {
				status,
				updated_at: timestamp,
			};

			await applyScanUpdate(updatePayload);
			scanUpdated = true;

			const insertPayload = {
				scan_id: scanId,
				expert_id: user.id,
				ai_prediction: selectedScan.ai_prediction,
				expert_validation: expertValidation,
				status,
				validated_at: timestamp,
				expert_comment: note,
			};

			const { error: historyError } = await supabase.from("validation_history").insert(insertPayload);

			if (historyError) {
				if ((historyError as { code?: string }).code === "23505") {
					const { error: updateHistoryError } = await supabase
						.from("validation_history")
						.update(insertPayload)
						.eq("scan_id", scanId)
						.eq("expert_id", user.id);

					if (updateHistoryError) {
						console.error("Error updating validation history:", updateHistoryError);
						throw updateHistoryError;
					}
				} else {
					console.error("Error creating validation history:", historyError);
					throw historyError;
				}
			}

			const successMessage =
				status === "Validated"
					? `Validation for scan ${scanId} confirmed`
					: `Validation for scan ${scanId} corrected`;
			toast.success(successMessage);
			removeScanFromState(scanId);

			setDecision(prev => {
				const { [scanKey]: _, ...rest } = prev;
				return rest;
			});
			setNotes(prev => {
				const { [scanKey]: _, ...rest } = prev;
				return rest;
			});
			if (detailId === scanKey) {
				setDetailId(null);
			}

			await refreshData();
		} catch (err: unknown) {
			if (scanUpdated) {
				const rollbackPayload: Record<string, unknown> = {
					status: originalStatus,
					updated_at: new Date().toISOString(),
				};

				try {
					await applyScanUpdate(rollbackPayload);
				} catch (rollbackError: unknown) {
					console.error("Failed to rollback scan update:", rollbackError);
				}
			}

			console.error(
				action === "confirm" ? "Error confirming validation:" : "Error correcting validation:",
				buildSupabaseErrorMessage(isSupabaseApiError(err) ? err : null)
			);
			toast.error(action === "confirm" ? "Failed to confirm validation" : "Failed to correct validation");
		} finally {
			setProcessingScanId(prev => (prev === scanId ? null : prev));
		}
	}, [processingScanId, scans, user, notes, decision, detailId, removeScanFromState, refreshData]);

	const onConfirm = useCallback((scanId: number) => handleValidation(scanId, "confirm"), [handleValidation]);
	const onReject = useCallback((scanId: number) => handleValidation(scanId, "correct"), [handleValidation]);

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

	const filtered = useMemo(() => {
		const pendingScans = scans.filter(scan => scan.status === 'Pending Validation');
		
		return pendingScans.filter((scan) => {
			const matchesTab = tab === 'leaf' ? scan.scan_type === 'leaf_disease' : scan.scan_type === 'fruit_maturity';
			
			// Apply date range filter
			if (dateRangeType !== 'none') {
				const { start, end } = getDateRange(dateRangeType);
				if (start && end) {
					const scanDate = new Date(scan.created_at);
					if (scanDate < start || scanDate > end) {
						return false;
					}
				}
			}
			
			return matchesTab;
		});
	}, [scans, dateRangeType, tab, getDateRange]);

	// Memoized date formatter - uses accurate local time
	const formatDate = useCallback((dateString: string) => {
		return formatScanDate(dateString);
	}, []);

	// Parse scan result details from scan data
	const parseScanDetails = useCallback((scan: Scan) => {
		// Try to extract from structured fields first
		const disease = scan.ai_prediction;
		const confidence = scan.confidence;
		const solution = scan.solution;
		const recommendedProducts = scan.recommended_products;

		// Format confidence as "Confidence: X%" (display exact value from database)
		let formattedConfidence = null;
		if (confidence !== null && confidence !== undefined) {
			if (typeof confidence === 'number') {
				formattedConfidence = `Confidence: ${confidence}%`;
			} else {
				formattedConfidence = `Confidence: ${String(confidence)}%`;
			}
		} else {
			formattedConfidence = 'Confidence: N/A';
		}

		return {
			disease: disease || 'N/A',
			confidence: formattedConfidence,
			solution: solution || null,
			recommendedProducts: recommendedProducts || null,
		};
	}, []);

	return (
		<AuthGuard>
			<AppShell>
				<div className="space-y-6">
					{/* Header with Toggle Buttons */}
					<div className="flex items-center justify-between">
						<h2 className="text-2xl font-semibold text-gray-900">Validation</h2>
						<div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
							<button 
								className={`px-5 py-2.5 text-sm font-medium transition-all ${
									tab === 'leaf' 
										? 'bg-[var(--primary)] text-white shadow-sm' 
										: 'text-gray-700 hover:bg-gray-50'
								}`} 
								onClick={() => setTab('leaf')}
							>
								Leaf Disease
							</button>
							<button 
								className={`px-5 py-2.5 text-sm font-medium transition-all ${
									tab === 'fruit' 
										? 'bg-[var(--primary)] text-white shadow-sm' 
										: 'text-gray-700 hover:bg-gray-50'
								}`} 
								onClick={() => setTab('fruit')}
							>
								Fruit Maturity
							</button>
						</div>
					</div>

					{/* Date Range Filter */}
					<div className="flex flex-wrap items-center gap-3">
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

					{/* Cards */}
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
								<p className="text-gray-500 font-medium">No pending scans found.</p>
								<p className="text-gray-400 text-sm mt-1">New scans will appear here when farmers submit them.</p>
							</div>
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<Thead>
									<Tr>
										<Th className="w-20">Image</Th>
										<Th>Farmer Name</Th>
										<Th>Crop Type</Th>
										<Th>Status</Th>
										<Th>Date Scanned</Th>
										<Th className="text-right">Action</Th>
									</Tr>
								</Thead>
								<Tbody>
									{filtered.map((scan) => {
										const cropType = scan.scan_type === 'leaf_disease' ? 'Leaf Disease' : 'Fruit Maturity';
										const farmerName = scan.farmer_profile?.full_name || scan.farmer_profile?.username || 'Unknown Farmer';
										
										return (
											<Tr key={scan.id}>
												<Td>
													<div className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex-shrink-0">
														{scan.image_url ? (
															<img 
																src={scan.image_url} 
																alt="Scan preview" 
																className="w-full h-full object-cover"
																onError={(e) => {
																	e.currentTarget.style.display = 'none';
																}}
															/>
														) : (
															<div className="flex items-center justify-center h-full text-gray-400 text-xs">
																No image
															</div>
														)}
													</div>
												</Td>
												<Td>
													<div className="flex items-center gap-2">
														{scan.farmer_profile?.profile_picture ? (
															<img 
																src={scan.farmer_profile.profile_picture} 
																alt="Profile" 
																className="w-8 h-8 rounded-full object-cover flex-shrink-0"
																onError={(e) => {
																	e.currentTarget.style.display = 'none';
																}}
															/>
														) : (
															<div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 flex-shrink-0">
																{farmerName.charAt(0).toUpperCase()}
															</div>
														)}
														<span className="font-medium text-gray-900 truncate">{farmerName}</span>
													</div>
												</Td>
												<Td>
													<span className="text-sm text-gray-700">{cropType}</span>
												</Td>
												<Td>
													<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
														{scan.status}
													</span>
												</Td>
												<Td>
													<span className="text-sm text-gray-600">{formatDate(scan.created_at)}</span>
												</Td>
												<Td className="text-right">
													<Button
														variant="outline"
														size="sm"
														onClick={() => setDetailId(scan.id.toString())}
														className="flex items-center gap-1.5 bg-white text-black border-black/20 shadow-sm hover:bg-white hover:text-black hover:font-semibold hover:shadow-md hover:border-black/30 transition-all"
													>
														<Eye className="h-4 w-4" />
														View Details
													</Button>
												</Td>
											</Tr>
										);
									})}
								</Tbody>
							</Table>
						</div>
					)}

					<Dialog open={!!detailId} onOpenChange={() => setDetailId(null)}>
						<div className="p-0 overflow-hidden bg-white max-h-[90vh] flex flex-col">
							<DialogContent>
							{detailId && (() => {
								const selectedScan = scans.find(scan => scan.id.toString() === detailId);
								if (!selectedScan) return (
									<div className="p-6">
										<p className="text-sm text-black">Scan not found.</p>
									</div>
								);
								
								const scanDetails = parseScanDetails(selectedScan);
								const cropType = selectedScan.scan_type === 'leaf_disease' ? 'Leaf Disease' : 'Fruit Maturity';
								
								return (
									<>
										{/* Modal Header */}
										<div className="flex items-start justify-between px-6 py-5 border-b border-black/20 bg-white rounded-t-xl">
											<div className="p-0">
												<DialogHeader>
													<div className="text-lg font-semibold text-gray-900">
														<DialogTitle>Validate Scan</DialogTitle>
													</div>
												</DialogHeader>
											</div>
											<button 
												aria-label="Close" 
												onClick={() => setDetailId(null)} 
												className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
											>
												<X className="h-5 w-5" />
											</button>
										</div>

										{/* Scrollable Content - Matching Card Design */}
										<div className="px-6 py-6 overflow-y-auto bg-white flex-1">
											<Card className="shadow-sm border border-black/20">
												<CardHeader className="pb-3 border-b border-black/10">
													<div className="flex items-center gap-3">
														{selectedScan.farmer_profile?.profile_picture ? (
															<img 
																src={selectedScan.farmer_profile.profile_picture} 
																alt="Profile" 
																className="w-10 h-10 rounded-full object-cover"
																onError={(e) => {
																	e.currentTarget.style.display = 'none';
																}}
															/>
														) : (
															<div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
																{selectedScan.farmer_profile?.full_name?.charAt(0) || selectedScan.farmer_profile?.username?.charAt(0) || '?'}
															</div>
														)}
														<div className="flex-1 min-w-0">
															<CardTitle className="text-lg font-semibold truncate">
																{selectedScan.farmer_profile?.full_name || selectedScan.farmer_profile?.username || 'Unknown Farmer'}
															</CardTitle>
															<p className="text-xs text-gray-500 mt-0.5">{formatDate(selectedScan.created_at)}</p>
														</div>
													</div>
												</CardHeader>
												<CardContent className="flex-1 flex flex-col space-y-4 pt-4">
													{/* Scan Image */}
													<div className="aspect-video w-full bg-emerald-50 rounded-lg overflow-hidden border border-black/20">
														{selectedScan.image_url ? (
															<img 
																src={selectedScan.image_url} 
																alt="Scan preview" 
																className="w-full h-full object-contain"
																onError={(e) => {
																	e.currentTarget.style.display = 'none';
																}}
															/>
														) : (
															<div className="flex items-center justify-center h-full text-gray-400 text-sm">
																No image available
															</div>
														)}
													</div>

													{/* Scan Result Details */}
													<div className="space-y-3 bg-white border border-black/20 rounded-lg p-4">
														{/* Crop Type */}
														<div className="space-y-1">
															<p className="text-xs font-semibold text-black uppercase tracking-wide">Crop Type</p>
															<p className="text-sm text-black font-normal">{cropType}</p>
														</div>

														{/* Disease / AI Result */}
														<div className="space-y-1">
															<p className="text-xs font-semibold text-black uppercase tracking-wide">
																{selectedScan.scan_type === 'leaf_disease' ? 'Disease' : 'Maturity Stage'}
															</p>
															<p className="text-sm text-black font-normal">{scanDetails.disease}</p>
														</div>
														
														{/* Confidence Level */}
														<div className="space-y-1">
															<p className="text-xs font-semibold text-black uppercase tracking-wide">Confidence Level</p>
															<p className="text-sm text-black font-normal">{scanDetails.confidence}</p>
														</div>

														{/* Validation Status */}
														<div className="space-y-1">
															<p className="text-xs font-semibold text-black uppercase tracking-wide">Validation Status</p>
															<p className="text-sm text-black font-normal">
																<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
																	{selectedScan.status}
																</span>
															</p>
														</div>

														{/* Treatment / Solution */}
														{scanDetails.solution && (
															<div className="space-y-1">
																<p className="text-xs font-semibold text-black uppercase tracking-wide">Treatment / Solution</p>
																<p className="text-sm text-black font-normal leading-relaxed">{scanDetails.solution}</p>
															</div>
														)}

														{/* Recommended Products */}
														{scanDetails.recommendedProducts && (
															<div className="space-y-1">
																<p className="text-xs font-semibold text-black uppercase tracking-wide">Recommended Products</p>
																<p className="text-sm text-black font-normal">{scanDetails.recommendedProducts}</p>
															</div>
														)}
													</div>

													{/* Disease/Maturity Selection */}
													<div className="space-y-2">
														<label className="block text-sm font-semibold text-black uppercase tracking-wide">
															{selectedScan.scan_type === 'leaf_disease' ? 'Select Diagnosis' : 'Select Ripeness Stage'}
														</label>
														{selectedScan.scan_type === 'leaf_disease' ? (
															<select 
																value={decision[detailId!] ?? ''} 
																onChange={(e) => setDecision({...decision, [detailId!]: e.target.value})} 
																className="w-full rounded-lg border border-emerald-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
															>
																<option value="">Select diagnosis</option>
																<option>Healthy</option>
																<option>Fusarium Wilt</option>
																<option>Downy Mildew</option>
																<option>Yellow Mosaic Virus</option>
																<option>Other</option>
															</select>
														) : (
															<select 
																value={decision[detailId!] ?? ''} 
																onChange={(e) => setDecision({...decision, [detailId!]: e.target.value})} 
																className="w-full rounded-lg border border-emerald-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
															>
																<option value="">Select ripeness stage</option>
																<option>Immature</option>
																<option>Mature</option>
																<option>Overmature</option>
																<option>Overripe</option>
															</select>
														)}
													</div>

													{/* Notes */}
													<div className="space-y-2">
														<label className="block text-sm font-semibold text-gray-900 uppercase tracking-wide">Notes (optional)</label>
														<textarea 
															value={notes[detailId!] ?? ''} 
															onChange={(e) => setNotes({...notes, [detailId!]: e.target.value})} 
															placeholder="Add your expert analysis or comments..." 
															className="w-full rounded-lg border border-emerald-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
															rows={3}
														/>
													</div>
												</CardContent>
											</Card>
										</div>

										{/* Modal Footer */}
										<div className="bg-white border-t border-black/20 rounded-b-xl">
											<DialogFooter>
												<Button 
													variant="outline" 
													onClick={() => setDetailId(null)}
													className="text-gray-700 border-emerald-300 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700"
												>
													Cancel
												</Button>
												<Button 
													onClick={() => onConfirm(parseInt(detailId))}
													disabled={hasDecision(parseInt(detailId)) || processingScanId === parseInt(detailId)}
													className="bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] disabled:opacity-50 disabled:cursor-not-allowed"
												>
													{processingScanId === parseInt(detailId) ? 'Processing...' : 'Confirm'}
												</Button>
												<Button 
													variant="outline" 
													onClick={() => onReject(parseInt(detailId))}
													disabled={!hasDecision(parseInt(detailId)) || processingScanId === parseInt(detailId)}
													className="text-gray-700 border-emerald-300 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
												>
													{processingScanId === parseInt(detailId) ? 'Processing...' : 'Correct'}
												</Button>
											</DialogFooter>
										</div>
									</>
								);
							})()}
							</DialogContent>
						</div>
					</Dialog>
				</div>
			</AppShell>
		</AuthGuard>
	);
}


