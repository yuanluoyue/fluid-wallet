import { FluidClient } from "@fluid-wallet/sdk";

const output = document.querySelector<HTMLPreElement>("#output");
const promptInput = document.querySelector<HTMLInputElement>("#prompt");
const sendButton = document.querySelector<HTMLButtonElement>("#send");

if (!output || !promptInput || !sendButton) {
  throw new Error("Example markup is missing required elements.");
}

const view = { output, promptInput, sendButton };

function write(text: string): void {
  view.output.textContent = text;
}

/**
 * The whole integration surface: create a client, connect once, open a session
 * and read the stream. No key ever reaches this page.
 */
const client = new FluidClient({ appName: "Fluid vanilla example" });

view.sendButton.addEventListener("click", async () => {
  const prompt = view.promptInput.value.trim();
  if (!prompt) return;

  view.sendButton.disabled = true;
  write("connecting…");

  try {
    await client.connect({
      capabilities: ["wallet:read", "models:list", "inference:text", "inference:stream"],
    });

    const session = await client.createSession({ model: "deepseek-chat" });
    const inference = client.createInference({
      sessionId: session.id,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });

    write("");
    for await (const event of inference.events) {
      if (event.type === "inference.delta") {
        const { text } = event.payload as { text: string };
        view.output.textContent += text;
      }
    }

    const result = await inference.completed;
    view.output.textContent += `\n\n— ${result.model} · ${result.finishReason}`;
  } catch (error) {
    write(`error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    view.sendButton.disabled = false;
  }
});
