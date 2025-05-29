/**
 * Test script to check the behavior of issue #65 with linked PRs
 */
const { Octokit } = require("@octokit/rest");
require('dotenv').config();

// Main function to fetch and analyze issue #65
async function checkIssue65() {
  const GH_TOKEN = process.env.GH_TOKEN;
  const OWNER = 'bcgov';
  const REPO = 'nr-nerds';
  const ISSUE_NUMBER = 65;

  if (!GH_TOKEN) {
    console.error("Error: GH_TOKEN environment variable not set.");
    console.log("Please create a .env file with GH_TOKEN=your_token");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: GH_TOKEN });

  console.log(`Fetching issue #${ISSUE_NUMBER} from ${OWNER}/${REPO}...`);

  try {
    // Fetch the issue
    const issue = await octokit.issues.get({
      owner: OWNER,
      repo: REPO,
      issue_number: ISSUE_NUMBER
    });

    console.log("Issue details:");
    console.log(`- Title: ${issue.data.title}`);
    console.log(`- State: ${issue.data.state}`);
    console.log(`- Created: ${issue.data.created_at}`);
    console.log(`- Updated: ${issue.data.updated_at}`);

    // Fetch linked PRs
    const timelineItems = await octokit.issues.listEventsForTimeline({
      owner: OWNER,
      repo: REPO,
      issue_number: ISSUE_NUMBER,
      per_page: 100
    });

    // Extract cross-referenced PRs
    const linkedPRs = timelineItems.data.filter(
      item => item.event === 'cross-referenced' && item.source && item.source.issue.pull_request
    );
    
    console.log(`\nFound ${linkedPRs.length} linked PRs:`);
    
    // For each linked PR, fetch its details
    for (const linkedItem of linkedPRs) {
      const prOwner = linkedItem.source.issue.repository.owner.login;
      const prRepo = linkedItem.source.issue.repository.name;
      const prNumber = linkedItem.source.issue.number;
      
      console.log(`\nFetching PR #${prNumber} from ${prOwner}/${prRepo}...`);
      
      try {
        const pr = await octokit.pulls.get({
          owner: prOwner,
          repo: prRepo,
          pull_number: prNumber
        });
        
        console.log(`- PR ${prNumber}: ${pr.data.title}`);
        console.log(`  State: ${pr.data.state}`);
        console.log(`  Merged: ${pr.data.merged}`);
        console.log(`  Created: ${pr.data.created_at}`);
        console.log(`  Updated: ${pr.data.updated_at}`);
        console.log(`  Merged at: ${pr.data.merged_at || 'Not merged'}`);
        console.log(`  Closed at: ${pr.data.closed_at || 'Not closed'}`);
        
        // Our logic would consider this PR merged if:
        const wouldConsiderMerged = pr.data.merged === true;
        
        // Enhanced logic:
        const hasLinkedIssues = true; // Since we found this PR through a linked issue, we know it has at least one
        const enhancedMergeLogic = pr.data.merged === true || 
          (pr.data.state === 'closed' && hasLinkedIssues);
        
        console.log(`  Would consider merged by old logic: ${wouldConsiderMerged}`);
        console.log(`  Would consider merged by enhanced logic: ${enhancedMergeLogic}`);
      } catch (prError) {
        console.error(`Error fetching PR: ${prError.message}`);
      }
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Message: ${error.response.data.message}`);
    }
  }
}

// Run the function
checkIssue65();
