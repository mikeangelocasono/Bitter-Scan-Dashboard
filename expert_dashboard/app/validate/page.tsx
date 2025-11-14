"use client";

import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/components/supabase";
import { Loader2, AlertCircle, X } from "lucide-react";
import { Scan } from "@/types";
import { useUser } from "@/components/UserContext";
import { useData } from "@/components/DataContext";

const VALIDATION_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	timeZone: "UTC",
});

type SupabaseError = {
	message?: string;
	details?: string;
	hint?: string;
	code?: string;
} | null;

const buildSupabaseErrorMessage = (error: SupabaseError): string => {
	if (!error) return "Unknown error";
	const parts = [error.message, error.details, error.hint].filter(Boolean);
	return parts.length ? parts.join(" • ") : JSON.stringify(error);
};

export default function ValidatePage() {
	const [tab, setTab] = useState<'leaf' | 'fruit'>('leaf');
	const [notes, setNotes] = useState<Record<string, string>>({});
	const [decision, setDecision] = useState<Record<string, string>>({});
	const [dateFilter, setDateFilter] = useState<string>("");
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
		} catch (err) {
			if (scanUpdated) {
				const rollbackPayload: Record<string, unknown> = {
					status: originalStatus,
					updated_at: new Date().toISOString(),
				};

				try {
					await applyScanUpdate(rollbackPayload);
				} catch (rollbackError) {
					console.error("Failed to rollback scan update:", rollbackError);
				}
			}

			console.error(
				action === "confirm" ? "Error confirming validation:" : "Error correcting validation:",
				buildSupabaseErrorMessage(err as SupabaseError)
			);
			toast.error(action === "confirm" ? "Failed to confirm validation" : "Failed to correct validation");
		} finally {
			setProcessingScanId(prev => (prev === scanId ? null : prev));
		}
	}, [processingScanId, scans, user, notes, decision, detailId, removeScanFromState, refreshData]);

	const onConfirm = useCallback((scanId: number) => handleValidation(scanId, "confirm"), [handleValidation]);
	const onReject = useCallback((scanId: number) => handleValidation(scanId, "correct"), [handleValidation]);

	const filtered = useMemo(() => {
		const pendingScans = scans.filter(scan => scan.status === 'Pending Validation');
		return pendingScans.filter((scan) => {
			const matchesTab = tab === 'leaf' ? scan.scan_type === 'leaf_disease' : scan.scan_type === 'fruit_maturity';
			if (!dateFilter) {
				return matchesTab;
			}
			const scanDate = new Date(scan.created_at).toISOString().split('T')[0];
			return matchesTab && scanDate === dateFilter;
		});
	}, [scans, dateFilter, tab]);

	// Memoized helper functions
	const formatDate = useCallback((dateString: string) => {
		return VALIDATION_DATE_FORMATTER.format(new Date(dateString));
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

					{/* Date Filter */}
					<div className="flex items-center gap-3">
						<label htmlFor="date-filter" className="text-sm font-medium text-gray-700 whitespace-nowrap">
							Filter by Date:
						</label>
						<input 
							id="date-filter"
							type="date" 
							value={dateFilter}
							onChange={(e) => setDateFilter(e.target.value)}
							className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
						/>
						{dateFilter && (
							<Button 
								variant="ghost" 
								size="sm"
								onClick={() => setDateFilter("")}
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
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
							{filtered.map((scan) => (
								<Card key={scan.id} className="flex flex-col shadow-sm hover:shadow-md transition-shadow">
									<CardHeader className="pb-3 border-b">
										<div className="flex items-center gap-3">
											{scan.farmer_profile?.profile_picture ? (
												<img 
													src={scan.farmer_profile.profile_picture} 
													alt="Profile" 
													className="w-10 h-10 rounded-full object-cover"
													onError={(e) => {
														e.currentTarget.style.display = 'none';
													}}
												/>
											) : (
												<div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
													{scan.farmer_profile?.full_name?.charAt(0) || scan.farmer_profile?.username?.charAt(0) || '?'}
												</div>
											)}
											<div className="flex-1 min-w-0">
												<CardTitle className="text-lg font-semibold truncate">
													{scan.farmer_profile?.full_name || scan.farmer_profile?.username || 'Unknown Farmer'}
												</CardTitle>
												<p className="text-xs text-gray-500 mt-0.5">{formatDate(scan.created_at)}</p>
											</div>
										</div>
									</CardHeader>
									<CardContent className="flex-1 flex flex-col space-y-4 pt-4">
										{/* Scan Image */}
										<div className="aspect-video w-full bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
											{scan.image_url ? (
												<img 
													src={scan.image_url} 
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
										<div className="space-y-3 bg-white border border-gray-200 rounded-lg p-4">
											{/* Disease */}
											<div className="space-y-1">
												<p className="text-xs font-semibold text-black uppercase tracking-wide">Disease</p>
												<p className="text-sm text-black font-normal">{scan.ai_prediction}</p>
											</div>
											
											{/* Confidence Level */}
											<div className="space-y-1">
												<p className="text-xs font-semibold text-black uppercase tracking-wide">Confidence Level</p>
												<p className="text-sm text-black font-normal">
													{scan.confidence !== null && scan.confidence !== undefined
														? `Confidence: ${typeof scan.confidence === 'number' ? scan.confidence : String(scan.confidence)}%`
														: 'Confidence: N/A'}
												</p>
											</div>

											{/* Treatment / Solution */}
											{scan.solution && (
												<div className="space-y-1">
													<p className="text-xs font-semibold text-black uppercase tracking-wide">Treatment / Solution</p>
													<p className="text-sm text-black font-normal leading-relaxed line-clamp-3">{scan.solution}</p>
												</div>
											)}

											{/* Recommended Products */}
											{scan.recommended_products && (
												<div className="space-y-1">
													<p className="text-xs font-semibold text-black uppercase tracking-wide">Recommended Products</p>
													<p className="text-sm text-black font-normal">{scan.recommended_products}</p>
												</div>
											)}
										</div>

										{/* Disease/Maturity Selection */}
										<div className="space-y-2">
											<label className="block text-sm font-semibold text-black uppercase tracking-wide">
												{tab === 'leaf' ? 'Select Diagnosis' : 'Select Ripeness Stage'}
											</label>
											{tab === 'leaf' ? (
												<select 
													value={decision[scan.id.toString()] ?? ''} 
													onChange={(e) => setDecision({...decision, [scan.id.toString()]: e.target.value})} 
													className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-gray-400 bg-white"
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
													value={decision[scan.id.toString()] ?? ''} 
													onChange={(e) => setDecision({...decision, [scan.id.toString()]: e.target.value})} 
													className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-gray-400 bg-white"
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
											<label className="block text-sm font-semibold text-black uppercase tracking-wide">Notes (optional)</label>
											<textarea 
												value={notes[scan.id.toString()] ?? ''} 
												onChange={(e) => setNotes({...notes, [scan.id.toString()]: e.target.value})} 
												placeholder="Add your expert analysis or comments..." 
												className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-gray-400 resize-none"
												rows={3}
											/>
										</div>

										{/* Action Buttons */}
										<div className="flex gap-3 pt-2">
											<Button 
												onClick={() => onConfirm(scan.id)}
												disabled={hasDecision(scan.id) || processingScanId === scan.id}
												className="flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
											>
												{processingScanId === scan.id ? 'Processing...' : 'Confirm'}
											</Button>
											<Button 
												variant="outline" 
												onClick={() => onReject(scan.id)}
												disabled={!hasDecision(scan.id) || processingScanId === scan.id}
												className="flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
											>
												{processingScanId === scan.id ? 'Processing...' : 'Correct'}
											</Button>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					)}

					<Dialog open={!!detailId} onOpenChange={() => setDetailId(null)}>
						<DialogContent className="sm:max-w-2xl p-0 overflow-hidden bg-white">
							<div className="flex flex-col max-h-[85vh]">
								<div className="flex items-start justify-between px-6 py-5 border-b border-gray-200">
									<DialogHeader className="p-0">
										<DialogTitle className="text-lg font-semibold text-black">Validate Scan</DialogTitle>
									</DialogHeader>
									<button 
										aria-label="Close" 
										onClick={() => setDetailId(null)} 
										className="rounded-md p-1.5 text-black hover:bg-gray-100 transition-colors"
									>
										<X className="h-5 w-5" />
									</button>
								</div>
								<div className="px-6 py-6 overflow-y-auto bg-white">
									{detailId && (() => {
										const selectedScan = scans.find(scan => scan.id.toString() === detailId);
										if (!selectedScan) return <p className="text-sm text-black">Scan not found.</p>;
										
										const scanDetails = parseScanDetails(selectedScan);
										
										return (
											<div className="space-y-6">
												{/* Scan Result Details - Clean Professional Layout */}
												<div className="space-y-6 bg-white">
													{/* Disease Section */}
													<div className="space-y-2">
														<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Disease</h3>
														<p className="text-base text-black font-normal leading-relaxed">{scanDetails.disease}</p>
													</div>

													{/* Confidence Level Section */}
													<div className="space-y-2">
														<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Confidence Level</h3>
														<p className="text-base text-black font-normal">{scanDetails.confidence}</p>
													</div>

													{/* Treatment / Solution Section */}
													{scanDetails.solution && (
														<div className="space-y-2">
															<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Treatment / Solution</h3>
															<p className="text-base text-black font-normal leading-relaxed whitespace-pre-wrap">{scanDetails.solution}</p>
														</div>
													)}

													{/* Recommended Products Section */}
													{scanDetails.recommendedProducts && (
														<div className="space-y-2">
															<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Recommended Products</h3>
															<p className="text-base text-black font-normal leading-relaxed">{scanDetails.recommendedProducts}</p>
														</div>
													)}
												</div>

												{/* Divider */}
												<div className="border-t border-gray-200"></div>

												{/* Scan Image */}
												{selectedScan.image_url && (
													<div className="space-y-2">
														<h3 className="text-sm font-semibold text-black uppercase tracking-wide">Scan Image</h3>
														<div className="mt-2">
															<img 
																src={selectedScan.image_url} 
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
														{selectedScan.farmer_profile?.profile_picture ? (
															<img 
																src={selectedScan.farmer_profile.profile_picture} 
																alt="Profile" 
																className="w-10 h-10 rounded-full object-cover"
																onError={(e) => { e.currentTarget.style.display = 'none'; }}
															/>
														) : (
															<div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-black">
																{selectedScan.farmer_profile?.full_name?.charAt(0) || selectedScan.farmer_profile?.username?.charAt(0) || '?'}
															</div>
														)}
														<div>
															<p className="text-base text-black font-normal">
																{selectedScan.farmer_profile?.full_name || selectedScan.farmer_profile?.username || 'Unknown Farmer'}
															</p>
															<p className="text-sm text-black font-normal opacity-70">{formatDate(selectedScan.created_at)}</p>
														</div>
													</div>
												</div>

												{/* Divider */}
												<div className="border-t border-gray-200"></div>

												{/* Expert Validation Section */}
												<div className="space-y-4">
													{/* Disease/Maturity Selection */}
													<div className="space-y-2">
														<label className="block text-sm font-semibold text-black uppercase tracking-wide">
															{selectedScan.scan_type === 'leaf_disease' ? 'Select Diagnosis' : 'Select Ripeness Stage'}
														</label>
														{selectedScan.scan_type === 'leaf_disease' ? (
															<select 
																value={decision[detailId!] ?? ''} 
																onChange={(e) => setDecision({...decision, [detailId!]: e.target.value})} 
																className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-gray-400 bg-white"
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
																className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-gray-400 bg-white"
															>
																<option value="">Select ripeness stage</option>
																<option>Immature</option>
																<option>Mature</option>
																<option>Overmature</option>
																<option>Overripe</option>
															</select>
														)}
													</div>

													{/* Expert Notes */}
													<div className="space-y-2">
														<label className="block text-sm font-semibold text-black uppercase tracking-wide">Notes (optional)</label>
														<textarea 
															value={notes[detailId!] ?? ''} 
															onChange={(e) => setNotes({...notes, [detailId!]: e.target.value})} 
															placeholder="Add your expert analysis or comments..." 
															className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-gray-400 resize-none" 
															rows={3} 
														/>
													</div>

													<p className="text-sm text-black font-normal">Please choose Confirm if the AI is correct, or Correct to provide the right answer.</p>
												</div>
											</div>
										);
									})()}
								</div>
								<div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3 bg-white">
									<Button 
										variant="outline" 
										onClick={() => setDetailId(null)}
										className="text-black border-gray-300 hover:bg-gray-50"
									>
										Close
									</Button>
									{detailId && (
										<>
											<Button 
												onClick={() => onConfirm(parseInt(detailId))}
												disabled={hasDecision(parseInt(detailId)) || processingScanId === parseInt(detailId)}
												className="bg-black text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
											>
												{processingScanId === parseInt(detailId) ? 'Processing...' : 'Confirm'}
											</Button>
											<Button 
												variant="outline" 
												onClick={() => onReject(parseInt(detailId))}
												disabled={!hasDecision(parseInt(detailId)) || processingScanId === parseInt(detailId)}
												className="text-black border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
											>
												{processingScanId === parseInt(detailId) ? 'Processing...' : 'Correct'}
											</Button>
										</>
									)}
								</div>
							</div>
						</DialogContent>
					</Dialog>
				</div>
			</AppShell>
		</AuthGuard>
	);
}


