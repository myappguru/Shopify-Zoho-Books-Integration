import { describe, it, expect } from "vitest";
import { normalizeRestRefund } from "./refundSync.server";

describe("normalizeRestRefund", () => {
  // Shape mirrors the real refunds/create webhook payload captured live
  // against order #1004 during the 2026-08-18 testing pass (the one that
  // surfaced the credit-note linkage bug) - trimmed to the fields this
  // function actually reads.
  const realRefundPayload = {
    id: 939866849465,
    order_id: 6623959679161,
    created_at: "2026-08-18T02:07:47-04:00",
    admin_graphql_api_id: "gid://shopify/Refund/939866849465",
    refund_line_items: [
      {
        quantity: 1,
        line_item: { sku: "sku-hidden-snow", title: "The Hidden Snowboard" },
      },
    ],
    transactions: [
      { kind: "refund", gateway: "manual", amount: "749.95" },
    ],
  };

  it("sums only the refund-kind transactions for the amount", () => {
    const refund = normalizeRestRefund(realRefundPayload);
    expect(refund.amount).toBe(749.95);
    expect(refund.gatewayNames).toEqual(["manual"]);
  });

  it("ignores non-refund transaction kinds when computing the amount", () => {
    const refund = normalizeRestRefund({
      ...realRefundPayload,
      transactions: [
        { kind: "sale", gateway: "manual", amount: "749.95" },
        { kind: "refund", gateway: "manual", amount: "100.00" },
      ],
    });

    expect(refund.amount).toBe(100);
  });

  it("has amount 0 for a pure restock-only refund with no money transaction", () => {
    const refund = normalizeRestRefund({ ...realRefundPayload, transactions: [] });
    expect(refund.amount).toBe(0);
    expect(refund.gatewayNames).toEqual([]);
  });

  it("keeps only line items with a SKU (matches order/invoice sync's own SKU-only rule)", () => {
    const refund = normalizeRestRefund({
      ...realRefundPayload,
      refund_line_items: [
        { quantity: 1, line_item: { sku: "sku-hidden-snow" } },
        { quantity: 1, line_item: {} }, // no sku - a custom/manual line item
      ],
    });

    expect(refund.lineItems).toEqual([{ sku: "sku-hidden-snow", quantity: 1 }]);
  });

  it("builds the order GID from the plain numeric order_id", () => {
    const refund = normalizeRestRefund(realRefundPayload);
    expect(refund.orderId).toBe("gid://shopify/Order/6623959679161");
  });
});
