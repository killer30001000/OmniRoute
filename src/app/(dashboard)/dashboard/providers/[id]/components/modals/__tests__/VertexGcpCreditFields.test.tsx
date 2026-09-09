import {
  getVertexGcpCreditInitialState,
  assignVertexGcpCreditToProviderSpecificData,
  EMPTY_VERTEX_GCP_CREDIT_FIELDS,
} from "../VertexGcpCreditFields";

describe("VertexGcpCreditFields", () => {
  it("Fall 1: Existing config laden", () => {
    const providerSpecificData = {
      someExistingVertexField: "keep-me",
      gcpCredit: {
        total: 300,
        remaining: 219,
        currency: "USD",
      },
    };

    const state = getVertexGcpCreditInitialState(providerSpecificData);

    expect(state.gcpCreditEnabled).toBe(true);
    expect(state.gcpCreditTotal).toBe("300");
    expect(state.gcpCreditRemaining).toBe("219");
    expect(state.gcpCreditCurrency).toBe("USD");
  });

  it("Fall 2: Speichern", () => {
    const target: any = { someExistingVertexField: "keep-me" };

    assignVertexGcpCreditToProviderSpecificData(target, {
      ...EMPTY_VERTEX_GCP_CREDIT_FIELDS,
      gcpCreditEnabled: true,
      gcpCreditTotal: "300",
      gcpCreditRemaining: "219",
      gcpCreditCurrency: "USD",
    });

    expect(target.someExistingVertexField).toBe("keep-me");
    expect(target.gcpCredit).toEqual({
      total: 300,
      remaining: 219,
      currency: "USD",
    });
  });

  it("Fall 3: remaining 0", () => {
    const target: any = {};
    assignVertexGcpCreditToProviderSpecificData(target, {
      ...EMPTY_VERTEX_GCP_CREDIT_FIELDS,
      gcpCreditEnabled: true,
      gcpCreditTotal: "100",
      gcpCreditRemaining: "0",
      gcpCreditCurrency: "USD",
    });

    expect(target.gcpCredit.remaining).toBe(0);
  });

  it("Fall 4: Reopen", () => {
    const target: any = {};
    assignVertexGcpCreditToProviderSpecificData(target, {
      ...EMPTY_VERTEX_GCP_CREDIT_FIELDS,
      gcpCreditEnabled: true,
      gcpCreditTotal: "300",
      gcpCreditRemaining: "219",
      gcpCreditCurrency: "USD",
    });

    const state = getVertexGcpCreditInitialState({ gcpCredit: target.gcpCredit });
    expect(state.gcpCreditEnabled).toBe(true);
    expect(state.gcpCreditTotal).toBe("300");
    expect(state.gcpCreditRemaining).toBe("219");
    expect(state.gcpCreditCurrency).toBe("USD");
  });
});
