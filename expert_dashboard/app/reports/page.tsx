"use client";

import { motion } from "framer-motion";
import { useMemo, useState, useEffect } from "react";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, TrendingUp, Activity, PieChart, Camera, CheckCircle2 } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import ChartCard from "@/components/charts/ChartCard";
import { useData } from "@/components/DataContext";

import type { Scan, ValidationHistory } from "@/types";

type Range = "daily" | "weekly" | "monthly";

type TrendDatum = {
  period: string;
  scans: number;
};

type ValidationDatum = {
  period: string;
  validated: number;
  corrected: number;
};

const COLORS = ["#388E3C", "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6", "#10B981"];
const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];
const RANGE_LABELS: Record<Range, string> = {
  daily: "Today",
  weekly: "This Week",
  monthly: "This Month",
};

const ONE_DAY = 24 * 60 * 60 * 1000;
const HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", { hour: "numeric" });
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const VALIDATED_GRADIENT_ID = "reports-validated-gradient";
const CORRECTED_GRADIENT_ID = "reports-corrected-gradient";

function normalizeToStartOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getRangeStart(range: Range) {
  const now = normalizeToStartOfDay(new Date());
  if (range === "daily") {
    return now;
  }
  if (range === "weekly") {
    const start = new Date(now);
    const day = start.getDay();
    start.setDate(start.getDate() - day);
    return start;
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function buildScansTrend(range: Range, scans: Scan[], rangeStart: Date, rangeEnd: Date): TrendDatum[] {
  if (!scans || scans.length === 0) {
    // Return empty array with at least one entry for daily to show empty state
    if (range === "daily") {
      return [{ period: "12 AM", scans: 0 }];
    }
    return [];
  }

  if (range === "daily") {
    const base = normalizeToStartOfDay(rangeStart);
    const isToday = rangeEnd.toDateString() === base.toDateString();
    const currentHour = isToday ? Math.min(rangeEnd.getHours() + 1, 24) : 24;
    const counts = new Map<number, number>();

    scans.forEach((scan) => {
      if (!scan.created_at) return;
      try {
        const createdAt = new Date(scan.created_at);
        if (isNaN(createdAt.getTime())) return;
        if (createdAt < base || createdAt > rangeEnd) return;
        const hour = createdAt.getHours();
        counts.set(hour, (counts.get(hour) ?? 0) + 1);
      } catch {
        // Skip invalid dates
        return;
      }
    });

    return Array.from({ length: Math.max(currentHour, 1) }, (_, hour) => {
      const stamp = new Date(base);
      stamp.setHours(hour);
      return {
        period: HOUR_FORMATTER.format(stamp),
        scans: counts.get(hour) ?? 0,
      };
    });
  }

  const startDay = normalizeToStartOfDay(rangeStart);
  const endDay = normalizeToStartOfDay(rangeEnd);
  const totalDays = Math.max(1, Math.floor((endDay.getTime() - startDay.getTime()) / ONE_DAY) + 1);

  const bucketCounts = new Map<number, number>();
  scans.forEach((scan) => {
    if (!scan.created_at) return;
    try {
      const createdAt = new Date(scan.created_at);
      if (isNaN(createdAt.getTime())) return;
      if (createdAt < startDay || createdAt > rangeEnd) return;
      const dayIndex = Math.floor((normalizeToStartOfDay(createdAt).getTime() - startDay.getTime()) / ONE_DAY);
      if (dayIndex < 0 || dayIndex >= totalDays) return;
      bucketCounts.set(dayIndex, (bucketCounts.get(dayIndex) ?? 0) + 1);
    } catch {
      // Skip invalid dates
      return;
    }
  });

  if (range === "weekly") {
    const buckets = Math.min(7, totalDays);
    return Array.from({ length: buckets }, (_, idx) => {
      const stamp = new Date(startDay);
      stamp.setDate(startDay.getDate() + idx);
      return {
        period: WEEKDAY_FORMATTER.format(stamp),
        scans: bucketCounts.get(idx) ?? 0,
      };
    });
  }

  // Monthly
  return Array.from({ length: totalDays }, (_, idx) => {
    const stamp = new Date(startDay);
    stamp.setDate(startDay.getDate() + idx);
    return {
      period: DAY_FORMATTER.format(stamp),
      scans: bucketCounts.get(idx) ?? 0,
    };
  });
}

function buildValidationActivity(
  range: Range,
  validations: ValidationHistory[],
  rangeStart: Date,
  rangeEnd: Date
): ValidationDatum[] {
  if (!validations || validations.length === 0) {
    // Return empty array with at least one entry for daily to show empty state
    if (range === "daily") {
      return [{ period: "12 AM", validated: 0, corrected: 0 }];
    }
    return [];
  }

  if (range === "daily") {
    const base = normalizeToStartOfDay(rangeStart);
    const isToday = rangeEnd.toDateString() === base.toDateString();
    const currentHour = isToday ? Math.min(rangeEnd.getHours() + 1, 24) : 24;
    const counts = new Map<number, { validated: number; corrected: number }>();

    validations.forEach((record) => {
      if (!record.validated_at) return;
      try {
        const validatedAt = new Date(record.validated_at);
        if (isNaN(validatedAt.getTime())) return;
        if (validatedAt < base || validatedAt > rangeEnd) return;
        const hour = validatedAt.getHours();
        const bucket = counts.get(hour) ?? { validated: 0, corrected: 0 };
        if (record.status === "Validated") {
          bucket.validated += 1;
        } else if (record.status === "Corrected") {
          bucket.corrected += 1;
        }
        counts.set(hour, bucket);
      } catch {
        // Skip invalid dates
        return;
      }
    });

    return Array.from({ length: Math.max(currentHour, 1) }, (_, hour) => {
      const stamp = new Date(base);
      stamp.setHours(hour);
      const bucket = counts.get(hour);
      return {
        period: HOUR_FORMATTER.format(stamp),
        validated: bucket?.validated ?? 0,
        corrected: bucket?.corrected ?? 0,
      };
    });
  }

  const startDay = normalizeToStartOfDay(rangeStart);
  const endDay = normalizeToStartOfDay(rangeEnd);
  const totalDays = Math.max(1, Math.floor((endDay.getTime() - startDay.getTime()) / ONE_DAY) + 1);
  const counts = new Map<number, { validated: number; corrected: number }>();

  validations.forEach((record) => {
    if (!record.validated_at) return;
    try {
      const validatedAt = new Date(record.validated_at);
      if (isNaN(validatedAt.getTime())) return;
      if (validatedAt < startDay || validatedAt > rangeEnd) return;
      const dayIndex = Math.floor((normalizeToStartOfDay(validatedAt).getTime() - startDay.getTime()) / ONE_DAY);
      if (dayIndex < 0 || dayIndex >= totalDays) return;
      const bucket = counts.get(dayIndex) ?? { validated: 0, corrected: 0 };
      if (record.status === "Validated") {
        bucket.validated += 1;
      } else if (record.status === "Corrected") {
        bucket.corrected += 1;
      }
      counts.set(dayIndex, bucket);
    } catch {
      // Skip invalid dates
      return;
    }
  });

  if (range === "weekly") {
    const buckets = Math.min(7, totalDays);
    return Array.from({ length: buckets }, (_, idx) => {
      const stamp = new Date(startDay);
      stamp.setDate(startDay.getDate() + idx);
      const bucket = counts.get(idx);
      return {
        period: WEEKDAY_FORMATTER.format(stamp),
        validated: bucket?.validated ?? 0,
        corrected: bucket?.corrected ?? 0,
      };
    });
  }

  // Monthly
  return Array.from({ length: totalDays }, (_, idx) => {
    const stamp = new Date(startDay);
    stamp.setDate(startDay.getDate() + idx);
    const bucket = counts.get(idx);
    return {
      period: DAY_FORMATTER.format(stamp),
      validated: bucket?.validated ?? 0,
      corrected: bucket?.corrected ?? 0,
    };
  });
}

export default function ReportsPage() {
  const { scans, validationHistory, loading, error, refreshData } = useData();
  const [range, setRange] = useState<Range>("daily");

  // Debug: Log data availability (only in development)
  useEffect(() => {
    if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
      console.debug("Reports Page Data:", {
        scansCount: scans?.length || 0,
        validationsCount: validationHistory?.length || 0,
        loading,
        error,
        range,
      });
    }
  }, [scans, validationHistory, loading, error, range]);

  const rangeStart = useMemo(() => getRangeStart(range), [range]);
  // Update rangeEnd when data changes to ensure real-time updates, but normalize to end of day
  const rangeEnd = useMemo(() => {
    const end = new Date();
    // For daily range, set to end of current day
    if (range === "daily") {
      end.setHours(23, 59, 59, 999);
    } else {
      // For weekly/monthly, set to current moment
      end.setHours(end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds());
    }
    return end;
  }, [range, scans, validationHistory]);

  const filteredScans = useMemo(() => {
    if (!scans || scans.length === 0) return [];
    
    return scans.filter((scan) => {
      if (!scan.created_at) return false;
      try {
        const createdAt = new Date(scan.created_at);
        // Ensure valid date
        if (isNaN(createdAt.getTime())) return false;
        // Compare dates properly (rangeStart is start of day, rangeEnd is end of day or current time)
        return createdAt >= rangeStart && createdAt <= rangeEnd;
      } catch {
        return false;
      }
    });
  }, [scans, rangeStart, rangeEnd]);

  const filteredValidations = useMemo(() => {
    if (!validationHistory || validationHistory.length === 0) return [];
    
    return validationHistory.filter((record) => {
      if (!record.validated_at) return false;
      try {
        const validatedAt = new Date(record.validated_at);
        // Ensure valid date
        if (isNaN(validatedAt.getTime())) return false;
        // Compare dates properly
        return validatedAt >= rangeStart && validatedAt <= rangeEnd;
      } catch {
        return false;
      }
    });
  }, [validationHistory, rangeStart, rangeEnd]);

  const aiAccuracyRate = useMemo(() => {
    // AI Accuracy Rate = (Validated scans) / (Validated + Corrected scans) * 100
    // Only count scans that have been validated (not pending)
    const validatedCount = filteredScans.filter((s) => s.status === "Validated").length;
    const correctedCount = filteredScans.filter((s) => s.status === "Corrected").length;
    const total = validatedCount + correctedCount;
    
    if (total === 0) {
      // If no validated scans in range, return 0
      return 0;
    }
    
    const rate = (validatedCount / total) * 100;
    return parseFloat(rate.toFixed(1));
  }, [filteredScans]);

  // Calculate validated scans: Total Scans - Pending
  const validatedScansCount = useMemo(() => {
    const total = filteredScans.length;
    const pending = filteredScans.filter((s) => s.status === "Pending Validation").length;
    return total - pending;
  }, [filteredScans]);

  const scansTrend = useMemo(() => buildScansTrend(range, filteredScans, rangeStart, rangeEnd), [range, filteredScans, rangeStart, rangeEnd]);
	const validationActivity = useMemo(
    () => buildValidationActivity(range, filteredValidations, rangeStart, rangeEnd),
    [range, filteredValidations, rangeStart, rangeEnd]
  );

  const diseaseDistribution = useMemo(() => {
    if (!filteredScans || filteredScans.length === 0) return [];
    
    const counts = filteredScans
      .filter((scan) => scan.scan_type === "leaf_disease" && scan.ai_prediction)
      .reduce(
        (acc, scan) => {
          try {
            const prediction = String(scan.ai_prediction).toLowerCase();
            if (prediction.includes("cercospora")) acc.Cercospora += 1;
            else if (prediction.includes("downy") || prediction.includes("mildew")) acc["Downy Mildew"] += 1;
            else if (prediction.includes("mosaic") || prediction.includes("virus")) acc["Yellow Mosaic Virus"] += 1;
            else if (prediction.includes("healthy")) acc.Healthy += 1;
            else acc.Unknown += 1;
          } catch {
            acc.Unknown += 1;
          }
          return acc;
        },
        { Cercospora: 0, "Downy Mildew": 0, "Yellow Mosaic Virus": 0, Healthy: 0, Unknown: 0 }
      );

    return Object.entries(counts)
      .filter(([_, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [filteredScans]);

  const ripenessDistribution = useMemo(() => {
    if (!filteredScans || filteredScans.length === 0) return [];
    
    const counts = filteredScans
      .filter((scan) => scan.scan_type === "fruit_maturity" && scan.ai_prediction)
      .reduce(
        (acc, scan) => {
          try {
            const prediction = String(scan.ai_prediction).toLowerCase();
            if (prediction.includes("immature")) acc.Immature += 1;
            else if (prediction.includes("mature") && !prediction.includes("over")) acc.Mature += 1;
            else if (prediction.includes("overmature")) acc.Overmature += 1;
            else if (prediction.includes("overripe")) acc.Overripe += 1;
            else acc.Unknown += 1;
          } catch {
            acc.Unknown += 1;
          }
          return acc;
        },
        { Immature: 0, Mature: 0, Overmature: 0, Overripe: 0, Unknown: 0 }
      );

    return Object.entries(counts)
      .filter(([_, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [filteredScans]);

  if (loading) {
    return (
      <AuthGuard>
        <AppShell>
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <Loader2 className="h-12 w-12 animate-spin text-gray-500 mx-auto mb-4" />
              <p className="text-gray-600">Loading reports...</p>
            </div>
          </div>
        </AppShell>
      </AuthGuard>
    );
  }

  if (error) {
    return (
      <AuthGuard>
        <AppShell>
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <p className="text-red-600 font-medium mb-4">{error}</p>
              <Button variant="outline" onClick={() => refreshData(true)}>
                Try Again
              </Button>
            </div>
          </div>
        </AppShell>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Reports &amp; Analytics</h2>
              <p className="text-gray-600 mt-1 text-sm">Comprehensive insights into scan activity and AI performance</p>
            </div>
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
              {RANGE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={range === option.value ? "default" : "ghost"}
                  size="sm"
                  className={`text-sm font-medium ${range === option.value ? "bg-[#388E3C] text-white hover:bg-[#2F7A33]" : "text-gray-700 hover:bg-gray-100"}`}
                  onClick={() => setRange(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {[
              {
                icon: TrendingUp,
                label: "AI Accuracy Rate",
                value: `${aiAccuracyRate}%`,
                color: "text-emerald-600",
              },
              {
                icon: Camera,
                label: "Total Scans",
                value: filteredScans.length.toLocaleString("en-US"),
                color: "text-emerald-600",
              },
              {
                icon: CheckCircle2,
                label: "Validated",
                value: validatedScansCount.toLocaleString("en-US"),
                color: "text-emerald-600",
              },
            ].map((metric, idx) => {
              const Icon = metric.icon;
              return (
                <Card key={idx} className="shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle>{metric.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between">
                    <p className="text-3xl font-semibold">{metric.value}</p>
                    <Icon className={`h-8 w-8 ${metric.color} flex-shrink-0`} />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <ChartCard title={`AI Accuracy Rate • ${RANGE_LABELS[range]}`}>
            {(() => {
              let level = "Needs Improvement";
              let color = "#ef4444";
              if (aiAccuracyRate >= 90) {
                level = "Excellent";
                color = "#22c55e";
              } else if (aiAccuracyRate >= 75) {
                level = "Good";
                color = "#3b82f6";
              } else if (aiAccuracyRate >= 50) {
                level = "Average";
                color = "#f59e0b";
              }

              const pieData = [
                { name: "Accuracy", value: aiAccuracyRate },
                { name: "Remaining", value: Math.max(0, 100 - aiAccuracyRate) },
              ];

              return (
                <div className="flex flex-col gap-5">
                  <div className="w-full">
                    <div className="relative mx-auto" style={{ maxWidth: 380 }}>
                      <ResponsiveContainer width="100%" height={260}>
                        <RechartsPieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={65}
                            outerRadius={100}
                            startAngle={90}
                            endAngle={-270}
                            paddingAngle={2}
                            dataKey="value"
                            isAnimationActive={true}
                            animationDuration={800}
                          >
                            <Cell key="accuracy" fill={color} stroke="#fff" strokeWidth={2} />
                            <Cell key="remaining" fill="#e5e7eb" stroke="#fff" strokeWidth={2} />
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]}
                            contentStyle={{
                              backgroundColor: "#ffffff",
                              border: "1px solid #e5e7eb",
                              borderRadius: "6px",
                              fontSize: "12px",
                            }}
                          />
                        </RechartsPieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <p className="text-4xl font-bold text-gray-900">{aiAccuracyRate}%</p>
                        <p className="text-sm font-medium text-gray-600">{level}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="flex items-center justify-start gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#22c55e" }} />
                      <div className="text-sm">
                        <p className="font-semibold text-gray-900 leading-5">Excellent</p>
                        <p className="text-gray-600 text-xs">90%–100%</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-start gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#3b82f6" }} />
                      <div className="text-sm">
                        <p className="font-semibold text-gray-900 leading-5">Good</p>
                        <p className="text-gray-600 text-xs">75%–89%</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-start gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#f59e0b" }} />
                      <div className="text-sm">
                        <p className="font-semibold text-gray-900 leading-5">Average</p>
                        <p className="text-gray-600 text-xs">50%–74%</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-start gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#ef4444" }} />
                      <div className="text-sm">
                        <p className="font-semibold text-gray-900 leading-5">Needs Improvement</p>
                        <p className="text-gray-600 text-xs">0%–49%</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </ChartCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <ChartCard title={`Scans Trend • ${RANGE_LABELS[range]}`}>
              {scansTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={scansTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="period" stroke="#6b7280" fontSize={12} tick={{ fill: "#6b7280" }} />
                    <YAxis stroke="#6b7280" fontSize={12} tick={{ fill: "#6b7280" }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                    <Line
                      type="monotone"
                      dataKey="scans"
                      stroke="#388E3C"
                      strokeWidth={2.5}
                      name="Scans"
                      dot={{ fill: "#388E3C", r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-200/70 bg-white/80 px-6 text-center text-sm text-emerald-700">
                  <p className="font-medium">No scan trend data for {RANGE_LABELS[range].toLowerCase()} yet.</p>
                  <p className="mt-1 text-xs text-emerald-600">New scans will populate this chart automatically.</p>
                </div>
              )}
            </ChartCard>

			<ChartCard title={`Validated Activity • ${RANGE_LABELS[range]}`}>
              {validationActivity.length > 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                  className="rounded-2xl bg-gradient-to-br from-emerald-50 via-white to-emerald-100/60 p-4 shadow-inner"
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={validationActivity} margin={{ top: 10, right: 24, left: 4, bottom: 8 }}>
                      <defs>
                        <linearGradient id={VALIDATED_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#388E3C" stopOpacity={0.95} />
                          <stop offset="100%" stopColor="#79C082" stopOpacity={0.75} />
                        </linearGradient>
                        <linearGradient id={CORRECTED_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="#9BC0FF" stopOpacity={0.7} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 6" stroke="rgba(56,142,60,0.15)" />
                      <XAxis
                        dataKey="period"
                        stroke="#1f2937"
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: "rgba(56,142,60,0.2)" }}
                        tick={{ fill: "#1f2937", fontWeight: 600 }}
                      />
                      <YAxis
                        stroke="#1f2937"
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: "rgba(56,142,60,0.2)" }}
                        tick={{ fill: "#1f2937", fontWeight: 600 }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(56,142,60,0.08)" }}
                        contentStyle={{
                          backgroundColor: "#ffffff",
                          border: "1px solid rgba(56,142,60,0.1)",
                          borderRadius: "12px",
                          boxShadow: "0 12px 30px rgba(56,142,60,0.12)",
                          fontSize: "12px",
                          padding: "8px 12px",
                        }}
                        labelStyle={{ color: "#1f2937", fontWeight: 600 }}
                      />
                    <Legend
                        iconType="circle"
                        wrapperStyle={{ fontSize: "12px", paddingTop: "12px", color: "#1f2937", fontWeight: 600 }}
                      />
                      <Bar
                        dataKey="validated"
                        fill={`url(#${VALIDATED_GRADIENT_ID})`}
                        name="Validated"
                        radius={[10, 10, 10, 10]}
                        maxBarSize={40}
                      />
                      <Bar
                        dataKey="corrected"
                        fill={`url(#${CORRECTED_GRADIENT_ID})`}
                        name="Corrected"
                        radius={[10, 10, 10, 10]}
                        maxBarSize={40}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </motion.div>
              ) : (
                <div className="flex h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-200/70 bg-white/80 px-6 text-center text-sm text-emerald-700">
                  <p className="font-medium">No validation activity data for {RANGE_LABELS[range].toLowerCase()} yet.</p>
                  <p className="mt-1 text-xs text-emerald-600">Validation activities will populate this chart automatically.</p>
                </div>
              )}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <ChartCard title="Disease Distribution">
              {diseaseDistribution.length > 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                  className="rounded-2xl bg-gradient-to-br from-white via-emerald-50/60 to-white p-4"
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <RechartsPieChart>
                      <Pie
                        data={diseaseDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => {
                          const percentage = Math.round((percent ?? 0) * 100);
                          return percentage > 0 ? `${percentage}%` : "";
                        }}
                        outerRadius={110}
                        innerRadius={55}
                        dataKey="value"
                        paddingAngle={3}
                        stroke="#f5f7f5"
                        strokeWidth={2}
                      >
                        {diseaseDistribution.map((entry, index) => (
                          <Cell
                            key={`disease-${index}`}
                            fill={COLORS[index % COLORS.length]}
                            stroke={COLORS[index % COLORS.length]}
                            strokeOpacity={0.15}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        cursor={{ stroke: "rgba(56,142,60,0.15)", strokeWidth: 2 }}
                        contentStyle={{
                          backgroundColor: "#ffffff",
                          border: "1px solid rgba(56,142,60,0.12)",
                          borderRadius: "12px",
                          boxShadow: "0 12px 30px rgba(56,142,60,0.12)",
                          fontSize: "12px",
                          padding: "10px 14px",
                        }}
                        formatter={(value: number, name: string) => [
                          `${value.toLocaleString("en-US")} cases`,
                          name,
                        ]}
                      />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                  <div className="mt-5 grid grid-cols-1 gap-2 text-sm text-gray-700 md:grid-cols-2">
                    {diseaseDistribution.map((entry, index) => (
                      <div
                        key={entry.name}
                        className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white/70 px-3 py-2 shadow-sm"
                      >
                        <span
                          className="inline-flex h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="font-medium text-gray-900">{entry.name}</span>
                        <span className="ml-auto text-xs font-semibold text-emerald-600">
                          {entry.value.toLocaleString("en-US")}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <div className="flex h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-200/70 bg-white/80 px-6 text-center text-sm text-emerald-700">
                  <p className="font-medium">No disease distribution data for {RANGE_LABELS[range].toLowerCase()} yet.</p>
                  <p className="mt-1 text-xs text-emerald-600">New scans will populate this chart automatically.</p>
                </div>
              )}
            </ChartCard>

            <ChartCard title="Ripeness Distribution">
              {ripenessDistribution.length > 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.05 }}
                  className="rounded-2xl bg-gradient-to-br from-white via-emerald-50/40 to-white p-4"
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <RechartsPieChart>
                      <Pie
                        data={ripenessDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => {
                          const percentage = Math.round((percent ?? 0) * 100);
                          return percentage > 0 ? `${percentage}%` : "";
                        }}
                        outerRadius={110}
                        innerRadius={55}
                        dataKey="value"
                        paddingAngle={3}
                        stroke="#f5f7f5"
                        strokeWidth={2}
                      >
                        {ripenessDistribution.map((entry, index) => (
                          <Cell
                            key={`ripeness-${index}`}
                            fill={COLORS[index % COLORS.length]}
                            stroke={COLORS[index % COLORS.length]}
                            strokeOpacity={0.15}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        cursor={{ stroke: "rgba(56,142,60,0.15)", strokeWidth: 2 }}
                        contentStyle={{
                          backgroundColor: "#ffffff",
                          border: "1px solid rgba(56,142,60,0.12)",
                          borderRadius: "12px",
                          boxShadow: "0 12px 30px rgba(56,142,60,0.12)",
                          fontSize: "12px",
                          padding: "10px 14px",
                        }}
                        formatter={(value: number, name: string) => [
                          `${value.toLocaleString("en-US")} items`,
                          name,
                        ]}
                      />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                  <div className="mt-5 grid grid-cols-1 gap-2 text-sm text-gray-700 md:grid-cols-2">
                    {ripenessDistribution.map((entry, index) => (
                      <div
                        key={entry.name}
                        className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white/70 px-3 py-2 shadow-sm"
                      >
                        <span
                          className="inline-flex h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="font-medium text-gray-900">{entry.name}</span>
                        <span className="ml-auto text-xs font-semibold text-emerald-600">
                          {entry.value.toLocaleString("en-US")}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <div className="flex h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-200/70 bg-white/80 px-6 text-center text-sm text-emerald-700">
                  <p className="font-medium">No ripeness distribution data for {RANGE_LABELS[range].toLowerCase()} yet.</p>
                  <p className="mt-1 text-xs text-emerald-600">Collect more fruit maturity scans to see insights.</p>
                </div>
              )}
            </ChartCard>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

