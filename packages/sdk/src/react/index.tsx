import type { FluidModel } from "@fluid-wallet/protocol";
import { FluidClient, type FluidClientState } from "../client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

  useEffect(() => {
    return () => {
      if (!client) owned.current?.dispose();
    };
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
}

/** The subset most UIs need, kept separate so components do not re-render on deltas. */
export function useFluidWallet(): FluidWalletState {
  const state = useFluidState();
  return {
    availability: state.availability,
    connection: state.connection,
    authorization: state.authorization,
    permission: state.permission,
    wallet: state.wallet,
  };
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
