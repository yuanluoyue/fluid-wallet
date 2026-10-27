import { FluidError, FluidErrorCode } from "@fluid-wallet/protocol";
import { describe, expect, it } from "vitest";

import { describeFluidError, needsUserAction } from "./errors";

describe("describeFluidError", () => {
  it("turns a locked wallet into an actionable instruction", () => {
    const issue = describeFluidError(new FluidError(FluidErrorCode.Locked, "The wallet is locked."));

    expect(issue).toMatchObject({ kind: "locked", action: "unlock" });
    expect(issue.title).toBeTruthy();
    expect(needsUserAction(new FluidError(FluidErrorCode.Locked, "x"))).toBe(true);
  });

  it("separates 'no grant' from 'provider failed'", () => {
    expect(describeFluidError(new FluidError(FluidErrorCode.Unauthorized, "no grant"))).toMatchObject({
      kind: "not-connected",
      action: "connect",
    });
    expect(
      describeFluidError(new FluidError(FluidErrorCode.ProviderUnavailable, "upstream 503")),
    ).toMatchObject({ kind: "provider", action: "fix-provider" });
  });

  it("keeps the retry hint a rate limit carries", () => {
    const issue = describeFluidError(
      new FluidError(FluidErrorCode.RateLimited, "slow down", { retryAfterMs: 4_000 }),
    );

    expect(issue).toMatchObject({ kind: "rate-limited", action: "wait", retryAfterMs: 4_000 });
  });

  it("reports an exhausted budget as a wait, not a bug", () => {
    const issue = describeFluidError(
      new FluidError(FluidErrorCode.BudgetExceeded, "used its 300 requests", {
        used: 300,
        limit: 300,
      }),
    );

    expect(issue).toMatchObject({ kind: "budget", action: "wait" });
    expect(needsUserAction(new FluidError(FluidErrorCode.BudgetExceeded, "x"))).toBe(false);
  });

  it("does not claim a cancellation was a failure", () => {
    const issue = describeFluidError(new FluidError(FluidErrorCode.InferenceCancelled, "stopped"));

    expect(issue).toMatchObject({ kind: "cancelled", action: "none" });
    expect(needsUserAction(new FluidError(FluidErrorCode.InferenceCancelled, "x"))).toBe(false);
  });

  it("survives a plain error", () => {
    expect(describeFluidError(new TypeError("Failed to fetch"))).toMatchObject({
      kind: "unknown",
      action: "retry",
    });
    expect(describeFluidError(undefined)).toMatchObject({ kind: "unknown" });
  });
});
