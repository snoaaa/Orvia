import type { AppLocale } from "@/models/preferences";
import { loadSavedLocale, saveLocale } from "@/services/storage";
import * as Localization from "expo-localization";
import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { en } from "./en";
import { fr } from "./fr";

type DeepStringRecord<T> = {
  readonly [K in keyof T]: T[K] extends readonly string[]
    ? readonly string[]
    : T[K] extends Record<string, unknown>
      ? DeepStringRecord<T[K]>
      : string;
};

export type AppTranslations = DeepStringRecord<typeof fr>;

const DICTIONARIES: Record<AppLocale, AppTranslations> = {
  fr,
  en,
};

export function resolveDefaultLocale(): AppLocale {
  try {
    const locales = Localization.getLocales();
    const first = locales[0]?.languageCode?.toLowerCase();
    if (first === "fr") return "fr";
  } catch {
    // Default to French when locale detection fails.
  }
  return "fr";
}

export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : `{{${key}}}`,
  );
}

interface I18nContextValue {
  locale: AppLocale;
  translations: AppTranslations;
  setLocale: (next: AppLocale) => Promise<void>;
  format: (template: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => resolveDefaultLocale());

  useEffect(() => {
    let active = true;
    loadSavedLocale()
      .then((saved) => {
        if (active && saved) {
          setLocaleState(saved);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback(async (next: AppLocale) => {
    setLocaleState(next);
    await saveLocale(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      translations: DICTIONARIES[locale],
      setLocale,
      format: interpolate,
    }),
    [locale, setLocale],
  );

  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n() {
  const ctx = use(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
