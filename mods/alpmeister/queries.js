// The GraphQL documents Alpmeister sends through `gh api graphql`. Plain strings with no
// imports, so they can be tried from a shell as they are.

const STATUS_VALUE = `... on ProjectV2ItemFieldSingleSelectValue { name updatedAt }`;
const ITERATION_VALUE = `... on ProjectV2ItemFieldIterationValue { title startDate duration }`;
const OWNER_LOGIN = `owner { ... on Organization { login } ... on User { login } }`;
const CHECKS = `commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;

/** The issue fields of an issue, such as Priority: single-select values with their field's name. */
const ISSUE_FIELDS = `
  issueFieldValues(first: 20) {
    nodes {
      ... on IssueFieldSingleSelectValue { name field { ... on IssueFieldCommon { name } } }
    }
  }`;

/** The board fields of an issue on a known board: its status and iteration, read by field name. */
const BOARD_FIELDS = `
  projectItems(first: 10) {
    nodes {
      project { number ${OWNER_LOGIN} }
      status: fieldValueByName(name: $statusField) { ${STATUS_VALUE} }
      iteration: fieldValueByName(name: $iterationField) { ${ITERATION_VALUE} }
    }
  }`;

/**
 * The board fields of an issue on any board: every single-select and iteration value with its
 * field's name, so each board's own Status and Iteration fields can be picked out afterwards.
 */
const ANY_BOARD_FIELDS = `
  projectItems(first: 10) {
    nodes {
      project { number ${OWNER_LOGIN} }
      fieldValues(first: 30) {
        nodes {
          ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt field { ... on ProjectV2FieldCommon { name } } }
          ... on ProjectV2ItemFieldIterationValue { title startDate duration field { ... on ProjectV2FieldCommon { name } } }
        }
      }
    }
  }`;

/**
 * Your GitHub as a whole: the repositories you own, collaborate on or reach through an
 * organization, each with its open counts and the default branch's checks, and the @me searches.
 * Variables: reviewQuery, mineQuery, myPrsQuery.
 */
export const ACCOUNT = `
query($reviewQuery: String!, $mineQuery: String!, $myPrsQuery: String!) {
  viewer {
    login
    repositories(
      first: 100
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      totalCount
      nodes {
        nameWithOwner url isArchived isPrivate isFork pushedAt
        issues(states: OPEN) { totalCount }
        pullRequests(states: OPEN) { totalCount }
        defaultBranchRef { name target { ... on Commit { statusCheckRollup { state } } } }
      }
    }
  }
  reviews: search(type: ISSUE, query: $reviewQuery, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        number title url updatedAt
        repository { nameWithOwner }
        author { login }
        ${CHECKS}
      }
    }
  }
  myPrs: search(type: ISSUE, query: $myPrsQuery, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        number title url updatedAt reviewDecision
        repository { nameWithOwner }
        ${CHECKS}
      }
    }
  }
  mine: search(type: ISSUE, query: $mineQuery, first: 100) {
    issueCount
    nodes {
      ... on Issue {
        number title url updatedAt
        repository { nameWithOwner }
        milestone { title }
        ${ANY_BOARD_FIELDS}
      }
    }
  }
}`;

/**
 * A workspace's repository: its milestones with their issues, and the triage count.
 * Variables: owner, name, statusField, iterationField, triageQuery.
 */
export const WORKSPACE_REPO = `
query(
  $owner: String!, $name: String!, $statusField: String!, $iterationField: String!, $triageQuery: String!
) {
  repository(owner: $owner, name: $name) {
    url
    open: milestones(first: 20, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) {
      nodes {
        title number dueOn url
        issues(first: 100) {
          totalCount
          nodes {
            number title state url
            issueType { name }
            parent { number title url }
            labels(first: 10) { nodes { name } }
            subIssuesSummary { total completed }
            assignees(first: 3) { nodes { login } }
            ${ISSUE_FIELDS}
            ${BOARD_FIELDS}
          }
        }
      }
    }
    closed: milestones(first: 10, states: CLOSED, orderBy: { field: DUE_DATE, direction: DESC }) {
      nodes { title dueOn }
    }
  }
  triage: search(type: ISSUE, query: $triageQuery, first: 0) { issueCount }
}`;

/**
 * A workspace's project board, on a user or an organization: its iterations and the items in
 * flight. Variables: projectOwner, projectNumber, statusField, iterationField, inFlightFilter.
 */
export const WORKSPACE_BOARD = `
query(
  $projectOwner: String!, $projectNumber: Int!, $statusField: String!, $iterationField: String!,
  $inFlightFilter: String!
) {
  owner: repositoryOwner(login: $projectOwner) {
    ... on ProjectV2Owner {
      projectV2(number: $projectNumber) {
        title url
        iterationField: field(name: $iterationField) {
          ... on ProjectV2IterationField {
            configuration { iterations { title startDate duration } }
          }
        }
        inFlight: items(first: 100, query: $inFlightFilter) {
          totalCount
          nodes {
            status: fieldValueByName(name: $statusField) { ${STATUS_VALUE} }
            iteration: fieldValueByName(name: $iterationField) { ${ITERATION_VALUE} }
            content {
              ... on Issue {
                number title url
                repository { nameWithOwner }
                assignees(first: 3) { nodes { login } }
                milestone { title }
                closedByPullRequestsReferences(first: 3, includeClosedPrs: false) {
                  nodes { number url isDraft reviewDecision }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

/** A repository's open PRs, for a workspace with no board. Variables: prsQuery. */
export const OPEN_PRS = `
query($prsQuery: String!) {
  search(type: ISSUE, query: $prsQuery, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        number title url updatedAt isDraft reviewDecision
        repository { nameWithOwner }
        author { login }
        ${CHECKS}
      }
    }
  }
}`;

/**
 * One page of open bugs with their issue fields, for the count by priority. Issue search
 * cannot filter on an issue field, so the priorities are counted from the nodes.
 * Variables: bugsQuery, after.
 */
export const BUGS_PAGE = `
query($bugsQuery: String!, $after: String) {
  search(type: ISSUE, query: $bugsQuery, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue { ${ISSUE_FIELDS} }
    }
  }
}`;

/** The repository's labels whose names match `labelQuery`. Variables: owner, name, labelQuery. */
export const CUSTOMER_LABELS = `
query($owner: String!, $name: String!, $labelQuery: String!) {
  repository(owner: $owner, name: $name) {
    labels(first: 50, query: $labelQuery) { nodes { name } }
  }
}`;

/** The number of issues a search finds. Variables: searchQuery. */
export const ISSUE_COUNT = `
query($searchQuery: String!) {
  search(type: ISSUE, query: $searchQuery, first: 0) { issueCount }
}`;

/**
 * The state of each pinned GitHub item, so a pick checks itself once it closes or merges, with
 * an issue's board status and a PR's review decision for the focus card. Built per call: one
 * aliased repository per `owner/name`, one aliased lookup per number in it. No variables.
 * @param {Record<string, number[]>} byRepo The pinned numbers, keyed by `owner/name`.
 * @returns {{ query: string, aliases: Record<string, string> }} The document, and the alias of each repository.
 */
export function pickStates(byRepo) {
  const aliases = {};
  const blocks = Object.entries(byRepo).map(([repo, numbers], index) => {
    const [owner, name] = repo.split("/");
    aliases[repo] = `r${index}`;
    const lookups = numbers
      .map(
        (number) =>
          `n${Number(number)}: issueOrPullRequest(number: ${Number(number)}) {
        ... on Issue { state ${ANY_BOARD_FIELDS} }
        ... on PullRequest { state reviewDecision }
      }`,
      )
      .join("\n      ");
    return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {\n      ${lookups}\n    }`;
  });
  return { query: `query {\n  ${blocks.join("\n  ")}\n}`, aliases };
}

/**
 * What the Settings tab offers to pick from: your repositories, and the boards on your account
 * and your organizations.
 */
export const DISCOVER = `
query {
  viewer {
    login
    repositories(
      first: 100
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      nodes { nameWithOwner isArchived isPrivate isFork defaultBranchRef { name } }
    }
    projectsV2(first: 50) { nodes { number title closed ${OWNER_LOGIN} } }
    organizations(first: 50) {
      nodes { login projectsV2(first: 50) { nodes { number title closed ${OWNER_LOGIN} } } }
    }
  }
}`;

/** The boards linked to a repository. Variables: owner, name. */
export const REPO_BOARDS = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    projectsV2(first: 20) { nodes { number title closed ${OWNER_LOGIN} } }
  }
}`;

/** A board's single-select fields with their options, and its iteration fields. Variables: login, number. */
export const BOARD_FIELD_LIST = `
query($login: String!, $number: Int!) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        title
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField { name options { name } }
            ... on ProjectV2IterationField { name }
          }
        }
      }
    }
  }
}`;
