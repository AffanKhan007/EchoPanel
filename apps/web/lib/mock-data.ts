import summaryValues from "@/data/summary-values.json";
import items from "@/data/items.json";
import chartData from "@/data/chart-data.json";
import alerts from "@/data/alerts.json";
import type {
  AlertItem,
  ChartPoint,
  DashboardItem,
  SummaryValue,
} from "@/lib/types";

export const summaryCards = summaryValues as SummaryValue[];
export const dashboardItems = items as DashboardItem[];
export const chartPoints = chartData as ChartPoint[];
export const alertFeed = alerts as AlertItem[];

