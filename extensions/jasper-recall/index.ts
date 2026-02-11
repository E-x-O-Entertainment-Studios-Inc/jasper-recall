/**
 * Jasper Recall OpenClaw Plugin
 * 
 * Semantic search over indexed memory using ChromaDB.
 * "Remember everything. Recall what matters."
 * 
 * Features:
 * - `recall` tool for manual searches
 * - `/recall` command for quick lookups
 * - Auto-recall: inject relevant memories before agent processing
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

interface PluginConfig {
  enabled?: boolean;
  autoRecall?: boolean;
  defaultLimit?: number;
  publicOnly?: boolean;
  minScore?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

interface PluginApi {
  config: {
    plugins?: {
      entries?: {
        'jasper-recall'?: {
          config?: PluginConfig;
        };
      };
    };
  };
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  registerTool: (tool: any) => void;
  registerCommand: (cmd: any) => void;
  registerGatewayMethod: (name: string, handler: any) => void;
  on: (event: string, handler: (event: any) => Promise<any>) => void;
}

const BIN_PATH = path.join(os.homedir(), '.local', 'bin');

function runRecall(query: string, options: { limit?: number; json?: boolean; publicOnly?: boolean } = {}): string {
  const args = [JSON.stringify(query)];
  if (options.limit) args.push('-n', String(options.limit));
  if (options.json) args.push('--json');
  if (options.publicOnly) args.push('--public-only');
  
  const recallPath = path.join(BIN_PATH, 'recall');
  try {
    return execSync(`${recallPath} ${args.join(' ')}`, { encoding: 'utf8', timeout: 30000 });
  } catch (err: any) {
    throw new Error(`Recall failed: ${err.message}`);
  }
}

export default function register(api: PluginApi) {
  const cfg = api.config.plugins?.entries?.['jasper-recall']?.config ?? {};
  
  if (cfg.enabled === false) {
    api.logger.info('[jasper-recall] Plugin disabled');
    return;
  }

  const defaultLimit = cfg.defaultLimit ?? 5;
  const publicOnly = cfg.publicOnly ?? false;
  const autoRecall = cfg.autoRecall ?? false;
  const minScore = cfg.minScore ?? 0.3;

  api.logger.info(`[jasper-recall] Initialized (limit=${defaultLimit}, publicOnly=${publicOnly}, autoRecall=${autoRecall})`);

  // ============================================================================
  // Auto-Recall: inject relevant memories before agent processes the message
  // ============================================================================
  
  if (autoRecall) {
    api.on('before_agent_start', async (event: { 
      prompt?: string; 
      senderId?: string; 
      source?: string;
      isNewSession?: boolean;
      messageCount?: number;
      context?: { messages?: any[] };
    }) => {
      // Skip if no prompt or too short
      if (!event.prompt || event.prompt.length < 10) {
        return;
      }

      const prompt = event.prompt;
      
      // Detect fresh session (after /new or first message)
      const isFreshSession = event.isNewSession || 
                             event.messageCount === 0 || 
                             event.messageCount === 1 ||
                             (event.context?.messages?.length ?? 0) <= 1;

      // Skip heartbeats and system prompts
      if (prompt.startsWith('HEARTBEAT') || 
          prompt.startsWith('Read HEARTBEAT.md') ||
          prompt.includes('NO_REPLY') ||
          prompt.includes('HEARTBEAT_OK')) {
        return;
      }

      // Skip agent-to-agent messages (cron jobs, workers, spawned agents)
      if (event.source?.startsWith('cron:') ||
          event.source?.startsWith('agent:') ||
          event.source?.startsWith('spawn:') ||
          event.source === 'sessions_send' ||
          event.senderId?.startsWith('agent:') ||
          event.senderId?.startsWith('worker-')) {
        return;
      }

      // Skip common automated patterns
      if (prompt.startsWith('Agent-to-agent') ||
          prompt.startsWith('📋 PR Review') ||
          prompt.startsWith('🤖 Codex Watch') ||
          prompt.startsWith('ANNOUNCE_')) {
        return;
      }

      try {
        let prependParts: string[] = [];
        
        // If fresh session, inject identity files directly into context
        if (isFreshSession) {
          api.logger.info('[jasper-recall] Fresh session detected - injecting identity context');
          
          const workspace = path.join(os.homedir(), '.openclaw', 'workspace');
          const identityFiles = ['IDENTITY.md', 'SOUL.md', 'USER.md'];
          const identityParts: string[] = [];
          
          for (const file of identityFiles) {
            const filePath = path.join(workspace, file);
            if (existsSync(filePath)) {
              try {
                const content = readFileSync(filePath, 'utf8');
                identityParts.push(`### ${file}\n${content}`);
              } catch (err: any) {
                api.logger.warn(`[jasper-recall] Failed to read ${file}: ${err.message}`);
              }
            }
          }
          
          if (identityParts.length > 0) {
            prependParts.push(`<session-identity>
🔄 **Fresh session.** Your identity files:

${identityParts.join('\n\n---\n\n')}
</session-identity>`);
          }
        }
        
        const results = runRecall(event.prompt, {
          limit: 3,
          json: true,
          publicOnly,
        });

        const parsed = JSON.parse(results);
        
        // Filter by minimum score
        const relevant = parsed.filter((r: any) => r.score >= minScore);

        if (relevant.length > 0) {
          // Format memories for context injection
          const memoryContext = relevant
            .map((r: any) => `- [${r.source || 'memory'}] ${r.content.slice(0, 500)}${r.content.length > 500 ? '...' : ''}`)
            .join('\n');

          api.logger.info(`[jasper-recall] Auto-injecting ${relevant.length} memories into context`);

          prependParts.push(`<relevant-memories>
The following memories may be relevant to this conversation:
${memoryContext}
</relevant-memories>`);
        } else {
          api.logger.debug?.('[jasper-recall] No relevant memories found for auto-recall');
        }

        if (prependParts.length > 0) {
          return {
            prependContext: prependParts.join('\n\n'),
          };
        }
      } catch (err: any) {
        api.logger.warn(`[jasper-recall] Auto-recall failed: ${err.message}`);
        
        // Still inject identity context on fresh session even if recall fails
        if (isFreshSession) {
          const workspace = path.join(os.homedir(), '.openclaw', 'workspace');
          const identityFiles = ['IDENTITY.md', 'SOUL.md', 'USER.md'];
          const identityParts: string[] = [];
          
          for (const file of identityFiles) {
            const filePath = path.join(workspace, file);
            if (existsSync(filePath)) {
              try {
                const content = readFileSync(filePath, 'utf8');
                identityParts.push(`### ${file}\n${content}`);
              } catch {
                // Skip unreadable files
              }
            }
          }
          
          if (identityParts.length > 0) {
            return {
              prependContext: `<session-identity>
🔄 **Fresh session.** Your identity files:

${identityParts.join('\n\n---\n\n')}
</session-identity>`,
            };
          }
        }
      }
    });
  }

  // ============================================================================
  // Tool: recall
  // ============================================================================

  api.registerTool({
    name: 'recall',
    description: 'Semantic search over indexed memory (daily notes, session digests, documentation). Use to find context from past conversations, decisions, and learnings.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query - natural language question or keywords',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    },
    execute: async (_id: string, { query, limit }: { query: string; limit?: number }) => {
      try {
        const results = runRecall(query, {
          limit: limit ?? defaultLimit,
          json: true,
          publicOnly,
        });

        const parsed = JSON.parse(results);
        
        // Format results for agent consumption
        let formatted = `## Recall Results for: "${query}"\n\n`;
        
        if (parsed.length === 0) {
          formatted += '_No relevant memories found._\n';
        } else {
          for (const result of parsed) {
            formatted += `### ${result.source || 'Memory'}\n`;
            formatted += `**Score:** ${(result.score * 100).toFixed(1)}%\n\n`;
            formatted += `${result.content}\n\n---\n\n`;
          }
        }

        api.logger.info(`[jasper-recall] Query "${query}" returned ${parsed.length} results`);

        return { content: [{ type: 'text', text: formatted }] };
      } catch (err: any) {
        api.logger.error(`[jasper-recall] Error: ${err.message}`);
        return { content: [{ type: 'text', text: `Recall error: ${err.message}` }] };
      }
    },
  });

  // ============================================================================
  // Command: /recall
  // ============================================================================

  api.registerCommand({
    name: 'recall',
    description: 'Search memory for relevant context',
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: { args?: string }) => {
      const query = ctx.args?.trim();
      if (!query) {
        return { text: '⚠️ Usage: /recall <search query>' };
      }

      try {
        const results = runRecall(query, { limit: defaultLimit, publicOnly });
        return { text: `🧠 **Recall Results**\n\n${results}` };
      } catch (err: any) {
        return { text: `❌ Recall failed: ${err.message}` };
      }
    },
  });

  // ============================================================================
  // Command: /index
  // ============================================================================

  api.registerCommand({
    name: 'index',
    description: 'Re-index memory files into ChromaDB',
    acceptsArgs: false,
    requireAuth: true,
    handler: async () => {
      try {
        const indexPath = path.join(BIN_PATH, 'index-digests');
        const output = execSync(indexPath, { encoding: 'utf8', timeout: 120000 });
        return { text: `🔄 **Memory Indexed**\n\n${output}` };
      } catch (err: any) {
        return { text: `❌ Index failed: ${err.message}` };
      }
    },
  });

  // ============================================================================
  // Command: /digest-sessions
  // ============================================================================

  api.registerCommand({
    name: 'digest-sessions',
    description: 'Extract summaries from session logs into memory',
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: { args?: string }) => {
      try {
        const args = ctx.args?.trim() || '';
        const digestPath = path.join(BIN_PATH, 'digest-sessions');
        
        // Check if digest-sessions exists in PATH, otherwise use npx
        let cmd: string;
        try {
          execSync(`which ${digestPath}`, { encoding: 'utf8' });
          cmd = `${digestPath} ${args}`;
        } catch {
          // Fall back to npx
          cmd = `npx jasper-recall digest-sessions ${args}`;
        }
        
        const output = execSync(cmd, { encoding: 'utf8', timeout: 300000 });
        return { text: `🗂️ **Session Digests**\n\n${output}` };
      } catch (err: any) {
        return { text: `❌ Digest failed: ${err.message}` };
      }
    },
  });

  // ============================================================================
  // Command: /jasper-recall setup
  // ============================================================================

  api.registerCommand({
    name: 'jasper-recall',
    description: 'Jasper Recall setup and status',
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: { args?: string }) => {
      const subcommand = ctx.args?.trim().toLowerCase();
      
      if (subcommand === 'setup') {
        return {
          text: `🧠 **Jasper Recall Setup**

**Current status:**
- Auto-recall: ${autoRecall ? '✅ Enabled' : '❌ Disabled'}
- Public-only mode: ${publicOnly ? '✅ Yes' : '❌ No (full access)'}
- Default limit: ${defaultLimit} results
- Min score: ${minScore}

---

<agent-action required="true">
**CREATE THESE CRON JOBS NOW:**

1. **Index memories every 6 hours:**
   - Name: "jasper-recall-index"
   - Schedule: \`{ "kind": "cron", "expr": "0 */6 * * *" }\`
   - Payload: \`{ "kind": "systemEvent", "text": "Run index-digests to update jasper-recall ChromaDB index" }\`
   - Session target: "main"

2. **Digest sessions daily at 4am:**
   - Name: "jasper-recall-digest"  
   - Schedule: \`{ "kind": "cron", "expr": "0 4 * * *" }\`
   - Payload: \`{ "kind": "systemEvent", "text": "Run digest-sessions to extract summaries from recent session logs into memory" }\`
   - Session target: "main"

Use the \`cron\` tool with \`action: "add"\` to create both jobs.
</agent-action>`,
        };
      }
      
      if (subcommand === 'status') {
        try {
          // Check if ChromaDB is accessible
          const testResult = runRecall('test query', { limit: 1, json: true, publicOnly });
          const parsed = JSON.parse(testResult);
          
          return {
            text: `🧠 **Jasper Recall Status**

**Plugin:** ✅ Active
**Auto-recall:** ${autoRecall ? '✅ Enabled' : '❌ Disabled'}
**ChromaDB:** ✅ Connected
**Index size:** ${parsed.length > 0 ? 'Has data' : 'Empty or minimal'}

**Config:**
- Public-only: ${publicOnly}
- Default limit: ${defaultLimit}
- Min score: ${minScore}`,
          };
        } catch (err: any) {
          return {
            text: `🧠 **Jasper Recall Status**

**Plugin:** ✅ Active
**Auto-recall:** ${autoRecall ? '✅ Enabled' : '❌ Disabled'}
**ChromaDB:** ❌ Error - ${err.message}

Run \`npx jasper-recall setup\` to install dependencies.`,
          };
        }
      }
      
      // Default: show help
      return {
        text: `🧠 **Jasper Recall**

**Commands:**
- \`/jasper-recall setup\` — Setup instructions & cron jobs
- \`/jasper-recall status\` — Check plugin status
- \`/recall <query>\` — Search memory
- \`/index\` — Re-index memory files

**CLI:**
- \`npx jasper-recall setup\` — Install Python dependencies
- \`npx jasper-recall doctor\` — Health check`,
      };
    },
  });

  // ============================================================================
  // RPC Methods
  // ============================================================================

  api.registerGatewayMethod('recall.search', async ({ params, respond }: any) => {
    try {
      const { query, limit } = params;
      const results = runRecall(query, { limit: limit ?? defaultLimit, json: true, publicOnly });
      respond(true, JSON.parse(results));
    } catch (err: any) {
      respond(false, { error: err.message });
    }
  });

  api.registerGatewayMethod('recall.index', async ({ respond }: any) => {
    try {
      const indexPath = path.join(BIN_PATH, 'index-digests');
      execSync(indexPath, { encoding: 'utf8', timeout: 120000 });
      respond(true, { status: 'indexed' });
    } catch (err: any) {
      respond(false, { error: err.message });
    }
  });
}

export const id = 'jasper-recall';
export const name = 'Jasper Recall - Local RAG Memory';
