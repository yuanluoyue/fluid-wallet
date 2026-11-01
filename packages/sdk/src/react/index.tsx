import type { FluidModel, FluidWalletStatus } from "@fluid-wallet/protocol";
import { FluidClient, type FluidClientState } from "../client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const FluidContext = createContext<FluidClient | null>(null);

export interface FluidProviderProps {
  /** Bring your own client; otherwise the provider creates and owns one. */
  client?: FluidClient;
  appId?: string;
  appName?: string;
  children: ReactNode;
}

export function FluidProvider({ client, appId, appName, children }: FluidProviderProps) {
  const owned = useRef<FluidClient | null>(null);

  if (!client && owned.current === null) {
    owned.current = new FluidClient({ appId, appName });
  }

  const value = client ?? owned.current;

  // The client outlives this effect on purpose. React runs mount effects twice
  // in development, so disposing in the cleanup kills a client that is about to
  // be used again — and every later call then fails with "disposed", which
  // looks from the UI exactly like a wallet that stopped answering. Release it
  // when the page goes away instead: that is the lifetime the transport has.
  useEffect(() => {
    if (client) return;
    const release = (): void => owned.current?.dispose();
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [client]);

  if (!value) throw new Error("FluidProvider failed to create a client.");

  return <FluidContext.Provider value={value}>{children}</FluidContext.Provider>;
}

export function useFluidClient(): FluidClient {
  const client = useContext(FluidContext);
  if (!client) {
    throw new Error("useFluidClient must be used inside <FluidProvider>.");
  }
  return client;
}

/** Full client state; re-renders only when the client publishes a new snapshot. */
export function useFluidState(): FluidClientState {
  const client = useFluidClient();

  return useSyncExternalStore(
    useCallback((onChange: () => void) => client.subscribe(onChange), [client]),
    useCallback(() => client.state, [client]),
  );
}

export interface FluidWalletState {
  availability: FluidClientState["availability"];
  connection: FluidClientState["connection"];
  authorization: FluidClientState["authorization"];
  permission: FluidClientState["permission"];
  wallet: FluidClientState["wallet"];
  /**
   * Why the wallet is not usable, when it is old enough to say.
   *
   * `"uninitialized"` and `"locked"` both need a screen, but not the same one:
   * one offers "create a password", the other "enter it". A wallet that predates
   * `status` only ever reports `"locked"`.
   */
  status: FluidWalletStatus | undefined;
  /** Shorthand for `status !== "ready"`, false while nothing is known. */
  locked: boolean;
  /**
   * Brings the wallet window up, on the unlock screen when locked.
   *
   * Stable across renders, so it can be passed to a button directly.
   */
  openWallet: () => Promise<boolean>;
}

/** The part the snapshot caches; `status`, `locked` and `openWallet` derive from it. */
type WalletSnapshot = Omit<FluidWalletState, "status" | "locked" | "openWallet">;

function selectWalletState(state: FluidClientState): WalletSnapshot {
  return {
    availability: state.availability,
    connection: state.connection,
    authorization: state.authorization,
    permission: state.permission,
    wallet: state.wallet,
  };
}

function walletStateEqual(left: WalletSnapshot, right: WalletSnapshot): boolean {
  return (
    left.availability === right.availability &&
    left.connection === right.connection &&
    left.authorization === right.authorization &&
    left.permission === right.permission &&
    left.wallet === right.wallet
  );
}

/**
 * Caches the selected value so a snapshot keeps its identity while it is equal.
 *
 * `client.state` is a new object on every publish, and a streaming inference
 * publishes once per token. Passing that object straight to
 * `useSyncExternalStore` re-renders every subscriber on every token — which is
 * the opposite of what a hook written for "the subset most UIs need" is for.
 */
function createSelector<T>(
  select: (state: FluidClientState) => T,
  isEqual: (left: T, right: T) => boolean,
): (state: FluidClientState) => T {
  let cached!: T;
  let primed = false;

  return (state: FluidClientState): T => {
    const next = select(state);
    if (!primed || !isEqual(cached, next)) {
      cached = next;
      primed = true;
    }
    return cached;
  };
}

/**
 * Connection, authorization and the grant — not inference text.
 *
 * Safe to call in a toolbar or a badge: token deltas do not reach it, because
 * nothing it selects changes while a stream runs.
 */
export function useFluidWallet(): FluidWalletState {
  const client = useFluidClient();
  const select = useMemo(() => createSelector(selectWalletState, walletStateEqual), []);
  const openWallet = useCallback(() => client.openWallet(), [client]);

  const state = useSyncExternalStore(
    useCallback((onChange: () => void) => client.subscribe(onChange), [client]),
    useCallback(() => select(client.state), [client, select]),
  );

  // Derived rather than selected: `wallet` is already compared by reference, so
  // adding these to the selector would only add fields that cannot change on
  // their own.
  return useMemo(
    () => ({
      ...state,
      status:
        state.wallet?.status ??
        (state.wallet ? (state.wallet.locked ? "locked" : "ready") : undefined),
      locked: state.wallet?.locked ?? false,
      openWallet,
    }),
    [state, openWallet],
  );
}

export interface FluidModelsState {
  models: FluidModel[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useFluidModels(): FluidModelsState {
  const client = useFluidClient();
  const [models, setModels] = useState<FluidModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setModels(await client.listModels());
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setLoading(false);
    }
  }, [client]);

  return { models, loading, error, refresh };
}
