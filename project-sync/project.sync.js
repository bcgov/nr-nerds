const { graphql } = require("@octokit/graphql");
const fs = require("fs");
const yaml = require("js-yaml");

const GH_TOKEN = process.env.GH_TOKEN;
// TODO: In the future, look up PROJECT_ID dynamically using org and project number.
// For now, PROJECT_ID is hardcoded as: PVT_kwDOAA37OM4AFuzg
const PROJECT_ID = "PVT_kwDOAA37OM4AFuzg"; // GitHub Project (beta) node ID

// NOTE: This script is now fully hardcoded to use the project node ID.
// If you want to use dynamic lookup by project number, use sync-to-project.js as your entrypoint instead of project-sync.js.

const graphqlWithAuth = graphql.defaults({
  headers: { authorization: `token ${GH_TOKEN}` },
});

const repos = yaml.load(fs.readFileSync("project-sync/repos.yml")).repos;

// Helper to ensure repo is in owner/repo format
function withOrg(repo, org) {
  if (repo.includes('/')) return repo;
  return `${org}/${repo}`;
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
  // Get closed issues and PRs in the last 2 days
  const [owner, name] = repo.split("/");
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

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
  const { fieldId: doneFieldId, optionId: doneOptionId } = await getDoneFieldAndOption();
  for (const issue of issuesRes.repository.issues.nodes) {
    const itemId = await addToProject(issue.id);
    await setSprint(itemId);
    await moveToDone(itemId, doneFieldId, doneOptionId);
    console.log(`Added issue #${issue.number} to project and moved to Done`);
  }

  // PRs
  let prsRes = await graphqlWithAuth(`
    query($owner:String!, $name:String!, $since:DateTime!) {
      repository(owner: $owner, name: $name) {
        pullRequests(states: CLOSED, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { id, number, title, closedAt }
        }
      }
    }
  `, { owner, name, since });
  for (const pr of prsRes.repository.pullRequests.nodes) {
    const itemId = await addToProject(pr.id);
    await setSprint(itemId);
    await moveToDone(itemId, doneFieldId, doneOptionId);
    console.log(`Added PR #${pr.number} to project and moved to Done`);
  }
}

(async () => {
  for (const repo of repos) {
    try {
      const fullRepo = withOrg(repo, ORG);
      await processRepo(fullRepo);
    } catch (e) {
      console.error(`Error processing ${repo}:`, e.message);
    }
  }
})();
