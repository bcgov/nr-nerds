// A simple script to test the user assignment functionality
const { Octokit } = require("@octokit/rest");

// Get GitHub token from environment variable
const GH_TOKEN = process.env.GH_TOKEN;
const octokit = new Octokit({ auth: GH_TOKEN });

async function testAssignment() {
  // Set up test parameters
  const owner = 'bcgov'; // example: replace with your target owner
  const repo = 'nr-nerds'; // example: replace with your target repo
  const issue_number = 73; // example: replace with a real issue/PR number to test with
  const userId = 'DerekRoberts'; // example: replace with a real GitHub username

  try {
    console.log(`Testing assignment of user ${userId} to issue/PR #${issue_number}...`);
    
    // Use the issues API endpoint for assigning users
    const response = await octokit.issues.addAssignees({
      owner,
      repo,
      issue_number,
      assignees: [userId]
    });
    
    console.log('Assignment successful!');
    console.log(`Status: ${response.status}`);
    console.log(`Assigned users: ${JSON.stringify(response.data.assignees.map(a => a.login))}`);
  } catch (error) {
    console.error('Assignment failed:');
    console.error(`Status: ${error.status}`);
    console.error(`Message: ${error.message}`);
    
    if (error.response) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Run the test
testAssignment().catch(err => {
  console.error('Uncaught error:', err);
  process.exit(1);
});
