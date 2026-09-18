import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIPPING_COST,
  calculateOrderTotal,
  calculateShippingCost,
  calculateSubtotal,
  roundCurrency,
} from "./pricing-service";

describe("calculateShippingCost", () => {
  it("uses the default shipping cost when no settings are stored", () => {
    expect(calculateShippingCost(100, {})).toBe(DEFAULT_SHIPPING_COST);
  });

  it("uses the stored shippingCost when there is no free-shipping threshold", () => {
    expect(calculateShippingCost(100, { shippingCost: 45 })).toBe(45);
  });

  it("charges normal shipping when subtotal is below the free-shipping threshold", () => {
    expect(calculateShippingCost(199, { shippingCost: 30, freeShippingThreshold: 200 })).toBe(30);
  });

  it("is free exactly at the free-shipping threshold (inclusive boundary)", () => {
    expect(calculateShippingCost(200, { shippingCost: 30, freeShippingThreshold: 200 })).toBe(0);
  });

  it("is free above the free-shipping threshold", () => {
    expect(calculateShippingCost(500, { shippingCost: 30, freeShippingThreshold: 200 })).toBe(0);
  });

  it("ignores a free-shipping threshold of 0 (treated as disabled, not 'always free')", () => {
    expect(calculateShippingCost(0, { shippingCost: 30, freeShippingThreshold: 0 })).toBe(30);
  });

  it("ignores a negative free-shipping threshold (disabled)", () => {
    expect(calculateShippingCost(1000, { shippingCost: 30, freeShippingThreshold: -10 })).toBe(30);
  });

  it("charges shipping even on a zero subtotal when no threshold is configured", () => {
    expect(calculateShippingCost(0, { shippingCost: 30 })).toBe(30);
  });
});

describe("calculateSubtotal", () => {
  it("returns 0 for an empty cart", () => {
    expect(calculateSubtotal([])).toBe(0);
  });

  it("sums price * quantity across all line items", () => {
    const items = [
      { price: 100, quantity: 2 }, // 200
      { price: 50, quantity: 3 },  // 150
    ];
    expect(calculateSubtotal(items)).toBe(350);
  });

  it("handles a single item with quantity 1", () => {
    expect(calculateSubtotal([{ price: 75.5, quantity: 1 }])).toBe(75.5);
  });
});

describe("calculateOrderTotal", () => {
  it("adds shipping and subtracts discount from the subtotal", () => {
    expect(calculateOrderTotal(500, 50, 30)).toBe(480);
  });

  it("never goes below the shipping cost when discount fully covers the subtotal", () => {
    // discount is expected to already be capped by checkCoupon before this is called,
    // but the arithmetic itself should still be exact if it ever isn't.
    expect(calculateOrderTotal(100, 100, 30)).toBe(30);
  });

  it("rounds floating point artifacts to 2 decimal places", () => {
    // 0.1 + 0.2 style floating point drift
    expect(calculateOrderTotal(10.1, 0.2, 0)).toBe(9.9);
  });

  it("supports a free-shipping order with a percentage discount", () => {
    expect(calculateOrderTotal(300, 30, 0)).toBe(270);
  });
});

describe("roundCurrency", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundCurrency(10.005)).toBeCloseTo(10.01, 2);
    expect(roundCurrency(10.004)).toBe(10);
  });

  it("leaves already-clean values untouched", () => {
    expect(roundCurrency(99)).toBe(99);
    expect(roundCurrency(99.5)).toBe(99.5);
  });
});
