"use client";

import { Input, Toggle } from "@/shared/components";
import { providerText, type ProviderMessageTranslator } from "../../providerPageHelpers";

export type VertexGcpCreditFieldValues = {
  gcpCreditEnabled: boolean;
  gcpCreditTotal: string;
  gcpCreditRemaining: string;
  gcpCreditCurrency: string;
  gcpCreditExpiresAt: string;
  gcpCreditAutoEnabled: boolean;
  gcpCreditQueryProjectId: string;
  gcpCreditDatasetId: string;
  gcpCreditTableId: string;
  gcpCreditCreditId: string;
  gcpCreditCreditNameContains: string;
  gcpCreditLocation: string;
  gcpCreditMaxBytesBilled: string;
  gcpCreditBaselineRemaining: string;
  gcpCreditBaselineAsOf: string;
};

export const EMPTY_VERTEX_GCP_CREDIT_FIELDS: VertexGcpCreditFieldValues = {
  gcpCreditEnabled: false,
  gcpCreditTotal: "",
  gcpCreditRemaining: "",
  gcpCreditCurrency: "USD",
  gcpCreditExpiresAt: "",
  gcpCreditAutoEnabled: false,
  gcpCreditQueryProjectId: "",
  gcpCreditDatasetId: "",
  gcpCreditTableId: "",
  gcpCreditCreditId: "",
  gcpCreditCreditNameContains: "",
  gcpCreditLocation: "",
  gcpCreditMaxBytesBilled: "",
  gcpCreditBaselineRemaining: "",
  gcpCreditBaselineAsOf: "",
};

export function getVertexGcpCreditInitialState(
  providerSpecificData?: Record<string, unknown>
): VertexGcpCreditFieldValues {
  const gcpCredit = providerSpecificData?.gcpCredit as Record<string, any> | undefined;
  if (!gcpCredit) return { ...EMPTY_VERTEX_GCP_CREDIT_FIELDS };

  return {
    gcpCreditEnabled: true,
    gcpCreditTotal:
      gcpCredit.total !== undefined && gcpCredit.total !== null ? String(gcpCredit.total) : "",
    gcpCreditRemaining:
      gcpCredit.remaining !== undefined && gcpCredit.remaining !== null
        ? String(gcpCredit.remaining)
        : "",
    gcpCreditCurrency: gcpCredit.currency || "USD",
    gcpCreditExpiresAt: gcpCredit.expiresAt || "",
    gcpCreditAutoEnabled: !!gcpCredit.auto?.enabled,
    gcpCreditQueryProjectId: gcpCredit.auto?.queryProjectId || "",
    gcpCreditDatasetId: gcpCredit.auto?.datasetId || "",
    gcpCreditTableId: gcpCredit.auto?.tableId || "",
    gcpCreditCreditId: gcpCredit.auto?.creditId || "",
    gcpCreditCreditNameContains: gcpCredit.auto?.creditNameContains || "",
    gcpCreditLocation: gcpCredit.auto?.location || "",
    gcpCreditMaxBytesBilled:
      gcpCredit.auto?.maxBytesBilled !== undefined && gcpCredit.auto?.maxBytesBilled !== null
        ? String(gcpCredit.auto?.maxBytesBilled)
        : "",
    gcpCreditBaselineRemaining:
      gcpCredit.auto?.baseline?.remaining !== undefined &&
      gcpCredit.auto?.baseline?.remaining !== null
        ? String(gcpCredit.auto?.baseline?.remaining)
        : "",
    gcpCreditBaselineAsOf: gcpCredit.auto?.baseline?.asOf || "",
  };
}

export function assignVertexGcpCreditToProviderSpecificData(
  target: Record<string, any>,
  values: VertexGcpCreditFieldValues
) {
  if (values.gcpCreditEnabled) {
    const total = values.gcpCreditTotal !== "" ? Number(values.gcpCreditTotal) : undefined;
    const remaining =
      values.gcpCreditRemaining !== "" ? Number(values.gcpCreditRemaining) : undefined;

    let autoConfig: Record<string, any> | undefined = undefined;
    if (values.gcpCreditAutoEnabled) {
      const maxBytes =
        values.gcpCreditMaxBytesBilled !== "" ? Number(values.gcpCreditMaxBytesBilled) : undefined;
      const baseRem =
        values.gcpCreditBaselineRemaining !== ""
          ? Number(values.gcpCreditBaselineRemaining)
          : undefined;

      const baseline =
        baseRem !== undefined || !!values.gcpCreditBaselineAsOf
          ? {
              remaining: baseRem,
              asOf: values.gcpCreditBaselineAsOf || undefined,
            }
          : undefined;

      autoConfig = {
        enabled: true,
        queryProjectId: values.gcpCreditQueryProjectId || undefined,
        datasetId: values.gcpCreditDatasetId || undefined,
        tableId: values.gcpCreditTableId || undefined,
        creditId: values.gcpCreditCreditId || undefined,
        creditNameContains: values.gcpCreditCreditNameContains || undefined,
        location: values.gcpCreditLocation || undefined,
        maxBytesBilled: maxBytes,
        baseline,
      };

      // Clean up undefined properties inside autoConfig
      Object.keys(autoConfig).forEach(
        (key) => autoConfig![key] === undefined && delete autoConfig![key]
      );
      if (autoConfig.baseline) {
        Object.keys(autoConfig.baseline).forEach(
          (key) => autoConfig!.baseline[key] === undefined && delete autoConfig!.baseline[key]
        );
      }
    }

    const gcpCredit: Record<string, any> = {
      ...(target.gcpCredit || {}),
      total,
      remaining,
      currency: values.gcpCreditCurrency || "USD",
      expiresAt: values.gcpCreditExpiresAt || undefined,
      auto: autoConfig,
    };

    // Clean up undefined properties
    Object.keys(gcpCredit).forEach((key) => gcpCredit[key] === undefined && delete gcpCredit[key]);

    target.gcpCredit = gcpCredit;
  } else {
    // Wenn deaktiviert, wir setzen es auf undefined damit der Backend-Merge den Key entfernt
    // oder wir überschreiben es mit null wenn das Backend so löscht.
    // Gemäß der Logik von EditConnectionModal.tsx reicht es aus, wenn wir es nicht rein mergen,
    // ABER da das Backend existierende Felder behält, müssen wir es nullen oder das Objekt bereinigen.
    // Laut Anforderungen: "Wenn deaktiviert: providerSpecificData.gcpCredit nicht neu erzeugen bzw. bestehende Config kontrolliert entfernen."
    delete target.gcpCredit;
    // Set to null as explicitly clearing it for backend merge in case delete doesn't propagate deep deletes correctly.
    target.gcpCredit = null;
  }
}

export type VertexGcpCreditFieldsProps = {
  values: VertexGcpCreditFieldValues;
  onChange: (patch: Partial<VertexGcpCreditFieldValues>) => void;
  t: ProviderMessageTranslator;
};

export default function VertexGcpCreditFields({ values, onChange, t }: VertexGcpCreditFieldsProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-surface/20 p-4">
      <Toggle
        label={providerText(t, "gcpCreditEnabledLabel", "Enable Google Cloud Credit")}
        checked={values.gcpCreditEnabled}
        onChange={(checked) => onChange({ gcpCreditEnabled: checked })}
      />
      {values.gcpCreditEnabled && (
        <div className="flex flex-col gap-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={providerText(t, "gcpCreditTotalLabel", "Total credit")}
              type="number"
              min={0}
              step="any"
              value={values.gcpCreditTotal}
              onChange={(e) => onChange({ gcpCreditTotal: e.target.value })}
            />
            <Input
              label={providerText(t, "gcpCreditRemainingLabel", "Remaining credit")}
              type="number"
              min={0}
              step="any"
              value={values.gcpCreditRemaining}
              onChange={(e) => onChange({ gcpCreditRemaining: e.target.value })}
            />
            <Input
              label={providerText(t, "gcpCreditCurrencyLabel", "Currency")}
              value={values.gcpCreditCurrency}
              onChange={(e) => onChange({ gcpCreditCurrency: e.target.value })}
              placeholder="USD"
            />
            <Input
              label={providerText(t, "gcpCreditExpiresAtLabel", "Credit expires")}
              type="datetime-local"
              value={values.gcpCreditExpiresAt}
              onChange={(e) => onChange({ gcpCreditExpiresAt: e.target.value })}
            />
          </div>

          <div className="border-t border-border/30 pt-3 mt-1">
            <Toggle
              label={providerText(t, "gcpCreditAutoEnabledLabel", "Automatic refresh via BigQuery")}
              checked={values.gcpCreditAutoEnabled}
              onChange={(checked) => onChange({ gcpCreditAutoEnabled: checked })}
              description={providerText(
                t,
                "gcpCreditAutoEnabledDesc",
                "Uses Vertex service account query configured BigQuery billing export. Requires BigQuery Job User query project Data Viewer billing export dataset."
              )}
            />

            {values.gcpCreditAutoEnabled && (
              <div className="flex flex-col gap-3 mt-3 ml-2 border-l-2 border-border/30 pl-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={providerText(t, "gcpCreditQueryProjectIdLabel", "Query project")}
                    value={values.gcpCreditQueryProjectId}
                    onChange={(e) => onChange({ gcpCreditQueryProjectId: e.target.value })}
                    hint={providerText(
                      t,
                      "gcpCreditQueryProjectIdHint",
                      "Google Cloud project to run BigQuery billing query."
                    )}
                  />
                  <Input
                    label={providerText(t, "gcpCreditDatasetIdLabel", "Billing export dataset")}
                    value={values.gcpCreditDatasetId}
                    onChange={(e) => onChange({ gcpCreditDatasetId: e.target.value })}
                  />
                  <Input
                    label={providerText(t, "gcpCreditTableIdLabel", "Billing export table")}
                    value={values.gcpCreditTableId}
                    onChange={(e) => onChange({ gcpCreditTableId: e.target.value })}
                    placeholder="gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX"
                  />
                  <Input
                    label={providerText(
                      t,
                      "gcpCreditLocationLabel",
                      "BigQuery location (optional)"
                    )}
                    value={values.gcpCreditLocation}
                    onChange={(e) => onChange({ gcpCreditLocation: e.target.value })}
                    placeholder="europe-west3"
                  />
                  <Input
                    label={providerText(t, "gcpCreditCreditIdLabel", "Promotion credit ID")}
                    value={values.gcpCreditCreditId}
                    onChange={(e) => onChange({ gcpCreditCreditId: e.target.value })}
                  />
                  <Input
                    label={providerText(
                      t,
                      "gcpCreditCreditNameContainsLabel",
                      "Credit name contains"
                    )}
                    value={values.gcpCreditCreditNameContains}
                    onChange={(e) => onChange({ gcpCreditCreditNameContains: e.target.value })}
                    hint={providerText(
                      t,
                      "gcpCreditCreditNameContainsHint",
                      "Use only when exact credit ID is unknown, e.g. 'Free trial credit'. Credit ID preferred."
                    )}
                  />
                </div>

                <div className="mt-2">
                  <p className="text-sm font-medium text-text-main mb-2">Billing baseline</p>
                  <p className="text-xs text-text-muted mb-3">
                    {providerText(
                      t,
                      "gcpCreditBaselineHint",
                      "Set a point where you know the exact remaining credit in Google Cloud. OmniRoute subtracts matching promotional credits applied after this timestamp."
                    )}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label={providerText(
                        t,
                        "gcpCreditBaselineRemainingLabel",
                        "Remaining credit baseline"
                      )}
                      type="number"
                      min={0}
                      step="any"
                      value={values.gcpCreditBaselineRemaining}
                      onChange={(e) => onChange({ gcpCreditBaselineRemaining: e.target.value })}
                    />
                    <Input
                      label={providerText(t, "gcpCreditBaselineAsOfLabel", "Baseline timestamp")}
                      type="datetime-local"
                      value={values.gcpCreditBaselineAsOf}
                      onChange={(e) => onChange({ gcpCreditBaselineAsOf: e.target.value })}
                    />
                    <Input
                      label={providerText(
                        t,
                        "gcpCreditMaxBytesBilledLabel",
                        "Maximum bytes billed (optional)"
                      )}
                      type="number"
                      min={0}
                      value={values.gcpCreditMaxBytesBilled}
                      onChange={(e) => onChange({ gcpCreditMaxBytesBilled: e.target.value })}
                      hint={providerText(
                        t,
                        "gcpCreditMaxBytesBilledHint",
                        "Safety limit for a single BigQuery refresh query."
                      )}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
