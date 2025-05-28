/**
 * This script is a utility to fetch issues and PRs assigned to a given user across all GitHub repositories
 * It demonstrates how to implement the feature described in FUTURE-IDEAS.md item #13
 */

const { Octokit } = require("@octokit/rest");

// Use environment variables for auth
const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";

if (!GH_TOKEN) {
  console.error("Error: GH_TOKEN environment variable is required");
  process.exit(1);
}

const octokit = new Octokit({ auth: GH_TOKEN });

/**
 * Search for issues and PRs assigned to a specific user across all repositories
 * @param {string} username - The GitHub username to search for
 * @param {Date} cutoffDate - Only return items updated since this date
 * @returns {Promise<Array>} - Array of issues and PRs assigned to the user
 */
async function fetchAssignedItems(username, cutoffDate) {
  const cutoffDateString = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD format
  
  console.log(`Searching for issues and PRs assigned to ${username} updated since ${cutoffDateString}...`);
  
  // This query searches for both issues and PRs assigned to the user and updated since the cutoff date
  const query = `assignee:${username} updated:>=${cutoffDateString}`;
  const items = [];
  let hasNextPage = true;
  let page = 1;
  
  while (hasNextPage) {
    console.log(`Fetching page ${page}...`);
    
    try {
      const response = await octokit.search.issuesAndPullRequests({
        q: query,
        per_page: 100, // Max items per page
        page: page,
        sort: 'updated',
        order: 'desc'
      });
      
      const { data } = response;
      
      console.log(`Found ${data.items.length} items on page ${page} (total: ${data.total_count})`);
      
      if (data.items.length === 0) {
        hasNextPage = false;
      } else {
        // Extract relevant information from each item
        const processedItems = data.items.map(item => {
          // Extract repository name from the url (format: https://api.github.com/repos/owner/repo/...)
          const repoFullName = item.repository_url.replace('https://api.github.com/repos/', '');
          const isPR = Boolean(item.pull_request);
          
          return {
            id: item.node_id,
            number: item.number,
            title: item.title,
            author: item.user.login,
            state: item.state.toUpperCase(),
            isPR: isPR,
            updatedAt: item.updated_at,
            type: isPR ? 'PR' : 'Issue',
            repoFullName: repoFullName,
            assignees: item.assignees.map(a => a.login),
            html_url: item.html_url,
            url: item.url,
          };
        });
        
        items.push(...processedItems);
        
        // Check if we've reached the last page (less than 100 items returned)
        if (data.items.length < 100 || page >= 10) { // Limiting to 10 pages (1000 items) for safety
          hasNextPage = false;
        } else {
          page++;
        }
      }
    } catch (error) {
      console.error(`Error fetching assigned items: ${error.message}`);
      if (error.response && error.response.data) {
        console.error('Response data:', error.response.data);
      }
      hasNextPage = false;
    }
  }
  
  return items;
}

/**
 * Run as a standalone script to test the functionality
 */
async function main() {
  try {
    // Default cutoff date is 2 days ago
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    const items = await fetchAssignedItems(GITHUB_AUTHOR, twoDaysAgo);
    
    console.log(`\nFound ${items.length} items assigned to ${GITHUB_AUTHOR} updated in the last 2 days:`);
    
    // Group by repository
    const byRepo = {};
    for (const item of items) {
      const repo = item.repoFullName;
      if (!byRepo[repo]) {
        byRepo[repo] = [];
      }
      byRepo[repo].push(item);
    }
    
    // Print summary by repository
    console.log("\nSummary by repository:");
    for (const [repo, repoItems] of Object.entries(byRepo)) {
      console.log(`\n${repo} (${repoItems.length} items):`);
      for (const item of repoItems) {
        console.log(`- ${item.type} #${item.number}: ${item.title} (${item.state})`);
        console.log(`  URL: ${item.html_url}`);
      }
    }
    
    // Return the items for potential integration with project-sync.js
    return items;
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Run the script if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });
} else {
  // Export for use in other modules
  module.exports = { fetchAssignedItems };
}
