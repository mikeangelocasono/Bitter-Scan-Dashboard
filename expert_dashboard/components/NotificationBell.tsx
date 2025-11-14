"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNotifications } from "./NotificationContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Scan } from "../types";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

export default function NotificationBell() {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const { pendingScans, unreadCount, loading, markScansAsRead } = useNotifications();
	const [recentPendingScans, setRecentPendingScans] = useState<Scan[]>([]);
	const router = useRouter();

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener("mousedown", handleClickOutside);
		}

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [isOpen]);

	// Mark scans as read when the dropdown opens
	useEffect(() => {
		if (!isOpen || recentPendingScans.length === 0) return;

		markScansAsRead(recentPendingScans.map((scan) => scan.id));
	}, [isOpen, recentPendingScans, markScansAsRead]);

	// Sort pending scans by creation date (newest first) and limit to 10
	useEffect(() => {
		const sorted = [...pendingScans]
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
			.slice(0, 10);
		setRecentPendingScans(sorted);
	}, [pendingScans]);

	const handleNotificationClick = useCallback(
		(scanId: number) => {
			setIsOpen(false);
			// Navigate to validate page
			router.push("/validate");
		},
		[router]
	);

	const formatDate = useCallback((dateString: string) => {
		try {
			return DATE_FORMATTER.format(new Date(dateString));
		} catch {
			return dateString;
		}
	}, []);

	return (
		<div className="relative" ref={dropdownRef}>
			<button
				onClick={() => setIsOpen(!isOpen)}
				className="relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
				aria-label="Notifications"
			>
				<Bell className="h-5 w-5 text-gray-600" />
				{unreadCount > 0 && (
					<motion.span
						initial={{ scale: 0 }}
						animate={{ scale: 1 }}
						className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-xs font-semibold rounded-full"
					>
						{unreadCount > 99 ? "99+" : unreadCount}
					</motion.span>
				)}
			</button>

			<AnimatePresence>
				{isOpen && (
					<motion.div
						initial={{ opacity: 0, y: -10, scale: 0.95 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: -10, scale: 0.95 }}
						transition={{ duration: 0.2 }}
						className="absolute right-0 mt-2 w-96 bg-[var(--surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-50 overflow-hidden"
					>
						{/* Header */}
						<div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
							<h3 className="text-sm font-semibold text-[var(--foreground)]">
								Pending Scans {unreadCount > 0 && `(${unreadCount})`}
							</h3>
						</div>

						{/* Notifications List */}
						<div className="max-h-96 overflow-y-auto">
							{loading ? (
								<div className="flex items-center justify-center py-8">
									<div className="h-6 w-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
								</div>
							) : recentPendingScans.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
									<Bell className="h-12 w-12 text-gray-300 mb-2" />
									<p className="text-sm text-gray-500">No pending scans</p>
									<p className="text-xs text-gray-400 mt-1">All scans have been validated</p>
								</div>
							) : (
								<div className="divide-y divide-[var(--color-border)]">
									{recentPendingScans.map((scan) => {
										const farmerName =
											scan.farmer_profile?.full_name ||
											scan.farmer_profile?.username ||
											"Unknown Farmer";
										const scanTypeLabel =
											scan.scan_type === "leaf_disease"
												? "Leaf Disease"
											: scan.scan_type === "fruit_maturity"
												? "Fruit Maturity"
											: "Unknown Type";

										return (
											<button
												key={scan.id}
												onClick={() => handleNotificationClick(scan.id)}
												className="w-full text-left p-4 hover:bg-gray-50 transition-colors bg-blue-50/50"
											>
												<div className="flex items-start gap-3">
													<div className="flex-1 min-w-0">
														<p className="text-sm font-semibold text-gray-900 truncate">{farmerName}</p>
														<p className="text-xs text-gray-600 mt-1">{scanTypeLabel}</p>
														<p className="text-xs text-gray-400 mt-1">{formatDate(scan.created_at)}</p>
													</div>
													<ExternalLink className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
												</div>
											</button>
										);
									})}
								</div>
							)}
						</div>

						{/* Footer */}
						{recentPendingScans.length > 0 && (
							<div className="p-3 border-t border-[var(--color-border)] bg-gray-50">
								<Link
									href="/validate"
									onClick={() => setIsOpen(false)}
									className="block text-center text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 font-medium transition-colors"
								>
									View all pending scans ({unreadCount})
								</Link>
							</div>
						)}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

