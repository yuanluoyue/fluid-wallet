import { FluidClient, createFluidFetch, type FluidClientState } from "@fluid-wallet/sdk";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

const s = {
  page: {
    maxWidth: 860,
    margin: "0 auto",
    padding: "48px 24px 80px",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    color: "#14161a",
  } as const,
  row: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 } as const,
  button: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #d8d5cf",
    background: "#fff",
    fontSize: 13,
    cursor: "pointer",
  } as const,
  pre: {
    marginTop: 24,
    padding: 16,
    minHeight: 240,
    background: "#14161a",
    color: "#e7e5df",
    borderRadius: 10,
    fontSize: 12,
    lineHeight: 1.7,
    overflowX: "auto",
    whiteSpace: "pre-wrap",
  } as const,
  kv: {
    display: "grid",
    gridTemplateColumns: "160px 1fr",
    gap: "6px 12px",
    fontSize: 13,
    marginTop: 20,
  } as const,
};

function summarize(state: FluidClientState): Array<[string, string]> {
  return [
    ["availability", state.availability],
    ["connection", state.connection],
    ["authorization", state.authorization],
    ["session", state.session?.id ?? "—"],
    ["wallet", state.wallet ? `${state.wallet.name} v${state.wallet.walletVersion}` : "—"],
    ["permission", state.permission ? `${state.permission.origin}` : "—"],
  ];
}

export function App() {
  const client = useMemo(() => new FluidClient(), []);
  const state = useSyncExternalStore(
    useCallback((onChange: () => void) => client.subscribe(onChange), [client]),
    useCallback(() => client.state, [client]),
  );

  const [log, setLog] = useState<string[]>([]);
  const push = useCallback((line: string) => {
    setLog((previous) => [...previous, line]);
  }, []);

  useEffect(() => () => client.dispose(), [client]);

  const detect = async () => {
    const info = await client.detect();
    push(info ? `detected ${info.name} v${info.walletVersion}` : "wallet not available");
  };

  const connect = async () => {
    try {
      const permission = await client.connect({
        capabilities: [
          "wallet:read",
          "models:list",
          "inference:text",
          "inference:stream",
          "inference:proxy",
        ],
      });
      push(`connected: ${permission.origin} [${permission.capabilities.join(", ")}]`);
    } catch (error) {
      push(`connect failed: ${(error as Error).message}`);
    }
  };

  const listModels = async () => {
    try {
      const models = await client.listModels();
      push(`models: ${models.map((model) => model.id).join(", ") || "(none)"}`);
    } catch (error) {
      push(`listModels failed: ${(error as Error).message}`);
    }
  };

  const stream = async () => {
    try {
      const session = await client.createSession({ model: "deepseek-chat" });
      push(`session ${session.id}`);

      const inference = client.createInference({
        sessionId: session.id,
        messages: [{ role: "user", content: "Say hello in five words." }],
        stream: true,
      });

      let text = "";
      for await (const event of inference.events) {
        if (event.type === "inference.delta") {
          text += String((event.payload as { text: string }).text);
        }
      }
      push(`stream done: ${text}`);
    } catch (error) {
      push(`inference failed: ${(error as Error).message}`);
    }
  };

  /**
   * Exercises the raw path end to end: the page sends the same request it would
   * send to DeepSeek directly, and the wallet supplies the host and the key.
   */
  const rawFetch = async () => {
    try {
      const session = state.session ?? (await client.createSession({ model: "deepseek-chat" }));
      const fluidFetch = createFluidFetch(client, { sessionId: session.id });

      const response = await fluidFetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-chat",
          stream: true,
          messages: [{ role: "user", content: "Say hello in five words." }],
        }),
      });

      push(`raw fetch: ${response.status} ${response.headers.get("content-type") ?? ""}`);

      const reader = response.body?.getReader();
      if (!reader) {
        push(`raw body: ${(await response.text()).slice(0, 240)}`);
        return;
      }

      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      push(`raw body: ${text.slice(0, 240)}${text.length > 240 ? "…" : ""}`);
    } catch (error) {
      push(`raw fetch failed: ${(error as Error).message}`);
    }
  };

  return (
    <main style={s.page}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Fluid Protocol Playground</h1>
      <p style={{ color: "#5f6672", fontSize: 14, marginTop: 6 }}>
        Inspect the bridge, request permissions and stream a response from the wallet.
      </p>

      <dl style={s.kv}>
        {summarize(state).map(([key, value]) => (
          <div key={key} style={{ display: "contents" }}>
            <dt style={{ color: "#5f6672" }}>{key}</dt>
            <dd style={{ margin: 0, fontFamily: "ui-monospace, monospace" }}>{value}</dd>
          </div>
        ))}
      </dl>

      <div style={s.row}>
        <button style={s.button} onClick={detect} type="button">
          Detect wallet
        </button>
        <button style={s.button} onClick={connect} type="button">
          Connect
        </button>
        <button style={s.button} onClick={listModels} type="button">
          List models
        </button>
        <button style={s.button} onClick={stream} type="button">
          Stream test
        </button>
        <button style={s.button} onClick={rawFetch} type="button">
          Raw fetch test
        </button>
        <button style={s.button} onClick={() => setLog([])} type="button">
          Clear log
        </button>
      </div>

      <pre style={s.pre}>{log.join("\n") || "// no activity yet"}</pre>
    </main>
  );
}
