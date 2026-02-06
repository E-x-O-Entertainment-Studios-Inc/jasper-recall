/**
 * Jasper Recall OpenClaw Plugin
 * 
 * Semantic search over indexed memory using ChromaDB.
 * "Remember everything. Recall what matters."
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';

interface PluginConfig {
  enabled?: boolean;
  autoRecall?: boolean;
  defaultLimit?: number;
  publicOnly?: boolean;
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

  api.logger.info(`[jasper-recall] Initialized (limit=${defaultLimit}, publicOnly=${publicOnly})`);

  // Register the recall tool
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

  // Register /recall command for manual searches
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

  // Register /index command to re-index memory
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

  // Register RPC methods for external integrations
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
