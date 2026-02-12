#!/usr/bin/env node
/**
 * Jasper Recall CLI
 * Local RAG system for AI agent memory
 * 
 * Usage:
 *   npx jasper-recall setup     # Install dependencies and create scripts
 *   npx jasper-recall recall    # Run a query (alias)
 *   npx jasper-recall index     # Index files (alias)
 *   npx jasper-recall digest    # Digest sessions (alias)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Read version from package.json
const packageJson = require('../package.json');
const VERSION = packageJson.version;

// Check for updates in background (non-blocking)
const { checkInBackground } = require('./update-check');
checkInBackground();
const VENV_PATH = path.join(os.homedir(), '.openclaw', 'rag-env');
const CHROMA_PATH = path.join(os.homedir(), '.openclaw', 'chroma-db');
const BIN_PATH = path.join(os.homedir(), '.local', 'bin');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const EXTENSIONS_DIR = path.join(__dirname, '..', 'extensions');
const OPENCLAW_CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const OPENCLAW_SKILLS = path.join(os.homedir(), '.openclaw', 'workspace', 'skills');
const BRAIN_PATH = path.join(os.homedir(), '.openclaw', 'brain');
const BRAIN_CONFIG = path.join(os.homedir(), '.jasper-recall', 'brain.json');
const DEFAULT_BRAIN_PORT = 8787;
const DEFAULT_BRAIN_HOST = '127.0.0.1';

function log(msg) {
  console.log(`🦊 ${msg}`);
}

function error(msg) {
  console.error(`❌ ${msg}`);
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
  } catch (e) {
    if (!opts.ignoreError) {
      error(`Command failed: ${cmd}`);
      process.exit(1);
    }
    return null;
  }
}

function setupOpenClawIntegration() {
  log('Setting up OpenClaw integration...');
  
  // Check if OpenClaw is installed
  const openclawDir = path.join(os.homedir(), '.openclaw');
  if (!fs.existsSync(openclawDir)) {
    console.log('  ⚠ OpenClaw not detected (~/.openclaw not found)');
    console.log('  → Skipping OpenClaw integration');
    return false;
  }
  
  // Install plugin files to ~/.openclaw/extensions/jasper-recall/
  const OPENCLAW_EXTENSIONS = path.join(openclawDir, 'extensions', 'jasper-recall');
  const pluginSrcDir = path.join(EXTENSIONS_DIR, 'jasper-recall');
  
  fs.mkdirSync(OPENCLAW_EXTENSIONS, { recursive: true });
  
  const pluginFiles = ['index.ts', 'openclaw.plugin.json', 'package.json', 'SKILL.md'];
  for (const file of pluginFiles) {
    const src = path.join(pluginSrcDir, file);
    const dest = path.join(OPENCLAW_EXTENSIONS, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }
  console.log(`  ✓ Installed plugin files: ${OPENCLAW_EXTENSIONS}`);
  
  // Install SKILL.md to skills directory (for agent discovery)
  const skillSrc = path.join(pluginSrcDir, 'SKILL.md');
  const skillDest = path.join(OPENCLAW_SKILLS, 'jasper-recall', 'SKILL.md');
  
  if (fs.existsSync(skillSrc)) {
    fs.mkdirSync(path.dirname(skillDest), { recursive: true });
    fs.copyFileSync(skillSrc, skillDest);
    console.log(`  ✓ Installed SKILL.md: ${skillDest}`);
  }
  
  // Update openclaw.json with plugin config AND path
  if (fs.existsSync(OPENCLAW_CONFIG)) {
    try {
      const configRaw = fs.readFileSync(OPENCLAW_CONFIG, 'utf8');
      const config = JSON.parse(configRaw);
      
      // Initialize plugins structure if needed
      if (!config.plugins) config.plugins = {};
      if (!config.plugins.entries) config.plugins.entries = {};
      if (!config.plugins.load) config.plugins.load = {};
      if (!config.plugins.load.paths) config.plugins.load.paths = [];
      
      // Add plugin path if not already present
      if (!config.plugins.load.paths.includes(OPENCLAW_EXTENSIONS)) {
        config.plugins.load.paths.push(OPENCLAW_EXTENSIONS);
        console.log(`  ✓ Added plugin path to plugins.load.paths`);
      }
      
      // Check if already configured
      if (config.plugins.entries['jasper-recall']) {
        console.log('  ✓ Plugin already configured in openclaw.json');
      } else {
        // Add plugin config
        config.plugins.entries['jasper-recall'] = {
          enabled: true,
          config: {
            autoRecall: true,
            minScore: 0.3,
            defaultLimit: 5
          }
        };
        console.log('  ✓ Added jasper-recall plugin config');
      }
      
      // Write back with nice formatting
      fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2) + '\n');
      console.log('  → Restart OpenClaw gateway to activate: openclaw gateway restart');
      
    } catch (e) {
      console.log(`  ⚠ Could not update openclaw.json: ${e.message}`);
      console.log('  → Manually add plugin config (see docs)');
    }
  } else {
    console.log('  ⚠ openclaw.json not found');
    console.log('  → Create config or manually add jasper-recall plugin');
  }
  
  return true;
}

// ============================================================================
// Brain (Quartz) Setup - Optional web UI for memory browsing
// ============================================================================

function getBrainConfig() {
  const configDir = path.dirname(BRAIN_CONFIG);
  fs.mkdirSync(configDir, { recursive: true });
  
  if (fs.existsSync(BRAIN_CONFIG)) {
    try {
      return JSON.parse(fs.readFileSync(BRAIN_CONFIG, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveBrainConfig(config) {
  const configDir = path.dirname(BRAIN_CONFIG);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(BRAIN_CONFIG, JSON.stringify(config, null, 2));
}

function setupBrain(options = {}) {
  const port = options.port || DEFAULT_BRAIN_PORT;
  const host = options.host || DEFAULT_BRAIN_HOST;
  
  log('Setting up Jasper Brain (Quartz knowledge base)...');
  console.log('');
  
  // Check for Node.js and npm
  try {
    execSync('npx --version', { stdio: 'pipe' });
  } catch {
    error('npx not found. Node.js is required for Quartz.');
    return false;
  }
  
  // Check if Quartz is already installed
  if (fs.existsSync(BRAIN_PATH) && fs.existsSync(path.join(BRAIN_PATH, 'quartz.config.ts'))) {
    console.log(`  ✓ Quartz already installed at ${BRAIN_PATH}`);
  } else {
    log('Cloning Quartz...');
    fs.mkdirSync(path.dirname(BRAIN_PATH), { recursive: true });
    
    try {
      execSync(`git clone https://github.com/jackyzha0/quartz.git "${BRAIN_PATH}"`, {
        stdio: 'inherit',
        timeout: 120000
      });
      console.log(`  ✓ Cloned Quartz to ${BRAIN_PATH}`);
    } catch (err) {
      error(`Failed to clone Quartz: ${err.message}`);
      return false;
    }
    
    // Install dependencies
    log('Installing Quartz dependencies...');
    try {
      execSync('npm install', { cwd: BRAIN_PATH, stdio: 'inherit', timeout: 180000 });
      console.log('  ✓ Dependencies installed');
    } catch (err) {
      error(`Failed to install dependencies: ${err.message}`);
      return false;
    }
  }
  
  // Link memory folder to Quartz content
  const contentPath = path.join(BRAIN_PATH, 'content');
  const memoryPath = path.join(os.homedir(), '.openclaw', 'workspace', 'memory');
  
  if (fs.existsSync(memoryPath)) {
    // Remove default content and symlink memory
    if (fs.existsSync(contentPath)) {
      const stats = fs.lstatSync(contentPath);
      if (stats.isSymbolicLink()) {
        console.log(`  ✓ Memory already linked: ${contentPath} -> ${memoryPath}`);
      } else {
        // Backup and replace
        const backupPath = contentPath + '.backup';
        if (!fs.existsSync(backupPath)) {
          fs.renameSync(contentPath, backupPath);
        } else {
          fs.rmSync(contentPath, { recursive: true });
        }
        fs.symlinkSync(memoryPath, contentPath);
        console.log(`  ✓ Linked memory to Quartz: ${memoryPath}`);
      }
    } else {
      fs.symlinkSync(memoryPath, contentPath);
      console.log(`  ✓ Linked memory to Quartz: ${memoryPath}`);
    }
  } else {
    console.log(`  ⚠ Memory folder not found: ${memoryPath}`);
    console.log('    Create it with: mkdir -p ~/.openclaw/workspace/memory');
  }
  
  // Save config
  const config = getBrainConfig();
  config.path = BRAIN_PATH;
  config.port = port;
  config.host = host;
  config.contentPath = memoryPath;
  saveBrainConfig(config);
  
  // Create rebuild-brain script
  const rebuildScript = path.join(BIN_PATH, 'rebuild-brain');
  const rebuildContent = `#!/bin/bash
# Rebuild Jasper Brain (Quartz static site)
cd "${BRAIN_PATH}" && npx quartz build
`;
  fs.writeFileSync(rebuildScript, rebuildContent);
  fs.chmodSync(rebuildScript, 0o755);
  console.log(`  ✓ Created: ${rebuildScript}`);
  
  // Create serve-brain script
  const serveScript = path.join(BIN_PATH, 'serve-brain');
  const serveContent = `#!/bin/bash
# Start Jasper Brain web server
cd "${BRAIN_PATH}" && npx quartz build --serve --port ${port} --host ${host}
`;
  fs.writeFileSync(serveScript, serveContent);
  fs.chmodSync(serveScript, 0o755);
  console.log(`  ✓ Created: ${serveScript}`);
  
  console.log('');
  log('Brain setup complete!');
  console.log('');
  console.log('Commands:');
  console.log('  rebuild-brain    # Build static site from memory files');
  console.log('  serve-brain      # Start web server');
  console.log('');
  console.log(`Server will run at: http://${host}:${port}`);
  console.log('');
  
  return true;
}

function brainStatus() {
  const config = getBrainConfig();
  
  console.log('🧠 Jasper Brain Status');
  console.log('=' .repeat(40));
  
  if (!config.path || !fs.existsSync(config.path)) {
    console.log('Status: Not installed');
    console.log('');
    console.log('Run: npx jasper-recall brain setup');
    return;
  }
  
  console.log(`Path: ${config.path}`);
  console.log(`Port: ${config.port || DEFAULT_BRAIN_PORT}`);
  console.log(`Host: ${config.host || DEFAULT_BRAIN_HOST}`);
  console.log(`Content: ${config.contentPath || 'not linked'}`);
  console.log('');
  
  // Check if server is running
  try {
    const host = config.host || DEFAULT_BRAIN_HOST;
    const port = config.port || DEFAULT_BRAIN_PORT;
    execSync(`curl -s -o /dev/null -w "%{http_code}" http://${host}:${port}/ | grep -q 200`, { stdio: 'pipe' });
    console.log(`Server: ✅ Running at http://${host}:${port}`);
  } catch {
    console.log('Server: ❌ Not running');
    console.log('  Start with: serve-brain');
  }
}

function brainCommand(args) {
  const subcommand = args[0];
  
  switch (subcommand) {
    case 'setup':
    case 'install': {
      const portIdx = args.indexOf('--port');
      const hostIdx = args.indexOf('--host');
      const options = {
        port: portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : DEFAULT_BRAIN_PORT,
        host: hostIdx !== -1 ? args[hostIdx + 1] : DEFAULT_BRAIN_HOST
      };
      setupBrain(options);
      break;
    }
    case 'status':
      brainStatus();
      break;
    case 'serve':
    case 'start': {
      const config = getBrainConfig();
      if (!config.path) {
        error('Brain not installed. Run: npx jasper-recall brain setup');
        process.exit(1);
      }
      const port = config.port || DEFAULT_BRAIN_PORT;
      const host = config.host || DEFAULT_BRAIN_HOST;
      console.log(`Starting brain server at http://${host}:${port}...`);
      spawn('npx', ['quartz', 'build', '--serve', '--port', String(port), '--host', host], {
        cwd: config.path,
        stdio: 'inherit'
      });
      break;
    }
    case 'build':
    case 'rebuild': {
      const config = getBrainConfig();
      if (!config.path) {
        error('Brain not installed. Run: npx jasper-recall brain setup');
        process.exit(1);
      }
      console.log('Building brain...');
      execSync('npx quartz build', { cwd: config.path, stdio: 'inherit' });
      break;
    }
    case 'port': {
      const newPort = parseInt(args[1], 10);
      if (isNaN(newPort)) {
        const config = getBrainConfig();
        console.log(`Current port: ${config.port || DEFAULT_BRAIN_PORT}`);
      } else {
        const config = getBrainConfig();
        config.port = newPort;
        saveBrainConfig(config);
        console.log(`Port set to: ${newPort}`);
        console.log('Restart serve-brain for changes to take effect.');
      }
      break;
    }
    case 'host': {
      const newHost = args[1];
      if (!newHost) {
        const config = getBrainConfig();
        console.log(`Current host: ${config.host || DEFAULT_BRAIN_HOST}`);
      } else {
        const config = getBrainConfig();
        config.host = newHost;
        saveBrainConfig(config);
        console.log(`Host set to: ${newHost}`);
        console.log('Restart serve-brain for changes to take effect.');
      }
      break;
    }
    default:
      console.log(`
🧠 Jasper Brain - Web UI for your memory

USAGE:
  npx jasper-recall brain <command>

COMMANDS:
  setup [--port N] [--host H]   Install Quartz and link memory
  status                        Show brain status
  serve                         Start the web server
  build                         Rebuild static site
  port [N]                      Show or set port (default: ${DEFAULT_BRAIN_PORT})
  host [H]                      Show or set host (default: ${DEFAULT_BRAIN_HOST})

EXAMPLES:
  npx jasper-recall brain setup
  npx jasper-recall brain setup --port 8080 --host 0.0.0.0
  npx jasper-recall brain serve
`);
  }
}

function setup() {
  log('Jasper Recall — Setup');
  console.log('=' .repeat(40));
  
  // Check Python
  log('Checking Python...');
  let python = 'python3';
  try {
    const version = execSync(`${python} --version`, { encoding: 'utf8' });
    console.log(`  ✓ ${version.trim()}`);
  } catch {
    error('Python 3 is required. Install it first.');
    process.exit(1);
  }
  
  // Create venv
  log('Creating Python virtual environment...');
  fs.mkdirSync(path.dirname(VENV_PATH), { recursive: true });
  if (!fs.existsSync(VENV_PATH)) {
    run(`${python} -m venv ${VENV_PATH}`);
    console.log(`  ✓ Created: ${VENV_PATH}`);
  } else {
    console.log(`  ✓ Already exists: ${VENV_PATH}`);
  }
  
  // Install Python dependencies
  log('Installing Python dependencies (this may take a minute)...');
  const pip = path.join(VENV_PATH, 'bin', 'pip');
  run(`${pip} install --quiet chromadb sentence-transformers`);
  console.log('  ✓ Installed: chromadb, sentence-transformers');
  
  // Pre-download embedding model (~90MB) to avoid timeout on first recall
  log('Downloading embedding model (first time only, ~90MB)...');
  const pythonBin = path.join(VENV_PATH, 'bin', 'python3');
  try {
    // Suppress LibreSSL/OpenSSL warning on macOS
    execSync(`${pythonBin} -W ignore::DeprecationWarning -c "import warnings; warnings.filterwarnings('ignore'); from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"`, {
      encoding: 'utf8',
      timeout: 300000, // 5 min timeout for download
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONWARNINGS: 'ignore' }
    });
    console.log('  ✓ Model cached: sentence-transformers/all-MiniLM-L6-v2');
  } catch (err) {
    console.log('  ⚠ Model download failed (will retry on first recall)');
    console.log(`    ${err.message}`);
  }
  
  // Create bin directory
  fs.mkdirSync(BIN_PATH, { recursive: true });
  
  // Copy scripts
  log('Installing CLI scripts...');
  
  const scripts = [
    { src: 'recall.py', dest: 'recall', shebang: `#!${path.join(VENV_PATH, 'bin', 'python3')}` },
    { src: 'index-digests.py', dest: 'index-digests', shebang: `#!${path.join(VENV_PATH, 'bin', 'python3')}` },
    { src: 'digest-sessions.sh', dest: 'digest-sessions', shebang: '#!/bin/bash' },
    { src: 'summarize-old.py', dest: 'summarize-old', shebang: `#!${path.join(VENV_PATH, 'bin', 'python3')}` }
  ];
  
  for (const script of scripts) {
    const srcPath = path.join(SCRIPTS_DIR, script.src);
    const destPath = path.join(BIN_PATH, script.dest);
    
    let content = fs.readFileSync(srcPath, 'utf8');
    
    // Replace generic shebang with specific one for Python scripts
    if (script.src.endsWith('.py')) {
      content = content.replace(/^#!.*python3?\n/, script.shebang + '\n');
    }
    
    fs.writeFileSync(destPath, content);
    fs.chmodSync(destPath, 0o755);
    console.log(`  ✓ Installed: ${destPath}`);
  }
  
  // Create chroma directory
  fs.mkdirSync(CHROMA_PATH, { recursive: true });
  
  // Verify PATH
  const pathEnv = process.env.PATH || '';
  if (!pathEnv.includes(BIN_PATH)) {
    console.log('');
    log('Add to your PATH (add to ~/.bashrc or ~/.zshrc):');
    console.log(`  export PATH="$HOME/.local/bin:$PATH"`);
  }
  
  console.log('');
  
  // OpenClaw integration
  setupOpenClawIntegration();
  
  console.log('');
  console.log('=' .repeat(40));
  log('Setup complete!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. index-digests     # Index your memory files');
  console.log('  2. recall "query"    # Search your memory');
  console.log('  3. digest-sessions   # Process session logs');
  console.log('');
  console.log('🔄 To set up automatic indexing cron jobs:');
  console.log('   Run /jasper-recall setup in your OpenClaw chat');
  console.log('   Then ask your agent to create the cron jobs for you');
  console.log('');
  
  // Check for sandboxed agents
  const sandboxedWorkspaces = findSandboxedWorkspaces();
  if (sandboxedWorkspaces.length > 0) {
    console.log('📦 Sandboxed agents detected:');
    sandboxedWorkspaces.forEach(ws => console.log(`   - ${ws}`));
    console.log('');
    console.log('   Configure them with: npx jasper-recall sandboxed-setup');
    console.log('   (gives them --public-only access to shared memories)');
    console.log('');
  }
}

function findSandboxedWorkspaces() {
  const openclawDir = path.join(os.homedir(), '.openclaw');
  const workspaces = [];
  
  try {
    const entries = fs.readdirSync(openclawDir);
    for (const entry of entries) {
      if (entry.startsWith('workspace-') && entry !== 'workspace') {
        workspaces.push(entry.replace('workspace-', ''));
      }
    }
  } catch (e) {
    // Directory doesn't exist
  }
  
  return workspaces;
}

function showHelp() {
  console.log(`
Jasper Recall v${VERSION}
Local RAG system for AI agent memory

USAGE:
  npx jasper-recall <command>

COMMANDS:
  setup           Install dependencies and CLI scripts
  doctor          Run system health check
                  Flags: --fix (auto-repair issues), --dry-run (verbose output)
  recall          Search your memory (alias for the recall command)
  index           Index memory files (alias for index-digests)
  digest          Process session logs (alias for digest-sessions)
  summarize       Compress old entries to save tokens (alias for summarize-old)
  serve           Start HTTP API server (for sandboxed agents)
  brain           Manage Quartz web UI for memory browsing
                  Subcommands: setup, status, serve, build, port, host
  config          Show or set configuration
  update          Check for updates
  sandboxed-setup   Configure sandboxed agents (email, social, calendar, etc.)
  sandboxed-verify  Verify sandboxed agent configurations
  help            Show this help message

CONFIGURATION:
  Config file: ~/.jasper-recall/config.json
  
  Environment variables (override config file):
    RECALL_WORKSPACE   Memory workspace path
    RECALL_CHROMA_DB   ChromaDB storage path
    RECALL_VENV        Python venv path
    RECALL_PORT        Server port (default: 3458)
    RECALL_HOST        Server host (default: 127.0.0.1)

EXAMPLES:
  npx jasper-recall setup
  recall "what did we discuss yesterday"
  index-digests
  digest-sessions --dry-run
  npx jasper-recall serve --port 3458
`);
}

// Main
const command = process.argv[2];

switch (command) {
  case 'setup':
    setup();
    break;
  case 'recall':
    // Pass through to recall script
    const recallScript = path.join(BIN_PATH, 'recall');
    if (fs.existsSync(recallScript)) {
      const args = process.argv.slice(3);
      spawn(recallScript, args, { stdio: 'inherit' });
    } else {
      error('Run "npx jasper-recall setup" first');
    }
    break;
  case 'index':
    const indexScript = path.join(BIN_PATH, 'index-digests');
    if (fs.existsSync(indexScript)) {
      spawn(indexScript, [], { stdio: 'inherit' });
    } else {
      error('Run "npx jasper-recall setup" first');
    }
    break;
  case 'digest':
    const digestScript = path.join(BIN_PATH, 'digest-sessions');
    if (fs.existsSync(digestScript)) {
      const args = process.argv.slice(3);
      spawn(digestScript, args, { stdio: 'inherit' });
    } else {
      error('Run "npx jasper-recall setup" first');
    }
    break;
  case 'summarize':
    const summarizeScript = path.join(BIN_PATH, 'summarize-old');
    if (fs.existsSync(summarizeScript)) {
      const args = process.argv.slice(3);
      spawn(summarizeScript, args, { stdio: 'inherit' });
    } else {
      error('Run "npx jasper-recall setup" first');
    }
    break;
  case 'serve':
  case 'server':
    // Start the HTTP server for sandboxed agents
    const { runCLI } = require('./server');
    runCLI(process.argv.slice(3));
    break;
  case 'update':
  case 'check-update':
    // Check for updates explicitly
    const { checkForUpdates } = require('./update-check');
    checkForUpdates().then(result => {
      if (result && !result.updateAvailable) {
        console.log(`✓ You're on the latest version (${result.current})`);
      } else if (!result) {
        console.log('Could not check for updates');
      }
    });
    break;
  case 'doctor':
    // Run system health check
    const { runDoctor } = require('./doctor');
    const args = process.argv.slice(3);
    const options = {
      fix: args.includes('--fix'),
      dryRun: args.includes('--dry-run')
    };
    process.exit(runDoctor(options));
    break;
  case 'sandboxed-setup':
  case 'sandbox-setup':
  case 'moltbook-setup':
  case 'moltbook':
    // Interactive setup for sandboxed agents
    process.argv = [process.argv[0], process.argv[1], 'setup'];
    require('../extensions/moltbook-setup/setup.js');
    break;
  case 'sandboxed-verify':
  case 'sandbox-verify':
  case 'moltbook-verify':
    // Verify sandboxed agent setups
    process.argv = [process.argv[0], process.argv[1], 'verify'];
    require('../extensions/moltbook-setup/setup.js');
    break;
  case 'config':
    // Configuration management
    const config = require('./config');
    const configArg = process.argv[3];
    if (configArg === 'init') {
      config.init();
    } else if (configArg === 'path') {
      console.log(config.CONFIG_FILE);
    } else {
      config.show();
    }
    break;
  case 'brain':
    // Quartz knowledge base management
    brainCommand(process.argv.slice(3));
    break;
  case '--version':
  case '-v':
    console.log(VERSION);
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
