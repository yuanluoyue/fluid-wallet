const principles = [
  {
    title: "User-owned credentials",
    body: "The wallet holds your DeepSeek key locally. Apps never receive it — they receive answers.",
  },
  {
    title: "Connect once",
    body: "Grant an origin a scoped permission, and every app it runs can call models within that scope.",
  },
  {
    title: "Local-first",
    body: "No account server, no proxy, no telemetry. Conversations and logs stay in IndexedDB.",
  },
  {
    title: "Open protocol",
    body: "The wire format is versioned and documented, so a third party can ship a compatible wallet.",
  },
];

export default function HomePage() {
  return (
    <main>
      <div className="shell">
        <p className="eyebrow">Fluid Protocol · preview</p>
        <h1>
          Your models.
          <br />
          Every app.
        </h1>
        <p className="lede">
          Fluid Wallet is an open, local-first LLM wallet for web AI apps. Users keep their own API
          keys in the browser; developers integrate an SDK instead of building a backend.
        </p>

        <div className="actions">
          <a className="primary" href="/docs/quick-start">
            Quick start
          </a>
          <a className="ghost" href="https://github.com/fluid-wallet/fluid-wallet">
            Source
          </a>
        </div>

        <section className="grid" aria-label="Design principles">
          {principles.map((item) => (
            <article key={item.title} className="card">
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </section>

        <section className="status">
          <h2>Build status</h2>
          <ul>
            <li>MVP-01 · protocol, SDK and mock wallet — in progress</li>
            <li>MVP-02 · extension vault and DeepSeek routing — next</li>
            <li>MVP-03 · conversations, logs and AI SDK adapter — planned</li>
            <li>MVP-04 · custom tools and docs site — planned</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
