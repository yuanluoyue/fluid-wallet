import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docs — Fluid Wallet",
  description:
    "Install the wallet, point your provider SDK at it, and stream model output through the Fluid SDK in a few minutes.",
};

const methods = [
  ["wallet.getInfo", "Version, capabilities and lock state"],
  ["wallet.connect", "Request a scoped grant for this origin"],
  ["wallet.disconnect", "Drop this page's sessions, keep the grant"],
  ["wallet.getPermissions", "Read back what was granted"],
  ["wallet.revoke", "Revoke everything, or selected capabilities"],
  ["provider.list", "Providers visible to this connection"],
  ["model.list", "Models inside the granted scope"],
  ["session.create", "Bind a session to the origin and a model"],
  ["session.close", "End a session"],
  ["inference.create", "Run a completion; deltas stream as events"],
  ["inference.cancel", "Abort a running generation or raw request"],
  ["inference.proxy", "Forward a raw provider request; needs inference:proxy"],
  ["conversation.list", "This app's own history only"],
  ["conversation.get", "Read one of this app's conversations"],
  ["conversation.append", "Append messages to this app's history"],
  ["usage.get", "Today's request budget for this origin"],
  ["activity.list", "This app's own call log"],
];

export default function DocsPage() {
  return (
    <main>
      <div className="shell docs">
        <p className="eyebrow">Documentation</p>
        <h1 className="docs-title">Integrate in one afternoon.</h1>
        <p className="lede">
          Fluid Wallet is two things: a browser wallet that holds model credentials, and a protocol
          that lets a web app borrow them. This page covers the whole integration.
        </p>

        <nav className="docs-toc" aria-label="Contents">
          <a href="#install">1 · Install</a>
          <a href="#wallet">2 · Set up the wallet</a>
          <a href="#fetch">3 · Drop-in fetch</a>
          <a href="#vanilla">4 · Structured chat</a>
          <a href="#react">5 · React</a>
          <a href="#ai-sdk">6 · Vercel AI SDK</a>
          <a href="#protocol">7 · Protocol</a>
          <a href="#security">8 · Security model</a>
        </nav>

        <section id="install">
          <h2>1 · Install</h2>
          <p>
            The extension is loaded unpacked while it is in preview, which keeps it away from store
            review and lets you read the code you are running.
          </p>
          <p>
            If you only want to use it, take the zip from{" "}
            <a href="https://github.com/yuanluoyue/fluid-wallet/releases/latest">Releases</a>, unzip
            it somewhere permanent, and point <code>Load unpacked</code> at that folder. Don&apos;t
            move the folder afterwards: an unpacked extension&apos;s ID comes from its path, so a
            move gives you a different — and empty — wallet.
          </p>
          <pre>
            <code>{`git clone https://github.com/yuanluoyue/fluid-wallet
cd fluid-wallet
pnpm install
pnpm --filter @fluid-wallet/extension build

# chrome://extensions → Developer mode → Load unpacked
# select apps/extension/dist/chrome-mv3`}</code>
          </pre>
          <p>
            The app side is one package: <code>npm install @fluid-wallet/sdk</code>. Its types ship
            with it, so <code>{`import { connectFluid } from "@fluid-wallet/sdk"`}</code>{" "}
            type-checks with nothing else installed. <code>@fluid-wallet/protocol</code> arrives as
            a dependency, and is only worth installing on its own if you are writing a wallet rather
            than calling one.
          </p>
        </section>

        <section id="wallet">
          <h2>2 · Set up the wallet</h2>
          <p>
            Open the wallet, choose a master password, then add a provider. The DeepSeek preset only
            pre-fills the name and the base URL — any OpenAI-compatible endpoint works. It carries
            no model list: press <strong>Fetch models</strong> to read the catalogue from the
            provider itself, because a hardcoded list is wrong the week after it ships. The API key
            is encrypted with AES-GCM under a key derived from your password (PBKDF2, 210k
            iterations) and never leaves the extension.
          </p>
          <p>
            Press <strong>Test</strong> to make one small request. A wrong key and a wrong base URL
            fail differently, and the wallet shows which.
          </p>
        </section>

        <section id="fetch">
          <h2>3 · Drop-in fetch</h2>
          <p>
            The shortest path, and the one that keeps your existing code: connect, then hand the
            wallet&apos;s <code>fetch</code> to the provider SDK you already use. Streaming, tools,
            JSON mode and abort all keep working because the request body is forwarded untouched.
          </p>
          <pre>
            <code>{`import { connectFluid } from "@fluid-wallet/sdk";
import { createOpenAI } from "@ai-sdk/openai";

const fluid = await connectFluid({
  appName: "My app",
  providerId: "deepseek",
  reason: "Explain the selected sequence.",
});

const deepseek = createOpenAI({
  apiKey: "fluid",                              // placeholder — the wallet injects the real key
  baseURL: "https://api.deepseek.com/v1",
  fetch: fluid.createFetch(),
});

const result = await streamText({ model: deepseek("deepseek-chat"), messages, tools });`}</code>
          </pre>
          <p className="note">
            Your app sends a path, never a host. The wallet appends it to the provider you
            configured, so a compromised page cannot redirect the request — and the key never enters
            the page.
          </p>
          <h3>When the wallet refuses</h3>
          <p>
            A refusal is not a transport error. &ldquo;The wallet is locked&rdquo; and &ldquo;the
            provider returned 500&rdquo; both arrive as rejections, but only one of them is the
            person in front of the screen&apos;s to fix. Map them once, near the top of your app:
          </p>
          <pre>
            <code>{`import { describeFluidError } from "@fluid-wallet/sdk";

try {
  await streamText({ model, messages });
} catch (error) {
  const issue = describeFluidError(error);
  // issue.kind:   "locked" | "not-connected" | "denied" | "budget" | "provider" | …
  // issue.action: "unlock" | "connect" | "approve" | "wait" | "fix-provider" | "none"
  showBanner(issue.title, issue.detail);
}`}</code>
          </pre>
          <p className="note">
            <code>client.usage()</code> returns today&apos;s request budget for the origin, so a
            chat UI can warn before the limit is hit instead of after. Against a wallet that
            predates the method it returns <code>null</code> rather than throwing.
          </p>
        </section>

        <section id="vanilla">
          <h2>4 · Structured chat</h2>
          <p>
            Use the structured API when you want the wallet to own the message shape and keep the
            conversation on the user&apos;s device. Provider details disappear from your client
            entirely.
          </p>
          <pre>
            <code>{`import { FluidClient } from "@fluid-wallet/sdk";

const client = new FluidClient({ appId: "my-app", appName: "My App" });
const info = await client.detect();          // null when not installed
if (!info) showInstallPrompt();

await client.connect();                      // opens the approval window
const session = await client.createSession({ model: "deepseek-chat" });

const handle = client.createInference({
  sessionId: session.id,
  messages: [{ role: "user", content: "Hello" }],
});

for await (const event of handle.events) {
  if (event.type === "inference.delta") render((event.payload as { text: string }).text);
}

const result = await handle.completed;       // final text, usage, finish reason`}</code>
          </pre>
          <p className="note">
            Connection, authorization, session and inference state are separate on purpose. Treating
            them as one boolean is how apps end up showing “connected” while every call fails.
          </p>
        </section>

        <section id="react">
          <h2>5 · React</h2>
          <pre>
            <code>{`import { FluidProvider, useFluidWallet, useFluidModels } from "@fluid-wallet/sdk/react";

export function App() {
  return (
    <FluidProvider clientOptions={{ appId: "my-app", appName: "My App" }}>
      <Chat />
    </FluidProvider>
  );
}

function Chat() {
  const { state, connect } = useFluidWallet();
  const models = useFluidModels();
  // state.availability · state.connection · state.authorization · state.inference
}`}</code>
          </pre>
        </section>

        <section id="ai-sdk">
          <h2>6 · Vercel AI SDK</h2>
          <p>
            Two ways in. Swap the transport to keep <code>useChat</code> and let the wallet shape
            each turn; or keep your existing provider and only replace <code>fetch</code> (section
            3), which keeps every model option available.
          </p>
          <pre>
            <code>{`import { useChat } from "@ai-sdk/react";
import { FluidChatTransport } from "@fluid-wallet/sdk/ai";
import { FluidClient } from "@fluid-wallet/sdk";

const client = new FluidClient({ appName: "My app" });
await client.connect();

const chat = useChat({
  transport: new FluidChatTransport({ client, model: "deepseek-chat" }),
});`}</code>
          </pre>
          <p className="note">
            Tools stay in your app in both modes: the model asks, your code runs, the wallet only
            carries the message. It never executes your functions.
          </p>
        </section>

        <section id="protocol">
          <h2>7 · Protocol</h2>
          <p>
            Requests are JSON-RPC 2.0 envelopes over the page bridge. The full spec lives in{" "}
            <code>specs/protocol.md</code>; the table below is the current method set.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {methods.map(([method, purpose]) => (
                  <tr key={method}>
                    <td>
                      <code>{method}</code>
                    </td>
                    <td>{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            Anything not in the granted capability set fails inside the wallet, not in the SDK. The
            SDK is a convenience layer; it is never the security boundary.
          </p>
        </section>

        <section id="security">
          <h2>8 · Security model</h2>
          <ul>
            <li>
              <strong>Origin from the browser.</strong> The wallet reads the sender origin from the
              browser, never from the page payload.
            </li>
            <li>
              <strong>Keys never reach a page.</strong> Decryption happens inside the service
              worker; the page only ever receives text.
            </li>
            <li>
              <strong>Grants are scoped.</strong> Capabilities, providers and models are checked per
              request; revocation closes live sessions immediately.
            </li>
            <li>
              <strong>Raw requests are narrow.</strong> <code>inference:proxy</code> lets an app use
              its own SDK, but only along a path below the provider you configured — the host is
              never the page&apos;s choice.
            </li>
            <li>
              <strong>History is per origin.</strong> An app that asks for another app&apos;s
              conversation id gets “unknown conversation”, not a permission error — no probing.
            </li>
            <li>
              <strong>Logs carry no content.</strong> Duration, status, model and byte counts are
              recorded; prompts and answers are not. Raw requests log a path and a status, nothing
              more.
            </li>
          </ul>
          <p className="note">
            The wallet cannot protect you from malware on your own machine, and it cannot stop you
            from pasting a key into a malicious site yourself. It removes the need to.
          </p>
        </section>
      </div>
    </main>
  );
}
