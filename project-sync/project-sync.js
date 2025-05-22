const { graphql } = require("@octokit/graphql");
const fs = require("fs");
const yaml = require("js-yaml");

const GH_TOKEN = process.env.GH_TOKEN;
// TODO: In the future, look up PROJECT_ID dynamically using org and project number.
// For now, PROJECT_ID is hardcoded as: PVT_kwDOAA37OM4AFuzg
const PROJECT_ID = "PVT_kwDOAA37OM4AFuzg"; // GitHub Project (beta) node ID
const ORG = process.env.ORG || "bcgov";
const PROJECT_NUMBER = process.env.PROJECT_NUMBER || 16; // Default to 16 if not set

// NOTE: This script is now fully hardcoded to use the project node ID.
// If you want to use dynamic lookup by project number, use sync-to-project.js as your entrypoint instead of project-sync.js.

const graphqlWithAuth = graphql.defaults({
  headers: { authorization: `token ${GH_TOKEN}` },
});

const repos = yaml.load(fs.readFileSync("project-sync/repos.yml")).repos;

const RECENT_DAYS = 2;

// Helper to ensure repo is in owner/repo format
function withOrg(repo, org) {
  if (repo.includes('/')) return repo;
  return `${org}/${repo}`;
}

// Get project and fields using correct GraphQL fragments for all field types
async function getProjectAndFields(org, projectNumber) {
  const projectRes = await graphqlWithAuth(`
    query($org: String!, $number: Int!) {
      organization(login: $org) {
        projectV2(number: $number) {
          id
          title
          fields(first: 30) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
              ... on ProjectV2IterationField {
                id
                name
                configuration { iterations { id title startDate } }
              }
              ... on ProjectV2Field {
                id
                name
              }
            }
          }
        }
      }
    }
  `, { org, number: Number(projectNumber) });
  return projectRes.organization.projectV2;
}

// Dynamically fetch the Sprint field and select the current sprint option
async function getCurrentSprintValue() {
  const projectRes = await graphqlWithAuth(`
    query($projectId:ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 30) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
              ... on ProjectV2Field {
                id
                name
              }
            }
          }
        }
      }
    }
  `, { projectId: PROJECT_ID });
  const fields = projectRes.node.fields.nodes;
  // Find the Sprint field
  const sprintField = fields.find(f => f.name && f.name.toLowerCase().includes('sprint') && f.options);
  if (!sprintField) throw new Error('Could not find a Sprint field');
  // Find the latest sprint whose date is not in the future
  const today = new Date();
  let currentSprint = null;
  for (const opt of sprintField.options) {
    const match = opt.name.match(/(\d{4}-\d{2}-\d{2})/);
    if (match) {
      const sprintDate = new Date(match[1]);
      if (sprintDate <= today && (!currentSprint || sprintDate > new Date(currentSprint.date))) {
        currentSprint = { id: opt.id, name: opt.name, date: match[1] };
      }
    }
  }
  if (!currentSprint) throw new Error('Could not determine current sprint from Sprint field options');
  return { fieldId: sprintField.id, value: currentSprint.name };
}

async function addToProject(contentId) {
  // Add item to project
  const addRes = await graphqlWithAuth(`
    mutation($projectId:ID!, $contentId:ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item { id }
      }
    }
  `, { projectId: PROJECT_ID, contentId });
  return addRes.addProjectV2ItemById.item.id;
}

async function setSprint(itemId) {
  // Set sprint field value dynamically
  const { fieldId, value } = await getCurrentSprintValue();
  await graphqlWithAuth(`
    mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $value:String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { text: $value }
      }) { projectV2Item { id } }
    }
  `, { projectId: PROJECT_ID, itemId, fieldId, value });
}

// Dynamically fetch the Done field and option ID
async function getDoneFieldAndOption() {
  const projectRes = await graphqlWithAuth(`
    query($projectId:ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 30) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
              ... on ProjectV2Field {
                id
                name
              }
            }
          }
        }
      }
    }
  `, { projectId: PROJECT_ID });
  const fields = projectRes.node.fields.nodes;
  // Try to find a field named 'Status' or 'Column'
  const doneField = fields.find(f => f.name && (f.name.toLowerCase().includes('status') || f.name.toLowerCase().includes('column')) && f.options);
  if (!doneField) throw new Error('Could not find a Status/Column field');
  const doneOption = doneField.options.find(o => o.name.toLowerCase() === 'done');
  if (!doneOption) throw new Error('Could not find a Done option in the Status/Column field');
  return { fieldId: doneField.id, optionId: doneOption.id };
}

async function moveToDone(itemId, doneFieldId, doneOptionId) {
  await graphqlWithAuth(`
    mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:ID!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) { projectV2Item { id } }
    }
  `, { projectId: PROJECT_ID, itemId, fieldId: doneFieldId, optionId: doneOptionId });
}

async function processRepo(repo) {
  // Get closed issues and PRs in the last RECENT_DAYS days
  const [owner, name] = repo.split("/");
  const sinceDate = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const since = sinceDate.toISOString();

  console.log(`\nProcessing repository: ${repo}`);
  console.log(`  Checking for issues/PRs closed or merged in the last ${RECENT_DAYS} days (since ${sinceDate.toISOString().slice(0,10)})...`);

  // Issues
  let issuesRes = await graphqlWithAuth(`
    query($owner:String!, $name:String!, $since:DateTime!) {
      repository(owner: $owner, name: $name) {
        issues(states: CLOSED, filterBy: {since: $since}, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { id, number, title, closedAt }
        }
      }
    }
  `, { owner, name, since });
  if (!issuesRes.repository.issues.nodes.length) {
    console.log("  No recently closed issues found.");
  }
  for (const issue of issuesRes.repository.issues.nodes) {
    const itemId = await addToProject(issue.id);
    await setSprint(itemId);
    await moveToDone(itemId, doneFieldId, doneOptionId);
    console.log(`  Added issue #${issue.number} to project and moved to Done`);
  }

  // PRs
  let prsRes = await graphqlWithAuth(`
    query($owner:String!, $name:String!) {
      repository(owner: $owner, name: $name) {
        pullRequests(states: CLOSED, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { id, number, title, closedAt, merged, mergedAt, author { login } }
        }
      }
    }
  `, { owner, name });
  let prCount = 0;
  for (const pr of prsRes.repository.pullRequests.nodes) {
    if (!pr.merged) continue; // Only process merged PRs
    const itemId = await addToProject(pr.id);
    await setSprint(itemId);
    await moveToDone(itemId, doneFieldId, doneOptionId);
    // Assign PR to author if author is the current user
    if (pr.author && pr.author.login && pr.author.login.toLowerCase() === process.env.GITHUB_ACTOR?.toLowerCase()) {
      await graphqlWithAuth(`
        mutation($itemId:ID!, $assignee:String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId,
            itemId: $itemId,
            fieldId: "assignees",
            value: { users: [$assignee] }
          }) { projectV2Item { id } }
        }
      `, { projectId: PROJECT_ID, itemId, assignee: pr.author.login });
      console.log(`  Assigned merged PR #${pr.number} to author (${pr.author.login})`);
    }
    console.log(`  Added merged PR #${pr.number} to project and moved to Done`);
    prCount++;
  }
  if (prCount === 0) {
    console.log("  No recently merged PRs found.");
  }
}

(async () => {
  const project = await getProjectAndFields(ORG, PROJECT_NUMBER);
  if (!project) {
    throw new Error(`Could not resolve to a ProjectV2 with the number ${PROJECT_NUMBER} in org ${ORG}. Check that the project number and org are correct, and that your token has access.`);
  }
  const PROJECT_ID = project.id;
  console.log(`\n---\nSyncing to GitHub Project: '${project.title}' (ID: ${PROJECT_ID}) in org: '${ORG}'\n---`);
  let hadError = false;
  for (const repo of repos) {
    try {
      const fullRepo = withOrg(repo, ORG);
      await processRepo(fullRepo);
    } catch (e) {
      console.error(`Error processing ${repo}:`, e.message);
      hadError = true;
    }
  }
  if (hadError) {
    console.error("\nOne or more repositories failed to sync. Exiting with error status.");
    process.exit(1);
  }
})();
