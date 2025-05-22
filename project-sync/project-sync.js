const { graphql } = require("@octokit/graphql");
const fs = require("fs");
const yaml = require("js-yaml");

// NOTE: This script is for dynamic project lookup. If you want to use a hardcoded project node ID, use sync-to-project.js instead.

const GH_TOKEN = process.env.GH_TOKEN;
const ORG = process.env.ORG || "bcgov";
const PROJECT_NUMBER = process.env.PROJECT_NUMBER; // e.g. 16

const graphqlWithAuth = graphql.defaults({
  headers: { authorization: `token ${GH_TOKEN}` },
});

const repos = yaml.load(fs.readFileSync("project-sync/repos.yml")).repos;

// Get project and fields using correct GraphQL fragments for all field types
async function getProjectAndFields(org, projectNumber) {
  const projectRes = await graphqlWithAuth(`
    query($org: String!, $number: Int!) {
      organization(login: $org) {
        projectV2(number: $number) {
          id
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

async function addToProject(contentId, projectId) {
  // Add item to project
  const addRes = await graphqlWithAuth(`
    mutation($projectId:ID!, $contentId:ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item { id }
      }
    }
  `, { projectId, contentId });
  return addRes.addProjectV2ItemById.item.id;
}

async function setSprint(itemId, projectId, fieldId, value) {
  // Set sprint field value
  await graphqlWithAuth(`
    mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $value:String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { text: $value }
      }) { projectV2Item { id } }
    }
  `, { projectId, itemId, fieldId, value });
}

async function moveToDone(itemId, projectId, fieldId, value) {
  // Set status/column field to Done
  await graphqlWithAuth(`
    mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $value:String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { text: $value }
      }) { projectV2Item { id } }
    }
  `, { projectId, itemId, fieldId, value });
}

async function processRepo(repo, projectId, sprintFieldId, sprintValue, doneFieldId, doneValue) {
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
  for (const issue of issuesRes.repository.issues.nodes) {
    const itemId = await addToProject(issue.id, projectId);
    await setSprint(itemId, projectId, sprintFieldId, sprintValue);
    await moveToDone(itemId, projectId, doneFieldId, doneValue);
    console.log(`Added issue #${issue.number} to project and moved to Done`);
  }

  // PRs
  let prsRes = await graphqlWithAuth(`
    query($owner:String!, $name:String!, $since:DateTime!) {
      repository(owner: $owner, name: $name) {
        pullRequests(states: CLOSED, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { id, number, title, closedAt, merged, mergedAt }
        }
      }
    }
  `, { owner, name, since });
  for (const pr of prsRes.repository.pullRequests.nodes) {
    if (!pr.merged) continue; // Only process merged PRs
    const itemId = await addToProject(pr.id, projectId);
    await setSprint(itemId, projectId, sprintFieldId, sprintValue);
    await moveToDone(itemId, projectId, doneFieldId, doneValue);
    console.log(`Added merged PR #${pr.number} to project and moved to Done`);
  }
}

(async () => {
  const project = await getProjectAndFields(ORG, PROJECT_NUMBER);
  if (!project) {
    throw new Error(`Could not resolve to a ProjectV2 with the number ${PROJECT_NUMBER} in org ${ORG}. Check that the project number and org are correct, and that your token has access.`);
  }
  const PROJECT_ID = project.id;
  // Find field IDs by name
  const SPRINT_FIELD = project.fields.nodes.find(f => f.name.toLowerCase().includes("sprint"));
  const DONE_FIELD = project.fields.nodes.find(f => f.name.toLowerCase().includes("status") || f.name.toLowerCase().includes("column"));
  const DONE_OPTION = DONE_FIELD && DONE_FIELD.options.find(o => o.name.toLowerCase() === "done");
  // Set env vars for rest of script
  const SPRINT_FIELD_ID = SPRINT_FIELD && SPRINT_FIELD.id;
  const DONE_FIELD_ID = DONE_FIELD && DONE_FIELD.id;
  const DONE_VALUE = DONE_OPTION && DONE_OPTION.name;

  for (const repo of repos) {
    try {
      await processRepo(repo, PROJECT_ID, SPRINT_FIELD_ID, SPRINT_VALUE, DONE_FIELD_ID, DONE_VALUE);
    } catch (e) {
      console.error(`Error processing ${repo}:`, e.message);
    }
  }
})();
