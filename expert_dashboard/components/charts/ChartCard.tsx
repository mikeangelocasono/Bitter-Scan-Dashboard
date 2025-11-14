import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ReactNode } from "react";

export default function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-3 border-b border-gray-100">
        <CardTitle className="text-base font-semibold text-gray-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  );
}


