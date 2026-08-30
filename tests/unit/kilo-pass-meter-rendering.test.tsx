// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/quotaParsing";
import QuotaCardExpanded from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/parts/QuotaCardExpanded";

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () =>
    Object.assign(
      (key: string, values?: { count?: number; pct?: number }) => {
        if (key === "kiloPassUsageLabel") return "This month's usage";
        if (key === "kiloPassPaid") return "Paid";
        if (key === "kiloPassBonus") return "Available bonus";
        if (key === "kiloPassRemaining") return "Remaining";
        if (key === "kiloAccountBalance") return "Account Balance";
        if (key === "percentLeft") return `${values?.pct}% left`;
        return key;
      },
      { has: () => true }
    ),
}));

const rawKilocodeUsage = {
  quotas: {
    balance: {
      remaining: 11.51,
      remainingPercentage: 100,
      currency: "USD",
      displayName: "Personal Balance",
      unlimited: true,
    },
    kiloPassBase: {
      total: 49,
      remaining: 49,
      resetAt: "2030-09-15T00:00:00.000Z",
    },
    kiloPassBonus: { total: 24.5, remaining: 24.5 },
    kiloPassUsage: {
      used: 73.55,
      total: 73.5,
      resetAt: "2030-09-15T00:00:00.000Z",
    },
    kiloPassRemaining: { remaining: 0, total: 73.5 },
  },
};

describe("Kilo Pass meter production render path", () => {
  it("renders the dedicated meter rather than a generic 0% left quota row", () => {
    const quotas = parseQuotaData("kilocode", rawKilocodeUsage);
    const kiloPass = quotas.find((quota) => quota.kiloPass);

    expect(kiloPass).toMatchObject({
      name: "kiloPass",
      kiloPass: true,
      kiloPassBase: 49,
      kiloPassBonus: 24.5,
      used: 73.55,
      total: 73.5,
      remaining: 0,
      kiloPassBalance: 11.51,
    });

    const html = renderToStaticMarkup(
      <QuotaCardExpanded
        quotas={quotas}
        providerId="kilocode"
        loading={false}
        error={null}
        hasStaleData={false}
        onRefresh={() => {}}
        onOpenCutoff={() => {}}
        onOpenCost={() => {}}
        canEditCutoff={false}
        hasCutoffOverrides={false}
      />
    );

    expect(html).toContain("This month&#x27;s usage");
    expect(html).toContain("Paid");
    expect(html).toContain("Available bonus");
    expect(html).toContain("Remaining");
    expect(html).toContain("Account Balance");
    expect(html).toContain("$73.55");
    expect(html).toContain("$73.50");
    expect(html).toContain('aria-valuemax="73.5"');
    expect(html).toContain('aria-valuenow="73.5"');
    expect(html).not.toContain("0% left");
  });
});
