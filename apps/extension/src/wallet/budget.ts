import {
  DEFAULT_DAILY_REQUESTS,
  RequestBudget,
  type BudgetSnapshot,
  type BudgetStore,
} from "@fluid-wallet/runtime";

import { db, getSetting, setSetting } from "./db";

const DAILY_LIMIT_SETTING = "wallet.dailyRequests";

/**
 * Counters live in IndexedDB, not in memory: the service worker is disposable,
 * and a budget that resets whenever the worker is suspended would not be a
 * budget at all.
 */
const store: BudgetStore = {
  async read(day, origin) {
    const row = await db().usage.get(`${day}:${origin}`);
    return row ? { requests: row.requests } : undefined;
  },
  async write(day, origin, value) {
    await db().usage.put({
      key: `${day}:${origin}`,
      day,
      origin,
      requests: value.requests,
      updatedAt: Date.now(),
    });
  },
};

const budget = new RequestBudget(store);

/** Yesterday's rows are dead weight; drop them once per day per worker. */
let prunedDay: string | null = null;

async function pruneStaleDays(day: string): Promise<void> {
  if (prunedDay === day) return;
  prunedDay = day;
  try {
    await db()
      .usage.filter((row) => row.day !== day)
      .delete();
  } catch {
    // A failed prune must never block a request.
  }
}

export async function getDailyLimit(): Promise<number> {
  const configured = await getSetting<number>(DAILY_LIMIT_SETTING);
  return typeof configured === "number" ? configured : DEFAULT_DAILY_REQUESTS;
}

export async function setDailyLimit(limit: number): Promise<void> {
  await setSetting(DAILY_LIMIT_SETTING, Math.max(0, Math.floor(limit)));
}

/**
 * Charges one request to the origin, or refuses before the provider is called.
 *
 * Runs after the rate limiter: the limiter stops bursts, this stops the steady
 * drain from a retry loop that never trips a per-minute window.
 */
export async function spendRequest(origin: string): Promise<BudgetSnapshot> {
  const limit = await getDailyLimit();
  const day = RequestBudget.dayKey(Date.now());
  await pruneStaleDays(day);
  return budget.consume(origin, limit);
}

export async function usageToday(origin: string): Promise<BudgetSnapshot> {
  return budget.usage(origin, await getDailyLimit());
}
