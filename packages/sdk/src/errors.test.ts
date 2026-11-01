import { FluidError, FluidErrorCode } from "@fluid-wallet/protocol";
import { describe, expect, it } from "vitest";

import { describeFluidError, needsUserAction } from "./errors";

describe("describeFluidError", () => {
  it("turns a locked wallet into an actionable instruction", () => {
    const issue = describeFluidError(
      new FluidError(FluidErrorCode.Locked, "The wallet is locked."),
    );

    expect(issue).toMatchObject({ kind: "locked", action: "unlock" });
    expect(issue.title).toBeTruthy();
    expect(needsUserAction(new FluidError(FluidErrorCode.Locked, "x"))).toBe(true);
  });

  it("sends a wallet with no password anywhere but 'unlock it'", () => {
    // Both states arrive as 4101; only one of them has a password field to
    // type into, so the same instruction cannot serve both.
    const notSetup = describeFluidError(
      new FluidError(FluidErrorCode.Locked, "no wallet", { reason: "not-setup" }),
    );
    const locked = describeFluidError(
      new FluidError(FluidErrorCode.Locked, "locked", { reason: "locked" }),
    );

    expect(notSetup.action).toBe("unlock");
    expect(notSetup.detail).not.toBe(locked.detail);
    expect(locked.title).toMatch(/locked/i);
  });

  it("separates 'no grant' from 'provider failed'", () => {
    expect(
      describeFluidError(new FluidError(FluidErrorCode.Unauthorized, "no grant")),
    ).toMatchObject({
      kind: "not-connected",
      action: "connect",
    });
    expect(
      describeFluidError(new FluidError(FluidErrorCode.ProviderUnavailable, "upstream 503")),
    ).toMatchObject({ kind: "provider", action: "fix-provider" });
  });

  it("names the wallet's own missing provider instead of blaming the key", () => {
    const issue = describeFluidError(
      new FluidError(FluidErrorCode.ProviderUnavailable, "no provider yet", {
        reason: "no-provider",
      }),
    );

    expect(issue).toMatchObject({ kind: "provider", action: "fix-provider" });
    expect(issue.title).toBe("The wallet has no provider yet");
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

  it("quotes the page-side counters behind a silent wallet", () => {
    // The one thing that turns "it does not work" into a diagnosis: how many
    // requests left the page, how many came back, and how long each probe
    // waited. Without it every report is a guess.
    const issue = describeFluidError(
      new FluidError(FluidErrorCode.NotInstalled, "worker never answered", {
        reason: "worker-silent",
        diagnostics: {
          relay: true,
          relayAnnouncedAfterMs: 56,
          requests: 2,
          answers: 0,
          pending: 2,
        },
        attempts: [
          { outcome: "timeout", elapsedMs: 2_001, budgetMs: 2_000 },
          { outcome: "timeout", elapsedMs: 10_002, budgetMs: 10_000 },
        ],
      }),
    );

    expect(issue.evidence).toContain("relay up after 56ms");
    expect(issue.evidence).toContain("2 sent / 0 answered");
    expect(issue.evidence).toContain("timeout@2001ms/2000ms");
  });

  it("omits the counter line when there is nothing to quote", () => {
    expect(
      describeFluidError(
        new FluidError(FluidErrorCode.NotInstalled, "no bridge", { reason: "not-injected" }),
      ).evidence,
    ).toBeUndefined();
  });
});
