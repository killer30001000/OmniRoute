"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getBarColor } from "../utils";
import { translateUsageOrFallback } from "../i18nFallback";

interface KiloPassMeterProps {
  base: number;
  bonus: number;
  used: number;
  total: number;
  remaining: number;
  nextBillingAt?: string | null;
  balance?: number | null;
}

function formatCurrency(value: number, currency: string = "USD"): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function calculateDaysUntil(dateString: string | null | undefined): number | null {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return null;
    const now = Date.now();
    const diff = date.getTime() - now;
    if (diff <= 0) return null;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

export default function KiloPassMeter({
  base,
  bonus,
  used,
  total,
  remaining,
  nextBillingAt,
  balance,
}: KiloPassMeterProps) {
  const t = useTranslations("usage");
  const locale = useLocale();

  const model = useMemo(() => {
    const paid = Math.max(0, base);
    const bonusAmount = Math.max(0, bonus);
    const usedAmount = Math.max(0, used);
    const totalAmount = Math.max(0, total);
    const remainingAmount = Math.max(0, remaining);

    const boundary = totalAmount > 0 ? (paid / totalAmount) * 100 : 0;
    const usedPercent = totalAmount > 0 ? Math.min(100, (usedAmount / totalAmount) * 100) : 0;

    return {
      paid: paid,
      bonus: bonusAmount,
      used: usedAmount,
      total: totalAmount,
      remaining: remainingAmount,
      progressValue: Math.min(totalAmount, usedAmount),
      boundary,
      paidFill: Math.min(usedPercent, boundary),
      bonusFill: Math.max(0, usedPercent - boundary),
      usedPercent,
    };
  }, [base, bonus, used, total, remaining]);

  const colors = getBarColor(100 - model.usedPercent);
  const daysUntilRenewal = calculateDaysUntil(nextBillingAt);
  const renewalDate = nextBillingAt
    ? new Date(nextBillingAt).toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-2 py-2">
      {/* Header: Usage / Total */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-text-main">
          {translateUsageOrFallback(t, "kiloPassUsageLabel", "This month's usage")}
        </span>
        <span className="text-[12px] font-bold tabular-nums" style={{ color: colors.text }}>
          {formatCurrency(model.used)} / {formatCurrency(model.total)}
        </span>
      </div>

      {/* Progress bar with paid/bonus segments */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={model.total}
        aria-valuenow={model.progressValue}
        aria-valuetext={`${formatCurrency(model.used)} of ${formatCurrency(model.total)}`}
        aria-label={translateUsageOrFallback(t, "kiloPassMeterLabel", "Kilo Pass usage meter")}
        className="relative h-2 rounded-full overflow-hidden bg-black/[0.06] dark:bg-white/[0.06]"
      >
        {/* Paid segment background */}
        <div
          className="absolute inset-y-0 left-0 bg-green-500/20"
          style={{ width: `${model.boundary}%` }}
          aria-hidden="true"
        />
        {/* Bonus segment background */}
        {model.bonus > 0 && (
          <div
            className="absolute inset-y-0 bg-blue-500/20"
            style={{ left: `${model.boundary}%`, width: `${100 - model.boundary}%` }}
            aria-hidden="true"
          />
        )}
        {/* Paid fill */}
        <div
          className="absolute inset-y-0 left-0 bg-green-500 transition-[width] duration-300 ease-out"
          style={{ width: `${model.paidFill}%` }}
          aria-hidden="true"
        />
        {/* Bonus fill */}
        {model.bonusFill > 0 && (
          <div
            className="absolute inset-y-0 bg-blue-500 transition-[width] duration-300 ease-out"
            style={{ left: `${model.boundary}%`, width: `${model.bonusFill}%` }}
            aria-hidden="true"
          />
        )}
        {/* Boundary marker */}
        {model.bonus > 0 && (
          <div
            className="absolute inset-y-0 w-px bg-border"
            style={{ left: `${model.boundary}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Amounts breakdown */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-main">
        <div className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-green-500" aria-hidden="true" />
          <span>{translateUsageOrFallback(t, "kiloPassPaid", "Paid")}</span>
          <span className="font-semibold tabular-nums">{formatCurrency(model.paid)}</span>
        </div>
        {model.bonus > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-full bg-blue-500" aria-hidden="true" />
            <span>{translateUsageOrFallback(t, "kiloPassBonus", "Available bonus")}</span>
            <span className="font-semibold tabular-nums">{formatCurrency(model.bonus)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span
            className="material-symbols-outlined text-[13px] text-text-muted"
            aria-hidden="true"
          >
            account_balance_wallet
          </span>
          <span>{translateUsageOrFallback(t, "kiloPassRemaining", "Remaining")}</span>
          <span className="font-semibold tabular-nums">{formatCurrency(model.remaining)}</span>
        </div>
      </div>

      {/* Renewal info */}
      {daysUntilRenewal !== null && renewalDate && (
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
            schedule
          </span>
          <span>
            {translateUsageOrFallback(t, "kiloPassRenews", "Renews in {count} days", {
              count: daysUntilRenewal,
            })}
          </span>
          <span className="tabular-nums">({renewalDate})</span>
        </div>
      )}

      {/* Account Balance (separate from Kilo Pass) */}
      {balance !== null && balance !== undefined && (
        <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span
              className="material-symbols-outlined text-[13px] text-text-muted"
              aria-hidden="true"
            >
              payments
            </span>
            <span className="text-text-main">
              {translateUsageOrFallback(t, "kiloAccountBalance", "Account Balance")}
            </span>
          </div>
          <span className="font-semibold tabular-nums text-text-main">
            {formatCurrency(balance)}
          </span>
        </div>
      )}
    </div>
  );
}
