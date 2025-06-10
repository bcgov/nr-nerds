#!/usr/bin/env node

/**
 * Configuration validation script
 * Run this before commits to validate environment and configuration
 */

const { validateEnvironment } = require('../src/index');
const { ConfigLoader } = require('../src/config/loader');
const path = require('path');

async function validateConfiguration() {
  try {
    // Check environment variables
    validateEnvironment();

    // Load and validate configuration
    const loader = new ConfigLoader();
    const config = loader.load(path.join(__dirname, '../config/rules.yml'));

    // Verify project ID consistency
    const configProjectId = config.project?.id;
    const envProjectId = process.env.PROJECT_ID;
    const defaultProjectId = 'PVT_kwDOAA37OM4AFuzg';

    if (envProjectId && configProjectId && envProjectId !== configProjectId) {
      throw new Error(`Project ID mismatch: environment has "${envProjectId}" but config has "${configProjectId}"`);
    }

    if (!envProjectId && configProjectId !== defaultProjectId) {
      throw new Error(`Default project ID mismatch: config has "${configProjectId}" but expected "${defaultProjectId}"`);
    }

    console.log('✓ Configuration validation passed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Configuration validation failed:', error.message);
    process.exit(1);
  }
}

validateConfiguration();
