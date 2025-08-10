/**
 * @fileoverview Environment variable validation utility
 * Centralized validation for all required environment variables
 */

const { log } = require('./log');
const { loadBoardRules } = require('../config/board-rules');

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
   * Resolve project ID from GitHub project URL
   * @param {string} url - GitHub project URL
   * @returns {Promise<string>} Project ID
   * @throws {Error} If URL is invalid or project not found
   */
  static async resolveProjectFromUrl(url) {
    try {
      // Extract organization and project number from URL
      const urlMatch = url.match(/^https:\/\/github\.com\/orgs\/([^\/]+)\/projects\/(\d+)$/);
      if (!urlMatch) {
        throw new Error(`Invalid project URL format. Expected: https://github.com/orgs/org/projects/number`);
      }
      
      const [, org, projectNumber] = urlMatch;
      return await this.resolveProjectFromNumber(org, parseInt(projectNumber));
      
    } catch (error) {
      if (error.message.includes('Project not found')) {
        throw error;
      } else if (error.message.includes('Invalid project URL')) {
        throw error;
      } else {
        throw new Error(
          `Failed to resolve project from URL: ${error.message}\n` +
          `Please check the URL is correct and you have access to the project.`
        );
      }
    }
  }

  /**
   * Resolve project ID from organization and project number
   * @param {string} org - Organization name
   * @param {number} projectNumber - Project number
   * @returns {Promise<string>} Project ID
   * @throws {Error} If project not found
   */
  static async resolveProjectFromNumber(org, projectNumber) {
    try {
      const { graphql } = require('../github/api');
      
      log.info(`Resolving project ID: ${org}/projects/${projectNumber}`);
      
      const result = await graphql(`
        query($org: String!, $number: Int!) {
          organization(login: $org) {
            projectV2(number: $number) {
              id
              title
            }
          }
        }
      `, { org, number: projectNumber });
      
      if (!result.organization?.projectV2?.id) {
        throw new Error(`Project not found: ${org}/projects/${projectNumber}. Check the project number and ensure you have access to this project.`);
      }
      
      const projectId = result.organization.projectV2.id;
      const projectTitle = result.organization.projectV2.title;
      
      log.info(`✓ Resolved project: "${projectTitle}" (${projectId})`);
      return projectId;
      
    } catch (error) {
      if (error.message.includes('Project not found')) {
        throw error;
      } else {
        throw new Error(
          `Failed to resolve project from number: ${error.message}\n` +
          `Please check the project number is correct and you have access to the project.`
        );
      }
    }
  }

  /**
   * Validate optional environment variables with defaults
   * @returns {Promise<Object>} Validated environment configuration
   */
  static async validateOptional() {
    let rules;
    try {
      rules = loadBoardRules();
    } catch (err) {
      throw new Error(
        'Failed to load board rules from config/rules.yml: ' + err.message + '\n' +
        'PROJECT_ID not provided and no project.id found in config/rules.yml. ' +
        'Set PROJECT_ID or add project.id to config.'
      );
    }
    
    // Check for project configuration in order of preference
    let projectId = process.env.PROJECT_ID;
    let projectSource = 'PROJECT_ID environment variable';
    
    if (!projectId && process.env.PROJECT_URL) {
      projectId = await this.resolveProjectFromUrl(process.env.PROJECT_URL);
      projectSource = 'PROJECT_URL environment variable';
    }
    
    if (!projectId) {
      // Check config for project configuration
      if (rules?.project?.url) {
        projectId = await this.resolveProjectFromUrl(rules.project.url);
        projectSource = 'config/rules.yml project.url';
      } else if (rules?.project?.number && rules?.project?.organization) {
        projectId = await this.resolveProjectFromNumber(rules.project.organization, rules.project.number);
        projectSource = 'config/rules.yml project.number';
      } else if (rules?.project?.id) {
        projectId = rules.project.id;
        projectSource = 'config/rules.yml project.id';
      }
    }

    if (!projectId) {
      throw new Error(
        'No project specified. Please provide one of:\n' +
        '  - PROJECT_URL environment variable (e.g., https://github.com/orgs/bcgov/projects/1)\n' +
        '  - PROJECT_ID environment variable (e.g., PVT_kwDOAA37OM4AFuzg)\n' +
        '  - project.url in config/rules.yml (e.g., https://github.com/orgs/bcgov/projects/1)\n' +
        '  - project.number in config/rules.yml (e.g., 1 for https://github.com/orgs/bcgov/projects/1)\n' +
        '  - project.id in config/rules.yml (e.g., PVT_kwDOAA37OM4AFuzg)\n\n' +
        'For GitHub project URLs or numbers, the system will automatically resolve the project ID.'
      );
    }

    if (projectSource !== 'PROJECT_ID environment variable') {
      log.info(`Project ID resolved from ${projectSource}: ${projectId}`);
    }

    return {
      projectId,
      verbose: process.env.VERBOSE === 'true',
      strictMode: process.env.STRICT_MODE === 'true'
    };
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
    const config = await this.validateOptional();
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
