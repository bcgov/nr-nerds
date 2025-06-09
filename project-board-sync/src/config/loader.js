/**
 * @fileoverview Configuration loader for project board sync
 * @see /src/index.js for project conventions and architecture
 * 
 * Module Conventions:
 * - YAML-based configuration in rules.yml
 * - Schema validation enforced for all configs
 * - Config validation errors provide detailed feedback
 * - Environment variable fallbacks supported
 */

const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const schema = require('./schema');

class ConfigLoader {
  constructor() {
    this.ajv = new Ajv();
    this.validate = this.ajv.compile(schema);
  }

  load(configPath) {
    try {
      const fileContents = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(fileContents);
      
      if (!this.validate(config)) {
        const errors = this.validate.errors;
        throw new Error(`Invalid configuration: ${JSON.stringify(errors, null, 2)}`);
      }

      return config;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Configuration file not found: ${configPath}`);
      }
      throw error;
    }
  }
}

module.exports = ConfigLoader;
