#!/usr/bin/env node
/**
 * index-digests — Index memory files into ChromaDB
 * Wrapper for the Python script
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const VENV_PATH = path.join(os.homedir(), '.openclaw', 'rag-env');
const PYTHON = path.join(VENV_PATH, 'bin', 'python');

// Find the Python script - check multiple locations
const SCRIPT_LOCATIONS = [
  path.join(__dirname, '..', 'scripts', 'index-digests.py'),
  path.join(os.homedir(), '.local', 'share', 'jasper-recall', 'scripts', 'index-digests.py'),
];

let scriptPath = null;
for (const loc of SCRIPT_LOCATIONS) {
  if (fs.existsSync(loc)) {
    scriptPath = loc;
    break;
  }
}

if (!scriptPath) {
  console.error('❌ index-digests.py not found. Run: npx jasper-recall setup');
  process.exit(1);
}

if (!fs.existsSync(PYTHON)) {
  console.error('❌ Python venv not found. Run: npx jasper-recall setup');
  process.exit(1);
}

// Run the Python script
const child = spawn(PYTHON, [scriptPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env }
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
