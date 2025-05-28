//
// Simple script to run preflight checks without importing from the main script
// Usage: node tests/run-preflight-checks.js
//
// This script directly executes the main script with a flag to run only the preflight checks

const { spawn } = require('child_process');
const path = require('path');

// Display test header
console.log('----------------------------------------------');
console.log('  NERDS Project Sync Preflight Tests');
console.log('----------------------------------------------');
console.log(`Testing environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Time: ${new Date().toISOString()}`);
console.log(`GH_TOKEN available: ${process.env.GH_TOKEN ? 'Yes' : 'No'}`);
console.log(`GITHUB_AUTHOR: ${process.env.GITHUB_AUTHOR || 'Not set'}`);

// Path to the main script
const mainScriptPath = path.resolve(__dirname, '..', 'project-sync.js');
console.log(`Main script path: ${mainScriptPath}`);

// Run the main script with the preflight flag
console.log('\nRunning preflight checks...');

// Spawn a child process for the main script with PREFLIGHT_ONLY=true
const child = spawn('node', [mainScriptPath], {
  env: {
    ...process.env,
    PREFLIGHT_ONLY: 'true',  // This flag will tell the main script to run only preflight checks
    STRICT_MODE: 'true'      // This will ensure that preflight failures cause the process to exit
  },
  stdio: 'inherit'  // This will pipe the child's stdout and stderr to the parent process
});

// Handle the child process exit
child.on('close', (code) => {
  console.log(`\nPreflight checks process exited with code ${code}`);
  process.exit(code);
});

// Handle any errors in spawning the process
child.on('error', (error) => {
  console.error(`Failed to start preflight checks process: ${error.message}`);
  process.exit(1);
});
