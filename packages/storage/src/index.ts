import type { EncryptedSecret } from "@fluid-wallet/crypto";
import type { FluidPermission, FluidRole, FluidSessionStatus } from "@fluid-wallet/protocol";
import Dexie, { type EntityTable } from "dexie";

export const FLUID_DATABASE_NAME = "fluid-wallet";
export const FLUID_SCHEMA_VERSION = 1;

/** A configured model provider. The secret is an encrypted envelope, never a raw key. */
export interface ProviderRecord {
  id: string;
  name: string;
  kind: "openai-compatible";
  baseUrl: string;
  defaultModel?: string;
  models: string[];
  secret?: EncryptedSecret;
  createdAt: number;
  updatedAt: number;
}

/** One standing grant per origin: re-approving replaces the record. */
export interface ConnectionRecord {
  origin: string;
  appId?: string;
  permission: FluidPermission;
  createdAt: number;
  updatedAt: number;
}

export interface SessionRecord {
  id: string;
  origin: string;
  appId?: string;
  model?: string;
  status: FluidSessionStatus;
  conversationId?: string;
  createdAt: number;
  expiresAt?: number;
}

export interface ConversationRecord {
  id: string;
  origin: string;
  appId?: string;
  title?: string;
  model?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: FluidRole;
  content: string;
  toolCalls?: unknown;
  createdAt: number;
}

export interface ToolCallRecord {
  id: string;
  sessionId: string;
  name: string;
  arguments: unknown;
  /** Summary or reference only: full tool output is not persisted by default. */
  resultPreview?: string;
  status: "pending" | "success" | "error" | "denied";
  createdAt: number;
}

/** Kept apart from conversations: logs never contain prompt or response bodies. */
export interface InferenceLogRecord {
  id: string;
  origin: string;
  appId?: string;
  providerId: string;
  model: string;
  status: "success" | "error" | "cancelled" | "timeout";
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

export class FluidDatabase extends Dexie {
  providers!: EntityTable<ProviderRecord, "id">;
  connections!: EntityTable<ConnectionRecord, "origin">;
  sessions!: EntityTable<SessionRecord, "id">;
  conversations!: EntityTable<ConversationRecord, "id">;
  messages!: EntityTable<MessageRecord, "id">;
  toolCalls!: EntityTable<ToolCallRecord, "id">;
  inferenceLogs!: EntityTable<InferenceLogRecord, "id">;
  settings!: EntityTable<SettingRecord, "key">;

  constructor(name: string = FLUID_DATABASE_NAME) {
    super(name);

    this.version(FLUID_SCHEMA_VERSION).stores({
      providers: "id, kind, updatedAt",
      connections: "origin, updatedAt",
      sessions: "id, origin, status, createdAt",
      conversations: "id, origin, updatedAt",
      messages: "id, conversationId, createdAt",
      toolCalls: "id, sessionId, status, createdAt",
      inferenceLogs: "id, origin, startedAt, status",
      settings: "key",
    });
  }
}

export function createFluidDatabase(name?: string): FluidDatabase {
  return new FluidDatabase(name);
}

export interface ExportBundle {
  version: number;
  exportedAt: number;
  providers: Array<Omit<ProviderRecord, "secret">>;
  connections: ConnectionRecord[];
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  inferenceLogs: InferenceLogRecord[];
}

/**
 * Exports everything except credentials.
 *
 * A backup that silently includes encrypted API keys is a liability: the user
 * would be handing out an offline-attackable file. Re-importing requires the
 * user to re-enter the key.
 */
export async function exportWithoutSecrets(db: FluidDatabase): Promise<ExportBundle> {
  const providers = await db.providers.toArray();

  return {
    version: FLUID_SCHEMA_VERSION,
    exportedAt: Date.now(),
    providers: providers.map(({ secret: _secret, ...rest }) => rest),
    connections: await db.connections.toArray(),
    conversations: await db.conversations.toArray(),
    messages: await db.messages.toArray(),
    inferenceLogs: await db.inferenceLogs.toArray(),
  };
}
