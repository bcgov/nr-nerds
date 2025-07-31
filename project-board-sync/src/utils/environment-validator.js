/**
 * @fileoverview Environment variable validation utility
 * Centralized validation for all required environment variables
 */

const { log } = require('./log');

class EnvironmentValidator {
  /**
   * Validate all required environment variables
   * @throws {Error} If any required variables are missing
   */
  static validateRequired() {
    const required = {
      GITHUB_TOKEN: 'GitHub personal access token with repo and project permissions',
      GITHUB_AUTHOR: 'GitHub username to monitor (e.g., DerekRoberts)'
    };
    
    const missing = [];
    for (const [key, description] of Object.entries(required)) {
      if (!process.env[key]) {
        missing.push(`${key} (${description})`);
      }
    }
    
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables:\n` +
        `${missing.map(m => `  - ${m}`).join('\n')}\n\n` +
        `Please set them with:\n` +
        `export GITHUB_TOKEN=your_personal_access_token\n` +
        `export GITHUB_AUTHOR=your_github_username\n\n` +
        `For GitHub token setup, visit: https://github.com/settings/tokens`
      );
    }
  }

  /**
   * Validate GitHub token permissions by making a test API call
   * @returns {Promise<string>} The GitHub username associated with the token
   * @throws {Error} If token is invalid or lacks required permissions
   */
  static async validateGitHubToken() {
    try {
      const { graphql } = require('../github/api');
      
      const result = await graphql(`
        query {
          viewer {
            login
            repositories(first: 1) {
              nodes {
                name
              }
            }
          }
        }
      `);
      
      if (!result.viewer?.login) {
        throw new Error('Token validation failed: Could not retrieve user information');
      }
      
      log.info(`✓ GitHub token validated for user: ${result.viewer.login}`);
      return result.viewer.login;
      
    } catch (error) {
      if (error.message.includes('Bad credentials')) {
        throw new Error(
          `GitHub token validation failed: Invalid or expired token\n` +
          `Please check your GITHUB_TOKEN is valid and not expired.\n` +
          `Generate a new token at: https://github.com/settings/tokens`
        );
      } else if (error.message.includes('rate limit')) {
        throw new Error(
          `GitHub rate limit exceeded during token validation.\n` +
          `Please wait a few minutes and try again.`
        );
      } else {
        throw new Error(
          `GitHub token validation failed: ${error.message}\n` +
          `Please ensure your token has the following permissions:\n` +
          `  - repo (for repository access)\n` +
          `  - project (for project board access)\n` +
          `  - read:org (for organization access)`
        );
      }
    }
  }

  /**
   * Validate optional environment variables with defaults
   * @returns {Object} Validated environment configuration
   */
  static validateOptional() {
    const config = {
      projectId: process.env.PROJECT_ID || 'PVT_kwDOAA37OM4AFuzg',
      verbose: process.env.VERBOSE === 'true',
      strictMode: process.env.STRICT_MODE === 'true'
    };

    if (!process.env.PROJECT_ID) {
      log.warning('No PROJECT_ID provided, using default from rules.yml: PVT_kwDOAA37OM4AFuzg');
    }

    return config;
  }

  /**
   * Run complete environment validation
   * @returns {Promise<Object>} Validated environment configuration
   * @throws {Error} If validation fails
   */
  static async validateAll() {
    log.info('Validating environment variables...');
    
    // Step 1: Check for required variables
    this.validateRequired();
    log.info('✓ Required environment variables present');
    
    // Step 2: Validate GitHub token
    const githubUser = await this.validateGitHubToken();
    log.info('✓ GitHub token validated');
    
    // Step 3: Validate optional variables
    const config = this.validateOptional();
    log.info('✓ Optional environment variables validated');
    
    // Verify GITHUB_AUTHOR matches token user (optional check)
    const expectedUser = process.env.GITHUB_AUTHOR;
    if (githubUser !== expectedUser) {
      log.warning(
        `GitHub token is for user "${githubUser}" but GITHUB_AUTHOR is "${expectedUser}". ` +
        `This might be intentional if you're monitoring another user's activity.`
      );
    }
    
    return {
      githubUser,
      projectId: config.projectId,
      verbose: config.verbose,
      strictMode: config.strictMode
    };
  }
}

module.exports = { EnvironmentValidator }; 
