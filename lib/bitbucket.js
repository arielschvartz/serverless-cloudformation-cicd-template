const axios = require('axios');
const path = require('path');
const fs = require('fs');
const queryString = require('query-string')

const bitbucketBaseURL = 'https://api.bitbucket.org/2.0';

function bitbucketAxios(accessToken) {
  return axios.create({
    headers: {
      Authorization: `Bearer ${accessToken}`,
    }
  });
}

module.exports.getBitbucketAccessToken = async ({ clientId, clientSecret }) => {
  const {
    data: {
      access_token: accessToken,
    },
  } = await axios({
    method: 'POST',
    url: `https://bitbucket.org/site/oauth2/access_token`,
    data: 'grant_type=client_credentials',
    auth: {
      username: clientId,
      password: clientSecret,
    },
  });

  return accessToken;
}

module.exports.creatHook = async({ accessToken, workspace, repository, description, url, events, }) => {
  const apiURL = `${bitbucketBaseURL}/repositories/${workspace}/${repository}/hooks`;

  return bitbucketAxios(accessToken).post(apiURL, {
    description,
    url,
    active: true,
    events,
  });
}

module.exports.getHooks = async ({ accessToken, workspace, repository }) => {
  const url = `${bitbucketBaseURL}/repositories/${workspace}/${repository}/hooks`;

  const ax = bitbucketAxios(accessToken);

  let {
    data: {
      values: hooks,
      next,
    }
  } = await ax.get(url);

  let values;
  while (next) {
    ({
      data: {
        values,
        next,
      }
    } = await ax.get(next))

    hooks = hooks.concat(values);
  }

  return hooks;
}

module.exports.getBranches = async (params) => {
  const {
    accessToken,
    workspace,
    repository,
  } = params;

  const url = `${bitbucketBaseURL}/repositories/${workspace}/${repository}/refs/branches`;

  return bitbucketAxios(accessToken).get(url)
}

module.exports.getBranchesWithName = async (params) => {
  const {
    accessToken,
    workspace,
    repository,
    branchName,
  } = params;

  const url = `${bitbucketBaseURL}/repositories/${workspace}/${repository}/refs/branches`;

  let {
    data: {
      next,
      values,
    }
  } = await bitbucketAxios(accessToken).get(
    queryString.stringifyUrl({
      url,
      query: {
        q: `name ~ "${branchName}"`,
      }
    })
  );

  while (next) {
    const {
      data: {
        next: newNext,
        values: newValues,
      }
    } = await bitbucketAxios(accessToken).get(next);

    values = values.concat(newValues);
    next = newNext;
  }

  return values.length;
}

module.exports.createBranch = async (params) => {
  const {
    accessToken,
    workspace,
    repository,
    newBranchName,
    destinationBranchName,
  } = params;

  const url = `${bitbucketBaseURL}/repositories/${workspace}/${repository}/refs/branches`;

  return bitbucketAxios(accessToken).post(url, {
    name: newBranchName,
    target : {
      hash: destinationBranchName,
    },
  })
}

module.exports.openPullRequest = async (params) => {
  const {
    accessToken,
    workspace,
    repository,
    title,
    description,
    sourceBranchName,
    destinationBranchName,
    closeSourceBranch = false,
  } = params;

  const url = `${bitbucketBaseURL}/repositories/${workspace}/${repository}/pullrequests`

  return bitbucketAxios(accessToken).post(url, {
    title,
    description,
    source: {
      branch: {
        name: sourceBranchName,
      }
    },
    destination: {
      branch: {
        name: destinationBranchName,
      }
    },
    close_source_branch: closeSourceBranch,
  });
}

const commentPullRequest = async (params) => {
  const {
    accessToken,
    workspace,
    repository,
    pullRequestId,
    comment,
  } = params;

  const url = `${bitbucketBaseURL}/repositories/${workspace}/${repository}/pullrequests/${pullRequestId}/comments`;

  return bitbucketAxios(accessToken).post(url, {
    content: {
      raw: comment,
    },
  });
}

module.exports.commentPullRequest = commentPullRequest;

module.exports.declinePullRequest = async (params) => {
  const {
    accessToken,
    workspace,
    repository,
    pullRequestId,
    reason,
  } = params;

  if (reason) {
    await commentPullRequest({
      ...params,
      comment: reason
    });
  }

  const url = `${bitbucketBaseURL}/repositories/${workspace}/${repository}/pullrequests/${pullRequestId}/decline`;

  return bitbucketAxios(accessToken).post(url);
}

module.exports.mergePullRequest = async (params) => {
  const {
    accessToken,
    workspace,
    repository,
    pullRequestId,
    closeSourceBranch = false,
  } = params;

  const url = `${bitbucketBaseURL}/repositories/${workspace}/${repository}/pullrequests/${pullRequestId}/merge`;

  return bitbucketAxios(accessToken).post(url, {
    type: '',
    message: 'CI/CD automatic merge for the temporary branch.',
    close_source_branch: closeSourceBranch,
    merge_strategy: 'merge_commit'
  })
}

module.exports.downloadSourceCode = async (params) => {
  const {
    accessToken,
    workspace,
    repository,
    branchName,
    file,
  } = params;

  const url = `https://bitbucket.org/${workspace}/${repository}/get/${encodeURIComponent(branchName)}.zip`

  console.log("URL", url);
  const writer = fs.createWriteStream(file)
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  response.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}