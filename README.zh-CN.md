# 流钥 · Fluid Wallet

[English](README.md) · **简体中文**

**开源的、本地优先的 LLM 钱包与访问协议，面向 Web AI 应用。**
<sub>网站用得上你的 key，却永远拿不到它。</sub>

「流」是 token 一个接一个流出去，「钥」是开门的钥匙 —— 钥匙不进网站，只有答案流出来。

用户手里本来就有一个 DeepSeek（或任何 OpenAI 兼容）的 API key。但每个纯前端 AI
应用都要他们重新粘贴一遍、存进 `localStorage`、再单独配置一次模型参数。流钥把这件事挪到
一个地方：一个持有凭据的浏览器钱包，以及一套协议，让任何应用都能请求推理，而从不接触凭据。

> 状态：**MVP-03**。钱包已端到端可用：加密保险库、带连接测试与模型目录拉取的提供商管理、
> 连接审批、按范围授权的权限、流式推理、取消、活动日志，以及一条原始代理通路，让应用可以继续
> 用自己熟悉的提供商 SDK。审批在工具栏弹层里完成，只有不支持 `action.openPopup` 的浏览器才
> 会退回独立窗口。对没有配置任何提供商的钱包发起连接请求会被拒绝，并弹出一个直达提供商表单的
> 窗口。面板中英双语，可在顶部切换。每个 release 都附带可直接加载的 zip 包；商店上架与工具调用
> 往返是接下来的事。

## 设计原则

- **凭据归用户所有** —— key 存在钱包里，静态加密。
- **一次连接** —— 一份按范围授权的许可，覆盖该源上的所有应用。
- **本地优先** —— 没有账号服务器，没有云端中转，没有遥测。
- **协议开放** —— 有版本、有文档，第三方可以据此实现一个兼容钱包。
- **工具自带** —— 工具定义与执行都留在应用侧。

## 架构

```
AI 应用           ChemBioTube · GeneFlow · 第三方 Web 应用
                  UI · 业务状态 · 工具 · 应用上下文
        │
Fluid SDK         连接 · 权限 · 会话 · 对话 · 流 · 工具桥
        │
Fluid Wallet      扩展：保险库 · 模型路由 · 对话 · 调用日志
        │
LLM 提供商        DeepSeek · OpenAI 兼容端点 · 后续更多
```

页面永远到不了提供商 API。每一次调用都穿过同一道经过校验的边界：
发送方源 → 权限 → 会话 → 限流 → 提供商。

## 目录

```
apps/
  extension/      WXT (MV3) + React 钱包：页面桥、service worker、弹层
    src/components/ui/  shadcn 组件（Radix + Tailwind v4）
    src/styles.css      Tailwind 入口：钱包的配色作为主题变量
  website/        Next.js 站点：产品页、文档、快速开始
  playground/     协议控制台：探测、连接、流式
packages/
  protocol/       线路类型、方法、错误码、校验器        （已发布，零依赖）
  sdk/            客户端、connectFluid、createFetch、错误 （已发布）
    src/react/    Provider 与 hooks          → /react
    src/ai/       Vercel AI SDK transport     → /ai
    src/testing/  内存版 mock 钱包            → /testing
  core/           钱包内核，只有扩展会引用它            （私有，不发布）
    src/crypto/     PBKDF2 + AES-GCM 密钥保险库
    src/providers/  OpenAI 兼容适配器（SSE、usage、tools）
    src/runtime/    来源校验、权限、会话、限流
    src/storage/    Dexie / IndexedDB schema
examples/
  vanilla-js/     纯 TypeScript 集成，不用框架
specs/
  protocol.md · permissions.md · streaming.md · security.md
```

三个包，一次安装：应用方装 `@fluid-wallet/sdk`；将来自己实现钱包的人只需要
`@fluid-wallet/protocol`。`core` 永不发布 —— 它假定有 IndexedDB、Web Crypto 和
service worker，且编码的是我们的取舍，而不是一份值得向别人承诺的接口。

钱包 UI 是 Tailwind v4 上的 shadcn/ui，组件是**落在仓库里**
（`apps/extension/src/components/ui/`）而不是装进来的：这样改一条规则就是本仓库的一处
diff，而不是一次版本升级、要重新验证另外六个界面。`src/styles.css` 里的配色与手写样式表
时期是同一套，只是映射到 shadcn 的变量名上，于是这些组件看起来像这个钱包，而不是像它们自带的
demo。

## 安装扩展

还没有上架，所以要从 release 附带的 zip 安装。Chrome、Edge、Brave 步骤相同，只是地址不同
（`chrome://extensions`、`edge://extensions`、`brave://extensions`）。

1. 从 [Releases](https://github.com/yuanluoyue/fluid-wallet/releases/latest) 下载
   `fluid-wallet-0.1.0-chrome.zip`。
2. 解压到一个**你会一直留着的**文件夹，例如 `~/Applications/fluid-wallet`。
3. 打开 `chrome://extensions`，打开右上角的**开发者模式**，点**加载已解压的扩展程序**，
   选择那个文件夹（含 `manifest.json` 的那一层，不是它的上一层）。
4. 点工具栏图标：设置主密码，然后添加一个提供商和它的 API key。

用之前有两件事值得知道：

- **装好之后不要重命名或移动文件夹。** 已解压扩展的 ID 由路径推导，挪了位置就变成另一个
  扩展、一个空钱包。确要移动，先用面板里的加密备份导出——保险库不会自己跟过去。
- **更新是手动的。** 下载新的 zip、替换文件夹内容、在扩展卡片上按 ⟳。钱包会保留；
  整目录替换则不一定，取决于解压工具怎么写文件。

| 渠道            | 状态 | 安装方式                         |
| --------------- | ---- | -------------------------------- |
| GitHub release  | 可用 | 手动「加载已解压的扩展程序」     |
| Edge 加载项商店 | 计划 | 免费商店，一键安装               |
| Chrome 应用商店 | 计划 | 一键安装，需要 $5 开发者账号     |
| Firefox         | 计划 | 需要单独的 `-b firefox` 构建目标 |

面板就是全部界面：锁定状态、提供商、各站点授权、活动日志与待审批的请求都在那里。审批提示就在
同一面板中打开，只有在不支持 `action.openPopup` 的浏览器上才会另开窗口。

## 从源码开始

```bash
pnpm install
pnpm build        # 编译 workspace 里的包
pnpm typecheck
pnpm test
```

然后在各自的终端里：

```bash
pnpm build:extension   # 一次性构建 → apps/extension/dist/chrome-mv3
pnpm dev:playground    # http://localhost:5174
pnpm dev:website       # http://localhost:3000
```

扩展构建故意不自动拉起来：Chrome 没有办法「盯着一个文件夹」，所以
`加载已解压的扩展程序` → `apps/extension/dist/chrome-mv3` 是一次性动作，重新构建后按卡片上的
⟳ 即可。（用 `dist/` 而不是 WXT 默认的 `.output/`，因为选择器会隐藏以点开头的文件夹。）

**除非你正在改面板，否则加载 `dist/chrome-mv3`。** `pnpm dev:extension` 起的是 wxt 的
开发服务器，产物写在 `dist/chrome-mv3-dev`，它不是一个独立扩展：`popup.html` 指向开发
服务器，`content_scripts` 是通过开发服务器的 websocket 注册的，而不是写进 manifest。进程
一停，那个文件夹还留在磁盘上、看起来能加载，实际上什么都不注入——面板空白、没有
`window.fluid`、每个页面都报 `No wallet found`。为了防止它变成陷阱，
`pnpm dev:extension` 退出时会删掉 `dist/chrome-mv3-dev`；如果 Chrome 还指着它，
把卡片重新指向 `dist/chrome-mv3` 即可。

|                        | 文件夹                | 是否独立可加载       |
| ---------------------- | --------------------- | -------------------- |
| `pnpm build:extension` | `dist/chrome-mv3`     | 是，加载后可以不管它 |
| `pnpm dev:extension`   | `dist/chrome-mv3-dev` | 否，且退出时会被删掉 |

对 Chrome 来说这是两个不同的扩展，ID 不同，钱包也就各自独立：来回切换不会把保险库或授权
带过去。

当页面报 `No wallet found`，在动其他东西之前先做一个检查——在页面控制台里，
`window.fluid` 要么是对象（扩展注入了，问题在它的 worker），要么是 `undefined`
（这个页面上没有任何脚本跑过）。playground 会把这个值显示在状态标签旁边。

超出这一步，playground 的 **Diagnose** 按钮会一次打印整条链路：桥的计数器
（`window.fluid.diagnostics()`）、一次裸的 `wallet.getInfo` 及其往返耗时和原始信封、
以及每一次 `detect()` 尝试和它耗掉的时限。同样几跳会在页面控制台打
`[fluid-wallet]` 日志（relay 转发、worker 的应答与延迟），也在 service worker 自己的
控制台（chrome://extensions → Fluid Wallet → service worker）里——`dispatch` 慢会
在那里现形。失败卡片还会把这些计数引在 `action:` 下面，所以一张截图就足够说明问题。

## 部署网站

`apps/website` 通过 OpenNext 部署到 Cloudflare Workers，与 ChembioTube 同一套：
`next build --webpack` → `opennextjs-cloudflare build` → `wrangler deploy`。站点是全静态
预渲染的，所以 Workers Cache 命中时根本不会执行 Worker，而缓存拦截让冷未命中也能压在免费
套餐的 CPU 上限之下。

```bash
pnpm --filter @fluid-wallet/website deploy    # 构建并部署

# 本地边缘预览（workerd，真实绑定）
pnpm --filter @fluid-wallet/website preview
```

首次部署需要 `wrangler login`（或 `CLOUDFLARE_API_TOKEN`）。Worker 名是
`fluid-wallet-website`；DNS 就绪后把自定义域名写进 `wrangler.jsonc`。没有 D1 绑定——
钱包把一切留在浏览器里，站点不需要数据库。

## 使用 SDK

两条路。按「应用想自己掌控多少请求」来选。

### 1. 保留你原有的提供商 SDK（已有应用推荐）

`connectFluid()` 连接、征得同意、开启会话，然后返回一个 `fetch`。把它交给你本来就在用的
提供商 SDK，其他什么都不用改——流式、工具调用、JSON 模式都能工作，因为请求是原样穿过去的。

```ts
import { connectFluid } from "@fluid-wallet/sdk";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

const fluid = await connectFluid({
  appName: "ChemBioTube",
  providerId: "deepseek",
  reason: "解释当前选中的序列。",
});

// 任何接受 `fetch` 选项的提供商包都能用：@ai-sdk/deepseek、@ai-sdk/openai，
// 或官方 openai 客户端。
const deepseek = createOpenAI({
  apiKey: "fluid", // 占位符：真正的 key 由钱包注入
  baseURL: "https://api.deepseek.com/v1",
  fetch: fluid.createFetch(),
});

const result = streamText({ model: deepseek("deepseek-chat"), messages, tools });
```

应用只提供**路径**。协议、主机和 key 都来自用户配置的提供商，所以一个被攻破的页面没法把
钱包指向别处。这条路径需要 `inference:proxy` 能力，`connectFluid` 会申请它，审批窗口会
把它写清楚。

### 2. 让钱包来组织请求

当应用希望由钱包记录对话、并让提供商细节完全不进入客户端时，用结构化 API：

```ts
import { FluidClient } from "@fluid-wallet/sdk";

const client = new FluidClient({ appName: "My app" });

await client.connect({
  capabilities: ["wallet:read", "models:list", "inference:text", "inference:stream"],
  reason: "回答关于当前文档的问题。",
});

const session = await client.createSession({ model: "deepseek-chat" });
const inference = client.createInference({
  sessionId: session.id,
  messages: [{ role: "user", content: "总结这一页。" }],
  stream: true,
});

for await (const event of inference.events) {
  if (event.type === "inference.delta")
    process.stdout.write((event.payload as { text: string }).text);
}
```

`FluidClient.state` 故意把 `availability`、`connection`、`authorization`、`session` 和
每个请求的 `inference` 状态分开——一个 `isConnected` 布尔值恰好会盖住用户真正会遇到的
那几类故障。

### 没有扩展时怎么开发

没有钱包应答时，`connectFluid()` 会退化为直接调用 DeepSeek，但仅当存在开发用 key：

```bash
# .env.local — Vite 需要 VITE_ 前缀，Next.js 不需要
FLUID_DEV_API_KEY=sk-...
```

```ts
const fluid = await connectFluid({ appName: "My app" });
// 有扩展时 mode === "wallet"，没有时是 "dev"
```

应用里没有其他改动：`fluid.createFetch()` 用与钱包相同的辅助函数解析 URL。这个回退在生产
构建里拒绝运行，它只是便利，**从来不是安全边界**。

## 不打开浏览器也能测

`@fluid-wallet/sdk/testing` 提供了一个实现协议的**内存版钱包**，包括 `inference.proxy`：

```ts
import { createMockWallet } from "@fluid-wallet/sdk/testing";
import { FluidClient, BridgeTransport, connectFluid } from "@fluid-wallet/sdk";

const wallet = createMockWallet({ permissionMode: "auto" });
const client = new FluidClient({ transport: new BridgeTransport(wallet) });
const fluid = await connectFluid({ client });
```

它同时也是第三方钱包实现的一致性测试目标。

## 路线图

| 里程碑 | 范围                                         | 状态   |
| ------ | -------------------------------------------- | ------ |
| MVP-01 | Monorepo、协议、SDK、mock 钱包、一致性测试   | 完成   |
| MVP-02 | 加密保险库、提供商配置、审批弹窗、流式推理   | 完成   |
| MVP-03 | 对话、活动日志、AI SDK 适配器、React hooks   | 完成   |
| MVP-04 | 工具调用往返、Firefox 打包、商店上架、文档站 | 进行中 |

已知缺口，直说：

- **工具调用**会被流式传给应用并持久化，但钱包还不会等工具结果再继续一轮——循环由应用驱动。
- **token 计数只存在于结构化路径。** `inference.create` 会解析提供商的 SSE 流，所以每次
  调用都记录 prompt 与 completion token，活动日志能显示花了多少。`inference.proxy` 只
  转发字节、不读内容——钱包看到的是路径、状态码和字节数，看不到 body——这既让 drop-in
  SDK 兼容成为可能，也正是这条路径上的调用完全不记录 token 的原因（日志显示 `—`）。
  playground 是故意走代理路径的，所以那里的 token 计数一直是空的。
- **原始代理请求是不透明的。** 上面那个隐私取舍是双向的：对读不到的请求，钱包无法施加
  按应用的消费上限，也无法分辨它是 chat completion 还是 embeddings，只能看路径。
- **审批的韧性**：如果审批挂起期间 Chrome 杀掉了 service worker，挂起的 `wallet.connect`
  会失败，页面必须重试。
- **提供商广度**：DeepSeek 加任何 OpenAI 兼容端点。新增一个就是一个表单，钱包可以测试它并
  拉取它的 `/models` 目录，但没有 OAuth 或订阅 token 流程。这是有意的：每一个对外宣称的
  提供商都是一份要持续维护的 API 面。
- **钱包 UI 翻译**：中英文一起发布。UI 是本地化的；service worker 抛出的错误文本没有本地化，
  加第三种语言就是在 `zh.ts` 旁边加一个文件——类型是 `Messages`，所以不可能只存在一半。
- **预算**：限流按源计算，但没有按应用的消费上限，而原始请求不读内容就无法定价。

目前明确不做：托管计费、云账号、团队权限、应用目录，以及与 Vercel AI SDK 的完全对齐。

## 安全

贡献之前请先读 [`specs/security.md`](specs/security.md)。简短版：没有任何方法会返回凭据
材料，来源取自浏览器的发送方，解密只发生在可信上下文里，日志永远不含 prompt、响应或 key。

[`/privacy`](apps/website/app/privacy/page.tsx) 把同一件事讲给用户而不是贡献者听：
存了什么、什么会离开设备、以及每个权限为什么要。

## 参与贡献

[`CONTRIBUTING.md`](CONTRIBUTING.md) 很短，值得先知道的一点是：协议改动从 `specs/` 开始，
而不是从代码开始。安全问题走私密 advisory，不要开公开 issue。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
