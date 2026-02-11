#!/usr/bin/env node
/**
 * Sandboxed Agent Setup for jasper-recall
 * 
 * Configures sandboxed agents to use jasper-recall with --public-only restriction.
 * This ensures agents can only access shared/public memories, not private ones.
 * 
 * Use cases:
 * - Moltbook scanner (social media engagement)
 * - Email agent (inbox management)
 * - Calendar agent (scheduling)
 * - Any agent that shouldn't see private memories
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const MAIN_WORKSPACE = path.join(OPENCLAW_DIR, 'workspace');
const RECALL_BIN = path.join(os.homedir(), '.local', 'bin', 'recall');

function log(msg) {
  console.log(`🔒 ${msg}`);
}

function warn(msg) {
  console.log(`⚠️  ${msg}`);
}

function error(msg) {
  console.error(`❌ ${msg}`);
}

function success(msg) {
  console.log(`✅ ${msg}`);
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function interactiveSetup() {
  console.log('');
  log('Sandboxed Agent Setup — jasper-recall Integration');
  console.log('='.repeat(60));
  console.log('');
  console.log('  This configures a sandboxed agent to use jasper-recall with');
  console.log('  privacy restrictions (--public-only).');
  console.log('');
  console.log('  🔒 Privacy: Sandboxed agents can ONLY see [public] memories.');
  console.log('              They cannot access your private notes or secrets.');
  console.log('');
  
  // List existing workspaces
  const workspaces = findAgentWorkspaces();
  
  if (workspaces.length === 0) {
    console.log('  No sandboxed agent workspaces found.');
    console.log('');
    console.log('  To create one, add an agent to your openclaw.json:');
    console.log('');
    showAgentExample();
    return;
  }
  
  console.log('  Found agent workspaces:');
  workspaces.forEach((ws, i) => {
    const status = checkWorkspaceStatus(ws.path);
    const statusIcon = status.configured ? '✅' : '⚪';
    console.log(`    ${i + 1}. ${statusIcon} ${ws.name} (${ws.path})`);
  });
  console.log('');
  
  const choice = await prompt('  Configure which agent? (number, or "skip" to exit): ');
  
  if (choice.toLowerCase() === 'skip' || choice === '') {
    console.log('\n  Skipped.\n');
    return;
  }
  
  const index = parseInt(choice, 10) - 1;
  if (isNaN(index) || index < 0 || index >= workspaces.length) {
    error('Invalid selection');
    return;
  }
  
  const selected = workspaces[index];
  await setupWorkspace(selected.path, selected.name);
}

function findAgentWorkspaces() {
  const workspaces = [];
  
  // Look for workspace-* directories
  try {
    const entries = fs.readdirSync(OPENCLAW_DIR);
    for (const entry of entries) {
      if (entry.startsWith('workspace-') && entry !== 'workspace') {
        const wsPath = path.join(OPENCLAW_DIR, entry);
        if (fs.statSync(wsPath).isDirectory()) {
          workspaces.push({
            name: entry.replace('workspace-', ''),
            path: wsPath
          });
        }
      }
    }
  } catch (e) {
    // Directory doesn't exist or not readable
  }
  
  return workspaces;
}

function checkWorkspaceStatus(wsPath) {
  const wrapperPath = path.join(wsPath, 'bin', 'recall');
  const sharedPath = path.join(wsPath, 'shared');
  
  let configured = false;
  
  if (fs.existsSync(wrapperPath)) {
    const content = fs.readFileSync(wrapperPath, 'utf8');
    configured = content.includes('--public-only');
  }
  
  return {
    configured,
    hasWrapper: fs.existsSync(wrapperPath),
    hasShared: fs.existsSync(sharedPath)
  };
}

async function setupWorkspace(wsPath, name) {
  console.log('');
  log(`Configuring ${name}...`);
  
  // Check prerequisites
  if (!fs.existsSync(RECALL_BIN)) {
    error(`jasper-recall not installed: ${RECALL_BIN}`);
    console.log('  Run the main setup first: npx jasper-recall setup');
    return;
  }
  
  // Step 1: Create bin directory and wrapper
  const binDir = path.join(wsPath, 'bin');
  const wrapperPath = path.join(binDir, 'recall');
  
  fs.mkdirSync(binDir, { recursive: true });
  
  const wrapperScript = `#!/bin/bash
# Sandboxed recall wrapper - forces --public-only for privacy
# This agent can ONLY access shared/public memory

exec ${RECALL_BIN} "$@" --public-only
`;

  fs.writeFileSync(wrapperPath, wrapperScript);
  fs.chmodSync(wrapperPath, '755');
  success(`Created recall wrapper: bin/recall`);

  // Step 2: Create shared folder symlink
  const sharedSource = path.join(MAIN_WORKSPACE, 'memory', 'shared');
  const sharedTarget = path.join(wsPath, 'shared');

  // Ensure source exists
  fs.mkdirSync(sharedSource, { recursive: true });

  // Remove existing symlink/dir if needed
  try {
    const stat = fs.lstatSync(sharedTarget);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(sharedTarget);
    }
  } catch (e) {
    // Doesn't exist, that's fine
  }

  if (!fs.existsSync(sharedTarget)) {
    fs.symlinkSync(sharedSource, sharedTarget);
    success(`Created symlink: shared/ → main workspace`);
  }

  // Step 3: Check if AGENTS.md exists and suggest update
  const agentsMd = path.join(wsPath, 'AGENTS.md');
  if (fs.existsSync(agentsMd)) {
    const content = fs.readFileSync(agentsMd, 'utf8');
    if (!content.includes('public-only') && !content.includes('--public-only')) {
      warn('Consider adding recall restrictions to AGENTS.md');
      console.log('');
      console.log('  Suggested addition:');
      console.log('  ```');
      console.log('  ## Memory Access');
      console.log('  Use `~/bin/recall "query"` for memory search.');
      console.log('  This wrapper enforces --public-only (you cannot see private memories).');
      console.log('  ```');
    }
  }

  console.log('');
  success(`${name} configured!`);
  console.log('');
  console.log('  The agent can now use:');
  console.log(`    ~/bin/recall "query"  — searches public memories only`);
  console.log(`    shared/               — symlink to shared memory folder`);
  console.log('');
}

function showAgentExample() {
  console.log(`  Example openclaw.json agent config:
  
  {
    "agents": {
      "list": [
        {
          "id": "email-agent",
          "workspace": "~/.openclaw/workspace-email",
          "model": { "primary": "anthropic/claude-sonnet-4-5" },
          "sandbox": {
            "mode": "all",
            "workspaceAccess": "rw"
          },
          "tools": {
            "profile": "minimal",
            "allow": ["read", "write", "exec", "web_fetch"]
          }
        }
      ]
    }
  }

  Common sandboxed agent use cases:
  
  📧 Email Agent
     - Checks inbox, drafts replies, summarizes threads
     - Sandbox: Only email API access, no filesystem
     - Memory: Sees [public] context about projects
  
  📱 Social Agent (Moltbook, Twitter, etc.)
     - Monitors feeds, engages with posts
     - Sandbox: Only that platform's API
     - Memory: Sees [public] product info for authentic engagement
  
  📅 Calendar Agent
     - Manages scheduling, sends reminders
     - Sandbox: Only calendar API
     - Memory: Sees [public] project timelines
  
  🔍 Research Agent
     - Web searches, summarizes articles
     - Sandbox: Read-only web access
     - Memory: Sees [public] research context
  
  After creating the workspace, run:
    npx jasper-recall sandboxed-setup
`);
}

function verify(wsPath, options = {}) {
  const { quiet = false } = options;
  const issues = [];

  if (!quiet) {
    console.log('');
    log('Verifying sandboxed agent setup...');
    console.log('');
  }

  // Check 1: Workspace exists
  if (!fs.existsSync(wsPath)) {
    issues.push(`Workspace missing: ${wsPath}`);
  } else if (!quiet) {
    success(`Workspace exists`);
  }

  // Check 2: Recall wrapper exists and is correct
  const wrapperPath = path.join(wsPath, 'bin', 'recall');
  if (!fs.existsSync(wrapperPath)) {
    issues.push(`Recall wrapper missing: bin/recall`);
  } else {
    const content = fs.readFileSync(wrapperPath, 'utf8');
    if (!content.includes('--public-only')) {
      issues.push('Recall wrapper missing --public-only flag!');
    } else if (!quiet) {
      success('Recall wrapper has --public-only restriction');
    }
  }

  // Check 3: Shared folder is a symlink
  const sharedPath = path.join(wsPath, 'shared');
  try {
    const stat = fs.lstatSync(sharedPath);
    if (!stat.isSymbolicLink()) {
      issues.push(`shared/ is not a symlink`);
    } else if (!quiet) {
      const target = fs.readlinkSync(sharedPath);
      success(`shared/ → ${target}`);
    }
  } catch (e) {
    issues.push(`shared/ folder missing`);
  }

  // Check 4: jasper-recall is installed
  if (!fs.existsSync(RECALL_BIN)) {
    issues.push(`jasper-recall not installed`);
  } else if (!quiet) {
    success(`jasper-recall installed`);
  }

  if (!quiet) {
    console.log('');
    if (issues.length === 0) {
      success('All checks passed!');
    } else {
      warn(`Found ${issues.length} issue(s):`);
      issues.forEach(issue => console.log(`  ❌ ${issue}`));
      console.log('');
      console.log('  Run setup to fix: npx jasper-recall sandboxed-setup');
    }
    console.log('');
  }

  return issues;
}

async function verifyInteractive() {
  const workspaces = findAgentWorkspaces();
  
  if (workspaces.length === 0) {
    console.log('');
    warn('No sandboxed agent workspaces found.');
    console.log('');
    return;
  }
  
  console.log('');
  log('Sandboxed Agent Verification');
  console.log('='.repeat(60));
  
  for (const ws of workspaces) {
    console.log('');
    console.log(`  📁 ${ws.name}`);
    const issues = verify(ws.path, { quiet: true });
    if (issues.length === 0) {
      console.log(`     ✅ Properly configured`);
    } else {
      console.log(`     ⚠️  ${issues.length} issue(s):`);
      issues.forEach(issue => console.log(`        - ${issue}`));
    }
  }
  
  console.log('');
}

function showHelp() {
  console.log(`
Sandboxed Agent Setup — jasper-recall Integration

USAGE:
  npx jasper-recall sandboxed-setup    Interactive setup for any sandboxed agent
  npx jasper-recall sandboxed-verify   Check all sandboxed agents
  npx jasper-recall moltbook-setup     (alias) Setup for moltbook specifically
  npx jasper-recall moltbook-verify    (alias) Verify moltbook specifically

WHAT IT DOES:
  Configures sandboxed agents to use jasper-recall with privacy restrictions.
  Agents can only access [public] tagged memories, not private ones.

COMPONENTS CREATED:
  bin/recall     Wrapper script that forces --public-only flag
  shared/        Symlink to main workspace's shared memory folder

USE CASES:
  📧 Email Agent      — inbox management, drafts, summaries
  📱 Social Agent     — moltbook, twitter engagement
  📅 Calendar Agent   — scheduling, reminders
  🔍 Research Agent   — web searches, article summaries

PRIVACY MODEL:
  1. Main agent tags memories as [public] or [private] in daily notes
  2. sync-shared extracts [public] content to memory/shared/
  3. Sandboxed agents can ONLY search the shared collection

EXAMPLE:
  # Main agent daily note
  ## 2026-02-11 [public] - Shipped jasper-recall v0.4.0
  New sandboxed agent setup feature.

  ## 2026-02-11 [private] - Personal context
  This stays private, sandboxed agents can't see it.
`);
}

// Main
const command = process.argv[2];

switch (command) {
  case 'setup':
  case 'install':
    interactiveSetup().catch(err => {
      error(err.message);
      process.exit(1);
    });
    break;
  case 'verify':
  case 'check':
    verifyInteractive().catch(err => {
      error(err.message);
      process.exit(1);
    });
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    showHelp();
    break;
  default:
    error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
