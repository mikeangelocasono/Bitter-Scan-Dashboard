"use client";

import { ReactNode, createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import { Scan } from "../types";
import { useData } from "./DataContext";

type NotificationContextValue = {
	pendingScans: Scan[];
	unreadCount: number;
	loading: boolean;
	error: string | null;
	refreshNotifications: () => Promise<void>;
	markScansAsRead: (scanIds: number[]) => void;
};

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
	const { scans, loading, error, refreshData } = useData();
	const [readScanIds, setReadScanIds] = useState<Set<number>>(new Set());

	// Filter scans to get only pending validation scans (these are our "notifications")
	const pendingScans = useMemo(() => {
		if (!scans || scans.length === 0) return [];
		return scans.filter((scan) => scan.status === "Pending Validation");
	}, [scans]);

	// Drop read markers for scans that are no longer pending
	useEffect(() => {
		setReadScanIds((prev) => {
			if (prev.size === 0) return prev;

			const pendingIds = new Set(pendingScans.map((scan) => scan.id));
			let changed = false;
			const next = new Set<number>();

			prev.forEach((id) => {
				if (pendingIds.has(id)) {
					next.add(id);
				} else {
					changed = true;
				}
			});

			return changed ? next : prev;
		});
	}, [pendingScans]);

	const markScansAsRead = useCallback((scanIds: number[]) => {
		if (!scanIds || scanIds.length === 0) return;

		setReadScanIds((prev) => {
			let changed = false;
			const next = new Set(prev);

			scanIds.forEach((id) => {
				if (!next.has(id)) {
					next.add(id);
					changed = true;
				}
			});

			return changed ? next : prev;
		});
	}, []);

	// Unread count is simply the number of pending scans that haven't been marked as read yet
	const unreadCount = useMemo(() => {
		if (pendingScans.length === 0) return 0;
		return pendingScans.reduce((count, scan) => (readScanIds.has(scan.id) ? count : count + 1), 0);
	}, [pendingScans, readScanIds]);

	// Refresh function - just refresh the data context
	const refreshNotifications = useCallback(async () => {
		await refreshData();
	}, [refreshData]);

	const value: NotificationContextValue = useMemo(
		() => ({
			pendingScans,
			unreadCount,
			loading,
			error,
			refreshNotifications,
			markScansAsRead,
		}),
		[pendingScans, unreadCount, loading, error, refreshNotifications, markScansAsRead]
	);

	return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
	const context = useContext(NotificationContext);
	if (!context) {
		throw new Error("useNotifications must be used within a NotificationProvider");
	}
	return context;
}

