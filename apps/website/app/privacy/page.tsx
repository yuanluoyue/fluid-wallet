import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Fluid Wallet",
  description:
    "What Fluid Wallet stores on your device, what leaves it, and why. No account, no telemetry, no server operated by this project.",
};

const stored = [
  [
    "Vault",
    "A PBKDF2 salt, iteration count and a verifier. The password itself is never stored — it derives the key that unwraps everything else.",
  ],
  [
    "Providers",
    "Name, endpoint URL, model list, and your API key as an AES-GCM envelope. The key is decrypted only inside the extension's service worker.",
  ],
  [
    "Grants",
    "Which origin was given which capabilities, and when. This is the list you can revoke from the panel.",
  ],
  [
    "Sessions",
    "Which origin holds which model, so a session can be ended or expire without disturbing the grant.",
  ],
  [
    "Conversations and messages",
    "Only for apps that use the structured API, and only their own. Nothing is uploaded to us to be stored.",
  ],
  [
    "Call log",
    "Path, status, latency, byte count and — on the structured path only — token counts.",
  ],
  ["Usage counters", "Per-origin request counts used for rate limiting."],
  ["Settings", "Panel language, auto-lock behaviour, and other local preferences."],
];

export default function PrivacyPage() {
  return (
    <main>
      <div className="shell docs">
        <p className="eyebrow">Privacy</p>
        <h1 className="docs-title">Your keys never leave the browser.</h1>
        <p className="lede">
          Fluid Wallet is a browser extension and an open protocol. It has no account system, no
          server operated by this project, and no telemetry. This page states exactly what is stored
          on your device, what is sent over the network, and what is not.
        </p>

        <section>
          <h2>The short version</h2>
          <ul>
            <li>
              <strong>Nothing is collected by us.</strong> There is no analytics, no crash
              reporting, no usage pings, and no identifier that follows you out of the browser.
            </li>
            <li>
              <strong>Model credentials stay in the extension.</strong> Web pages never receive your
              API key, only the model output they asked for.
            </li>
            <li>
              <strong>Network traffic goes to the provider you configured</strong> — by default
              <code>api.deepseek.com</code> — and nowhere else.
            </li>
            <li>
              <strong>Removing the extension deletes the data.</strong> There is no copy anywhere
              else to delete.
            </li>
          </ul>
        </section>

        <section>
          <h2>What is stored on your device</h2>
          <p>
            Everything below lives in IndexedDB, in a database named <code>fluid-wallet</code>,
            inside the extension&apos;s own origin. Website JavaScript cannot read it; only the
            extension&apos;s service worker can, and only after you unlock the vault.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>What it actually contains</th>
                </tr>
              </thead>
              <tbody>
                {stored.map(([name, detail]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            The vault is encrypted with AES-GCM under a key derived by PBKDF2-SHA-256 at 210,000
            iterations. Someone with a copy of the database file still needs your password, but this
            is only as strong as the password you choose.
          </p>
        </section>

        <section>
          <h2>What is sent over the network</h2>
          <p>
            The extension makes exactly two kinds of outbound request, both to the base URL of a
            provider you added yourself:
          </p>
          <ul>
            <li>
              <strong>The model call.</strong> The prompt, the messages and the model settings are
              sent to that provider so it can answer. This is the same request you would have made
              from the website; the wallet is the one making it.
            </li>
            <li>
              <strong>The model catalogue.</strong> When you add or refresh a provider, the wallet
              reads its <code>/models</code> endpoint to fill in the model list.
            </li>
          </ul>
          <p>
            Nothing else is transmitted. There is no licence check, no update ping, no feature flag,
            no remote configuration, and no error report. The extension bundles all of its code — it
            never downloads and executes remote scripts, which is why it can pass a store review
            that forbids exactly that.
          </p>
        </section>

        <section>
          <h2>What a website can and cannot see</h2>
          <p>
            An app must ask for permission before it can call a model, and the approval names the
            capabilities, providers and models being requested. Once approved it can, within that
            scope:
          </p>
          <ul>
            <li>send prompts and receive the responses, including streamed tokens;</li>
            <li>read the list of models you allowed;</li>
            <li>use the model without ever holding the key.</li>
          </ul>
          <p>
            It cannot read your key, list providers you did not grant, see another origin&apos;s
            conversations or call log, or send a request to a host other than the provider it was
            granted. The URL a page supplies is treated as a path only; scheme, host and key come
            from the wallet&apos;s configuration.
          </p>
          <p className="note">
            One trade-off stated plainly: on the <code>inference.proxy</code> path the wallet relays
            the request body without reading it, so that existing provider SDKs work unchanged. The
            wallet therefore cannot inspect those prompts. That protects the app&apos;s traffic from
            the wallet as much as the other way around.
          </p>
        </section>

        <section>
          <h2>Permissions and why each is needed</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Permission</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>storage</code>
                  </td>
                  <td>Holds the encrypted vault, provider configuration and grants.</td>
                </tr>
                <tr>
                  <td>
                    <code>idle</code>
                  </td>
                  <td>
                    Locks the vault when the screen locks or the machine sleeps. Without it a wallet
                    left unlocked is a local attack surface.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>https://api.deepseek.com/*</code>
                  </td>
                  <td>
                    The default provider. Pre-granted so the first run works; no page gets this
                    access.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>https://*/*</code> (optional)
                  </td>
                  <td>
                    Requested only at the moment you add your own OpenAI-compatible endpoint, and
                    revocable by removing that provider.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            The extension does not request <code>tabs</code>, <code>cookies</code>,{" "}
            <code>history</code>, <code>downloads</code> or <code>webRequest</code>, and it reads no
            page content. Its content script exists to pass messages between the page and the
            extension and does nothing else.
          </p>
        </section>

        <section>
          <h2>Retention and deletion</h2>
          <ul>
            <li>
              <strong>Per app:</strong> revoke an origin from the panel; its grant and sessions are
              dropped immediately, its stored conversations remain until you clear them.
            </li>
            <li>
              <strong>Everything:</strong> removing the extension from{" "}
              <code>chrome://extensions</code> deletes the whole IndexedDB store. That is the only
              copy.
            </li>
            <li>
              <strong>At the provider:</strong> prompts are retained according to that
              provider&apos;s own policy, which this project does not control. Read it before using
              a provider.
            </li>
          </ul>
        </section>

        <section>
          <h2>The website</h2>
          <p>
            This site is a static Next.js build served from Cloudflare Workers. It sets no cookies,
            loads no analytics or advertising scripts, and embeds no third-party fonts or widgets.
            Like any web server, Cloudflare logs requests — including IP addresses — for delivery
            and abuse prevention; that logging is Cloudflare&apos;s, under their privacy terms, and
            this project does not receive or store it.
          </p>
        </section>

        <section>
          <h2>Children</h2>
          <p>
            The extension is a developer tool for people who already hold an API key with a model
            provider. It is not directed at children and collects no personal information from
            anyone.
          </p>
        </section>

        <section>
          <h2>Changes and contact</h2>
          <p>
            This policy is versioned with the repository. Material changes appear in the commit
            history for this page, and the extension&apos;s own changelog.
          </p>
          <p>
            Questions, or a report that something here is inaccurate:{" "}
            <a href="https://github.com/yuanluoyue/fluid-wallet/issues">
              github.com/yuanluoyue/fluid-wallet/issues
            </a>
            . Security issues should follow{" "}
            <a href="https://github.com/yuanluoyue/fluid-wallet/blob/main/CONTRIBUTING.md">
              the private advisory route
            </a>{" "}
            rather than a public issue.
          </p>
          <p className="note">Last updated: 1 November 2026 · Fluid Wallet 0.1.0</p>
        </section>
      </div>
    </main>
  );
}
