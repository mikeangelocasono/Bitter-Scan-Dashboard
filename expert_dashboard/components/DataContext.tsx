"use client";

import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";
import { Scan, ValidationHistory, SupabaseApiError, isSupabaseApiError } from "../types";
import { useUser } from "./UserContext";

type DataContextValue = {
	scans: Scan[];
	validationHistory: ValidationHistory[];
	totalUsers: number;
	loading: boolean;
	error: string | null;
	refreshData: (showSpinner?: boolean) => Promise<void>;
	removeScanFromState: (scanId: number) => void;
};

const DataContext = createContext<DataContextValue | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
	const { user } = useUser();
	const [scans, setScans] = useState<Scan[]>([]);
	const [validationHistory, setValidationHistory] = useState<ValidationHistory[]>([]);
	const [totalUsers, setTotalUsers] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const initialFetched = useRef(false);
	const isFetchingRef = useRef(false);

	const isReady = useMemo(() => Boolean(user?.id), [user?.id]);

	const fetchData = useCallback(
		async (showSpinner = false) => {
			if (!isReady || isFetchingRef.current) return;

			isFetchingRef.current = true;

			// Only show spinner if we explicitly requested or we haven't fetched once yet
			const shouldShowSpinner = showSpinner || !initialFetched.current;
			if (shouldShowSpinner) setLoading(true);

			try {
				setError(null);

				const [scansResponse, validationsResponse, profilesResponse] = await Promise.all([
					supabase
						.from("scans")
						.select(
							`*,
					farmer_profile:profiles!scans_farmer_id_fkey(
						id,
						username,
						full_name,
						email,
						profile_picture
					)`
						)
						.order("created_at", { ascending: false }),
					supabase
						.from("validation_history")
						.select(
							`*,
					expert_profile:profiles!validation_history_expert_id_fkey(
						id,
						username,
						full_name,
						email
					),
					scan:scans!validation_history_scan_id_fkey(
						*,
						farmer_profile:profiles!scans_farmer_id_fkey(
							id,
							username,
							full_name,
							email,
							profile_picture
						)
					)`
						)
						.order("validated_at", { ascending: false }),
					supabase.from("profiles").select("*", { head: true, count: "exact" }),
				]);

				if (scansResponse.error) throw scansResponse.error;
				if (validationsResponse.error) throw validationsResponse.error;
				if (profilesResponse.error) throw profilesResponse.error;

				let validations = validationsResponse.data || [];

				const missingExpertIds = new Set<string>();
				validations.forEach((validation) => {
					if (!validation.expert_profile?.full_name && validation.expert_id) {
						missingExpertIds.add(validation.expert_id);
					}
				});

				if (missingExpertIds.size > 0) {
					const { data: fallbackProfiles, error: fallbackProfilesError } = await supabase
						.from("profiles")
						.select("id, full_name, username, email")
						.in("id", Array.from(missingExpertIds));

					if (fallbackProfilesError) {
						console.error("Error fetching expert profiles:", fallbackProfilesError);
					} else if (fallbackProfiles) {
						const profileMap = new Map(
							fallbackProfiles.map((profile) => [profile.id, profile])
						);

						validations = validations.map((validation) => {
							if (validation.expert_profile?.full_name || !validation.expert_id) {
								return validation;
							}

							const profile = profileMap.get(validation.expert_id);
							if (!profile) return validation;

							return {
								...validation,
								expert_profile: {
									id: profile.id,
									username: profile.username,
									full_name: profile.full_name,
									email: profile.email,
								},
							};
						});
					}
				}

				setScans(scansResponse.data || []);
				setValidationHistory(validations);
				setTotalUsers(profilesResponse.count || 0);
				initialFetched.current = true;
			} catch (err: unknown) {
				// Handle refresh token errors
				if (isSupabaseApiError(err)) {
					const errorMessage = err.message || "";
					if (errorMessage.includes('Refresh Token') || errorMessage.includes('refresh_token_not_found') || err.status === 401) {
						console.warn('Invalid refresh token detected in data fetch, user will be signed out...');
						// The UserContext will handle the sign-out via auth state change
						setError("Session expired. Please log in again.");
						return;
					}
				}
				
				const message = err instanceof Error ? err.message : "Unknown error";
				console.error("Error fetching dashboard data:", err);
				setError(`Failed to load data: ${message}`);
			} finally {
				isFetchingRef.current = false;
				setLoading(false);
			}
		},
		[isReady]
	);

	// Helper function to fetch a single scan with its profile
	const fetchScanWithProfile = useCallback(async (scanId: number): Promise<Scan | null> => {
		try {
			const { data, error } = await supabase
				.from("scans")
				.select(
					`*,
					farmer_profile:profiles!scans_farmer_id_fkey(
						id,
						username,
						full_name,
						email,
						profile_picture
					)`
				)
				.eq("id", scanId)
				.single();

			if (error) {
				console.error("Error fetching scan:", error);
				return null;
			}
			return data;
		} catch (err: unknown) {
			console.error("Error fetching scan:", err);
			return null;
		}
	}, []);

	// Helper function to fetch a single validation with its relations
	const fetchValidationWithRelations = useCallback(async (validationId: number): Promise<ValidationHistory | null> => {
		try {
			const { data, error } = await supabase
				.from("validation_history")
				.select(
					`*,
					expert_profile:profiles!validation_history_expert_id_fkey(
						id,
						username,
						full_name,
						email
					),
					scan:scans!validation_history_scan_id_fkey(
						*,
						farmer_profile:profiles!scans_farmer_id_fkey(
							id,
							username,
							full_name,
							email,
							profile_picture
						)
					)`
				)
				.eq("id", validationId)
				.single();

			if (error) {
				console.error("Error fetching validation:", error);
				return null;
			}
			return data;
		} catch (err: unknown) {
			console.error("Error fetching validation:", err);
			return null;
		}
	}, []);

	useEffect(() => {
		if (!isReady) return;

		let channel: ReturnType<typeof supabase.channel> | null = null;

		// Wait for auth/user to be ready before first fetch to avoid empty flashes
		if (!initialFetched.current) {
			fetchData(true);
		}

		// Set up real-time subscriptions with direct state updates
		// Use a unique channel name to avoid conflicts (use user ID only, not Date.now() to avoid hydration issues)
		const channelName = `global-data-changes-${user?.id || 'anonymous'}`;
		
		try {
			channel = supabase.channel(channelName, {
				config: {
					broadcast: { self: false },
				},
			})
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "scans" },
				async (payload) => {
					// Only update if we've already fetched initial data
					if (!initialFetched.current) return;

					const newScan = payload.new as Partial<Scan>;
					if (!newScan.id) return;

					// Fetch the full scan with profile data
					const fullScan = await fetchScanWithProfile(newScan.id);
					if (fullScan) {
						setScans((prev) => {
							// Check if scan already exists (prevent duplicates)
							if (prev.some((s) => s.id === fullScan.id)) {
								return prev;
							}
							// Add new scan at the beginning and maintain order
							return [fullScan, ...prev];
						});
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "UPDATE", schema: "public", table: "scans" },
				async (payload) => {
					if (!initialFetched.current) return;

					const updatedScan = payload.new as Partial<Scan>;
					if (!updatedScan.id) return;

					// Fetch the full scan with profile data
					const fullScan = await fetchScanWithProfile(updatedScan.id);
					if (fullScan) {
						setScans((prev) => {
							const index = prev.findIndex((s) => s.id === fullScan.id);
							if (index === -1) {
								// Scan doesn't exist, add it
								return [fullScan, ...prev];
							}
							// Update existing scan
							const updated = [...prev];
							updated[index] = fullScan;
							return updated;
						});
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "DELETE", schema: "public", table: "scans" },
				(payload) => {
					if (!initialFetched.current) return;

					const deletedScan = payload.old as { id?: number };
					if (deletedScan.id) {
						setScans((prev) => prev.filter((s) => s.id !== deletedScan.id));
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "validation_history" },
				async (payload) => {
					if (!initialFetched.current) return;

					const newValidation = payload.new as Partial<ValidationHistory>;
					if (!newValidation.id) return;

					// Fetch the full validation with relations
					const fullValidation = await fetchValidationWithRelations(newValidation.id);
					if (fullValidation) {
						setValidationHistory((prev) => {
							// Check if validation already exists (prevent duplicates)
							if (prev.some((v) => v.id === fullValidation.id)) {
								return prev;
							}
							// Add new validation at the beginning and maintain order
							return [fullValidation, ...prev];
						});

						// Also update the corresponding scan status if needed
						if (fullValidation.scan_id) {
							setScans((prev) => {
								const index = prev.findIndex((s) => s.id === fullValidation.scan_id);
								if (index !== -1) {
									const updated = [...prev];
									updated[index] = {
										...updated[index],
										status: fullValidation.status === "Validated" ? "Validated" : "Corrected",
										expert_validation: fullValidation.expert_validation || null,
									};
									return updated;
								}
								return prev;
							});
						}
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "UPDATE", schema: "public", table: "validation_history" },
				async (payload) => {
					if (!initialFetched.current) return;

					const updatedValidation = payload.new as Partial<ValidationHistory>;
					if (!updatedValidation.id) return;

					// Fetch the full validation with relations
					const fullValidation = await fetchValidationWithRelations(updatedValidation.id);
					if (fullValidation) {
						setValidationHistory((prev) => {
							const index = prev.findIndex((v) => v.id === fullValidation.id);
							if (index === -1) {
								// Validation doesn't exist, add it
								return [fullValidation, ...prev];
							}
							// Update existing validation
							const updated = [...prev];
							updated[index] = fullValidation;
							return updated;
						});

						// Also update the corresponding scan status if needed
						if (fullValidation.scan_id) {
							setScans((prev) => {
								const index = prev.findIndex((s) => s.id === fullValidation.scan_id);
								if (index !== -1) {
									const updated = [...prev];
									updated[index] = {
										...updated[index],
										status: fullValidation.status === "Validated" ? "Validated" : "Corrected",
										expert_validation: fullValidation.expert_validation || null,
									};
									return updated;
								}
								return prev;
							});
						}
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "DELETE", schema: "public", table: "validation_history" },
				(payload) => {
					if (!initialFetched.current) return;

					const deletedValidation = payload.old as { id?: number };
					if (deletedValidation.id) {
						setValidationHistory((prev) => prev.filter((v) => v.id !== deletedValidation.id));
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "profiles" },
				() => {
					if (!initialFetched.current) return;
					// Increment total users count
					setTotalUsers((prev) => prev + 1);
				}
			)
			.on(
				"postgres_changes",
				{ event: "DELETE", schema: "public", table: "profiles" },
				() => {
					if (!initialFetched.current) return;
					// Decrement total users count
					setTotalUsers((prev) => Math.max(0, prev - 1));
				}
			)
			.subscribe((status, err) => {
				if (status === "SUBSCRIBED") {
					// Successfully subscribed
				} else if (status === "CHANNEL_ERROR") {
					const errorMessage = err?.message || "Unknown error";
					console.error("Error subscribing to real-time data changes:", errorMessage);
					if (err) {
						console.error("Full error:", err);
					}
					// Check if error is related to Realtime not being enabled
					if (errorMessage.includes("realtime") || errorMessage.includes("publication") || errorMessage.includes("not enabled")) {
						console.warn("⚠️ Realtime may not be enabled on your tables. Please run realtime_setup.sql in your Supabase SQL Editor.");
					}
					// Fallback to periodic refresh if real-time fails
					if (initialFetched.current) {
						fetchData();
					}
				} else if (status === "TIMED_OUT" || status === "CLOSED") {
					console.warn("Real-time connection lost, attempting to refresh data");
					// Refresh data when connection is lost
					if (initialFetched.current) {
						fetchData();
					}
				}
			});
		} catch (error: unknown) {
			console.error("Error setting up real-time subscription:", error);
			// Fallback to periodic refresh
			if (initialFetched.current) {
				fetchData();
			}
		}

		return () => {
			if (channel) {
				supabase.removeChannel(channel);
			}
		};
	}, [isReady, fetchData, fetchScanWithProfile, fetchValidationWithRelations, user?.id]);

	useEffect(() => {
		if (typeof document === "undefined") return;

		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				void fetchData();
			}
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [fetchData]);

	const removeScanFromState = useCallback((scanId: number) => {
		setScans((prev) => prev.filter((scan) => scan.id !== scanId));
	}, []);

	// Memoize context value to prevent unnecessary re-renders
	const value: DataContextValue = useMemo(
		() => ({
			scans,
			validationHistory,
			totalUsers,
			loading,
			error,
			refreshData: fetchData,
			removeScanFromState,
		}),
		[scans, validationHistory, totalUsers, loading, error, fetchData, removeScanFromState]
	);

	// Clear cached data immediately when the user logs out to avoid stale flashes
	useEffect(() => {
		if (!user) {
			setScans([]);
			setValidationHistory([]);
			setTotalUsers(0);
			initialFetched.current = false;
			setLoading(false);
			setError(null);
		}
	}, [user]);

	return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
	const context = useContext(DataContext);
	if (!context) {
		throw new Error("useData must be used within a DataProvider");
	}
	return context;
}


