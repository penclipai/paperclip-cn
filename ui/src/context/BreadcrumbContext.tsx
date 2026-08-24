import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BRAND_NAME } from "../lib/branding";

export interface Breadcrumb {
  label: string;
  href?: string;
  /**
   * Optional task identifier (e.g. "PAP-1204") rendered in gray monospace
   * between the leading glyph and the label.
   */
  identifier?: string;
  /** Optional node rendered before the label (e.g. a status glyph). */
  leading?: ReactNode;
  /**
   * Stable identity for `leading` so equality/diffing works without comparing
   * React nodes by reference (which always differ across renders). Set this to
   * a primitive that changes only when the rendered `leading` should change.
   */
  leadingKey?: string;
}

interface BreadcrumbContextValue {
  breadcrumbs: Breadcrumb[];
  setBreadcrumbs: (crumbs: Breadcrumb[]) => void;
  mobileToolbar: ReactNode | null;
  setMobileToolbar: (node: ReactNode | null) => void;
}

interface BreadcrumbProviderProps {
  children: ReactNode;
  companyName?: string | null;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

function breadcrumbsEqual(left: Breadcrumb[], right: Breadcrumb[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index]?.label !== right[index]?.label
      || left[index]?.href !== right[index]?.href
      || left[index]?.identifier !== right[index]?.identifier
      || left[index]?.leadingKey !== right[index]?.leadingKey
    ) {
      return false;
    }
  }
  return true;
}

export function buildDocumentTitle(breadcrumbs: Breadcrumb[], companyName?: string | null) {
  const pageParts = breadcrumbs.length === 0
    ? []
    : [...breadcrumbs].reverse().map((breadcrumb) => breadcrumb.label);
  const companyPart = companyName?.trim() ? [companyName.trim()] : [];
  const parts = [...pageParts, ...companyPart, BRAND_NAME];
  return parts.join(" • ");
}

export function BreadcrumbProvider({ children, companyName }: BreadcrumbProviderProps) {
  const [breadcrumbs, setBreadcrumbsState] = useState<Breadcrumb[]>([]);
  const { i18n } = useTranslation();
  const [mobileToolbar, setMobileToolbarState] = useState<ReactNode | null>(null);

  const setBreadcrumbs = useCallback((crumbs: Breadcrumb[]) => {
    setBreadcrumbsState((current) => (breadcrumbsEqual(current, crumbs) ? current : crumbs));
  }, []);

  const setMobileToolbar = useCallback((node: ReactNode | null) => {
    setMobileToolbarState(node);
  }, []);

  useEffect(() => {
    document.title = buildDocumentTitle(breadcrumbs, companyName);
  }, [breadcrumbs, companyName, i18n.resolvedLanguage, i18n.language]);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, setBreadcrumbs, mobileToolbar, setMobileToolbar }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbs() {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) {
    throw new Error("useBreadcrumbs must be used within BreadcrumbProvider");
  }
  return ctx;
}
