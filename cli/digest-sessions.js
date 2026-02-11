#!/usr/bin/env node
/**
 * digest-sessions — Extract summaries from OpenClaw session logs
 * 
 * Usage:
 *   npx jasper-recall digest-sessions [--all] [--recent N] [--dry-run]
 *   digest-sessions [--all] [--recent N] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// Config with environment overrides
const WORKSPACE = process.env.RECALL_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const SESSIONS_DIR = process.env.RECALL_SESSIONS_DIR || path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions');
const MEMORY_DIR = path.join(WORKSPACE, 'memory');
const DIGEST_DIR = path.join(MEMORY_DIR, 'session-digests');
const STATE_FILE = path.join(MEMORY_DIR, '.digest-state.json');

// Parse args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');
const recentIdx = args.indexOf('--recent');
const RECENT = recentIdx !== -1 ? parseInt(args[recentIdx + 1], 10) : null;

// Patterns to filter out from topics
const SKIP_PATTERNS = [
  /^\[message_id:/,
  /^System:/,
  /^\{/,
  /^<session-init>/,
  /^<session-identity>/,
  /^<relevant-memories>/,
  /^🔄 \*\*Fresh session/,
  /^Read HEARTBEAT\.md/,
  /^HEARTBEAT_OK/,
  /^NO_REPLY/,
  /^ANNOUNCE_SKIP/,
  /^Agent-to-agent/,
  /^📋 \*\*PR Review/,
  /^🤖 Codex/,
  /^✅ \*\*Hourly/,
  /^The following memories/,
  /^- \[memory\//,
  /^###\s+(IDENTITY|SOUL|USER)\.md/,
  /^cat ~/,
  /^```/,
  /^---$/,
];

function shouldSkip(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 5) return true;
  return SKIP_PATTERNS.some(p => p.test(trimmed));
}

async function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {}
  return { processed: [], lastRun: 0 };
}

function saveState(state) {
  state.lastRun = Date.now();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function parseSession(sessionFile) {
  const topics = [];
  const toolCounts = {};
  let messageCount = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(sessionFile),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      messageCount++;
      
      // Extract user messages for topics
      if (entry.message?.role === 'user') {
        let content = entry.message.content;
        
        // Handle array content (multi-part messages)
        if (Array.isArray(content)) {
          content = content
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join(' ');
        }
        
        if (typeof content === 'string') {
          // Split into lines and filter
          const lines = content.split('\n');
          for (const l of lines) {
            if (!shouldSkip(l) && topics.length < 20) {
              topics.push(l.trim().slice(0, 200));
            }
          }
        }
      }
      
      // Count tool usage
      if (entry.message?.role === 'assistant' && Array.isArray(entry.message.content)) {
        for (const part of entry.message.content) {
          if (part.type === 'toolCall' || part.type === 'tool_use') {
            const name = part.name || part.toolName || 'unknown';
            toolCounts[name] = (toolCounts[name] || 0) + 1;
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Sort tools by usage
  const tools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name} (${count}x)`)
    .join(', ');

  return { topics: topics.slice(0, 10), tools: tools || 'none', messageCount };
}

async function main() {
  // Ensure directories exist
  fs.mkdirSync(DIGEST_DIR, { recursive: true });

  // Check sessions dir
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.log(`⚠ Sessions directory not found: ${SESSIONS_DIR}`);
    process.exit(0);
  }

  // Get session files
  const sessionFiles = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace('.jsonl', ''));

  if (sessionFiles.length === 0) {
    console.log('No session files found.');
    process.exit(0);
  }

  // Load state
  const state = await readState();
  const processed = new Set(state.processed);

  // Filter to new sessions (unless --all)
  let toProcess = ALL 
    ? sessionFiles 
    : sessionFiles.filter(s => !processed.has(s));

  // Apply --recent limit
  if (RECENT && RECENT > 0) {
    toProcess = toProcess.slice(-RECENT);
  }

  if (toProcess.length === 0) {
    console.log('✓ No new sessions to digest.');
    process.exit(0);
  }

  console.log('🦊 Jasper Recall — Session Digester');
  console.log('='.repeat(40));
  console.log(`Sessions to process: ${toProcess.length}\n`);

  for (const sessionId of toProcess) {
    const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
    if (!fs.existsSync(sessionFile)) continue;

    const stats = fs.statSync(sessionFile);
    const size = (stats.size / 1024).toFixed(0) + 'K';
    const date = stats.mtime.toISOString().split('T')[0];

    console.log(`Processing: ${sessionId.slice(0, 8)}... (${size})`);

    try {
      const { topics, tools, messageCount } = await parseSession(sessionFile);
      
      const digestFile = path.join(DIGEST_DIR, `${sessionId.slice(0, 8)}-${date}.md`);
      
      const topicsFormatted = topics.length > 0
        ? topics.map(t => `- ${t}`).join('\n')
        : '- (no topics extracted)';

      const content = `# Session ${sessionId.slice(0, 8)} — ${date}

**Size:** ${size} | **Messages:** ${messageCount}
**Tools:** ${tools}

## Topics

${topicsFormatted}

---
*Full session: ${sessionFile}*
`;

      if (!DRY_RUN) {
        fs.writeFileSync(digestFile, content);
        state.processed.push(sessionId);
        console.log(`  ✓ Created: ${path.basename(digestFile)}`);
      } else {
        console.log(`  [dry-run] Would create: ${path.basename(digestFile)}`);
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
    }
  }

  if (!DRY_RUN) {
    saveState(state);
  }

  console.log(`\n✓ Digests saved to: ${DIGEST_DIR}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
