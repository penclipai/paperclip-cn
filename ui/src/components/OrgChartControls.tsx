import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "./ui/button";

export interface OrgChartActions {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

/** Shared camera controls can stay mounted while the chart view fades away. */
export function OrgChartControls({ zoomIn, zoomOut, fit, children }: OrgChartActions & { children?: ReactNode }) {
  const { t } = useTranslation();
  const zoomOutLabel = t("orgChart.controls.zoomOut", { defaultValue: "Zoom out" });
  const zoomInLabel = t("orgChart.controls.zoomIn", { defaultValue: "Zoom in" });
  const fitLabel = t("orgChart.controls.fitToScreen", { defaultValue: "Fit chart to screen" });
  return (
    <div className="org-chart-controls flex items-center gap-2" role="group" aria-label={t("orgChart.controls.ariaLabel", { defaultValue: "Org chart controls" })}>
      <div className="design-view-toggle" role="group" aria-label={t("orgChart.controls.camera", { defaultValue: "Chart camera" })}>
        <Button variant="ghost" size="icon-sm" className="design-toolbar-icon" aria-label={zoomOutLabel} title={zoomOutLabel} onClick={zoomOut}><Minus className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" className="design-toolbar-icon" aria-label={zoomInLabel} title={zoomInLabel} onClick={zoomIn}><Plus className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" className="design-toolbar-icon" aria-label={fitLabel} title={fitLabel} onClick={fit}><Maximize2 className="size-4" /></Button>
      </div>
      {children}
    </div>
  );
}
