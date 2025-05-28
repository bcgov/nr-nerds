// Simple script to directly test issue fetching and project board updates

const { Octokit } = require("@octokit/rest");
const GH_TOKEN = process.env.GH_TOKEN;
const PROJECT_ID = process.env.PROJECT_ID;

if (!GH_TOKEN) {
  console.error("Error: GH_TOKEN environment variable must be set");
  process.exit(1);
}

if (!PROJECT_ID) {
  console.error("Error: PROJECT_ID environment variable must be set");
  process.exit(1);
}

const octokit = new Octokit({ auth: GH_TOKEN });

async function fetchIssue() {
  console.log("Fetching issue...");
  try {
    const result = await octokit.issues.get({
      owner: 'bcgov',
      repo: 'nr-forest-client',
      issue_number: 1603
    });
    console.log("Issue fetched successfully:", result.data.title);
    return result.data;
  } catch (error) {
    console.error("Error fetching issue:", error);
    return null;
  }
}

async function addIssueToProject(nodeId) {
  console.log(`Adding issue with node ID ${nodeId} to project...`);
  try {
    const result = await octokit.graphql(`
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
          item {
            id
          }
        }
      }
    `, {
      projectId: PROJECT_ID,
      contentId: nodeId
    });
    
    console.log("Issue added to project successfully:", result.addProjectV2ItemById.item.id);
    return result.addProjectV2ItemById.item.id;
  } catch (error) {
    console.error("Error adding to project:", error);
    if (error.errors) {
      console.error("GraphQL errors:", JSON.stringify(error.errors, null, 2));
    }
    return null;
  }
}

async function main() {
  try {
    const issue = await fetchIssue();
    if (!issue) {
      console.log("Failed to fetch issue. Exiting.");
      return;
    }
    
    console.log("Issue node ID:", issue.node_id);
    const projectItemId = await addIssueToProject(issue.node_id);
    
    if (projectItemId) {
      console.log("Successfully added issue to project board.");
    } else {
      console.log("Failed to add issue to project board.");
    }
  } catch (error) {
    console.error("Unhandled error:", error);
  }
}

main().catch(error => console.error("Fatal error:", error));
