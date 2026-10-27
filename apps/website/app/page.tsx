const principles = [
  {
    title: "User-owned credentials",
    body: "The wallet holds your DeepSeek key, encrypted on this device. Apps never receive it — they receive answers.",
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

const steps = [
  {
    label: "01",
    title: "The wallet keeps the key",
    body: "AES-GCM under a password-derived key, decrypted only inside the extension's service worker.",
  },
  {
    label: "02",
    title: "The app asks for a scope",
    body: "Capabilities, providers and models are approved once per origin, and revocable at any time.",
  },
  {
    label: "03",
    title: "Tokens stream back",
    body: "The wallet calls the provider and relays deltas over the page bridge. The key never crosses it.",
  },
];

export default function HomePage() {
  return (
    <main>
      <div className="shell">
        <p className="eyebrow">Open protocol · local-first · preview</p>
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
          <a className="primary" href="/docs">
            Read the docs
          </a>
          <a className="ghost" href="https://github.com/fluid-wallet/fluid-wallet">
            Source
          </a>
        </div>

        <section className="grid" aria-label="How it works">
          {steps.map((step) => (
            <article key={step.label} className="card">
              <p className="step-label">{step.label}</p>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
            </article>
          ))}
        </section>

        <section className="grid" aria-label="Design principles">
          {principles.map((item) => (
            <article key={item.title} className="card">
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </section>

        <section className="status">
          <h2>Status</h2>
          <ul>
            <li>Wallet · encrypted vault, provider management, connect approval — working</li>
            <li>Runtime · scoped permissions, sessions, streaming, cancellation, activity log — working</li>
            <li>SDK · vanilla TypeScript client plus React hooks and an AI SDK transport — working</li>
            <li>Next · tool-call round trips, Firefox packaging, store release</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
