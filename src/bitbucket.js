import fs from 'fs';
import archiver from 'archiver';
import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';

import {
  notify,
} from './utils';

import {
  getBitbucketAccessToken,
  declinePullRequest,
  openPullRequest,
  deleteBranch,
} from '../lib/bitbucket';

const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

export const getAccessToken = async () => {
  const bitbucketAccessToken = await getBitbucketAccessToken({
    clientId: process.env.bitbucketClientId,
    clientSecret: process.env.bitbucketSecret,
  });

  return bitbucketAccessToken;
}

export const openNewBranch = async (event, context) => {
  const {
    pullrequest: {
      id: originalPullRequestId,
      title,
      description,
    },
    source: {
      name: sourceBranchName,
    },
    destination: {
      name: destinationBranchName,
    },
  } = event;

  const rand = Math.random().toString(36).substr(2, 5);
  const tempBranchName = `${`${process.env.branchPrefix}${sourceBranchName}`.substring(0, 34)}-${rand}`;

  const bitbucketAccessToken = await getAccessToken();
  const name = 'sourceCode'

  execSync('rm -rf /tmp/*', { encoding: 'utf8', stdio: 'inherit' });
  execSync(`cd /tmp && git clone https://x-token-auth:${bitbucketAccessToken}@bitbucket.org/${process.env.bitbucketWorkspace}/${process.env.bitbucketRepository} --branch ${destinationBranchName} ${name}`, { encoding: 'utf8', stdio: 'inherit' });
  execSync(`cd /tmp/${name} && git checkout -b ${tempBranchName}`, { encoding: 'utf8', stdio: 'inherit' });
  execSync(`cd /tmp/${name} && git config user.email "${process.env.serviceName}@cicd.com"`);
  execSync(`cd /tmp/${name} && git config user.name "CICD"`);
  execSync(`cd /tmp/${name} && git merge origin/${sourceBranchName}`, { encoding: 'utf8', stdio: 'inherit' });
  execSync(`cd /tmp/${name} && git push origin ${tempBranchName}`, { encoding: 'utf8', stdio: 'inherit' });

  try {
    await declinePullRequest({
      accessToken: bitbucketAccessToken,
      workspace: process.env.bitbucketWorkspace,
      repository: process.env.bitbucketRepository,
      pullRequestId: originalPullRequestId,
      reason: 'Automatic Delcine from the CI/CD pipeline.',
    })

    console.log("DECLINED ORIGINAL PULL REQUEST");
  } catch (error) {
    console.log("COULD NOT CLOSE THE ORIGINAL PULL REQUEST, MAYBE IT WAS ALREADY CLOSED");
  }

  return tempBranchName;
}

export const downloadAndSaveSource = async (event, context) => {
  const {
    newBranchName: branchName,
  } = event;

  const bitbucketAccessToken = await getAccessToken();
  const name = 'sourceCode'

  execSync('rm -rf /tmp/*', { encoding: 'utf8', stdio: 'inherit' });
  execSync(`
    cd /tmp;
    git clone https://x-token-auth:${bitbucketAccessToken}@bitbucket.org/${process.env.bitbucketWorkspace}/${process.env.bitbucketRepository} --branch ${branchName} --single-branch ${name}
  `, { encoding: 'utf8', stdio: 'inherit' });
  execSync(`
    cd /tmp/${name};
    while IFS= read -r submodule; do
      if [ -z "$submodule" ];
      then
        echo "no submodules";
      else
        git clone https://x-token-auth:${bitbucketAccessToken}@bitbucket.org/${process.env.bitbucketWorkspace}/$submodule;
      fi
    done <<< $(git config --file .gitmodules --get-regexp path | awk '{ print $2 }');
  `, { encoding: 'utf8', stdio: 'inherit' });

  const filePath = `/tmp/${name}.zip`;

  console.log("BEFORE ARCHIVE PROMISE")

  await new Promise((resolve, reject) => {
    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    const output = fs.createWriteStream(filePath);

    archive.directory(`/tmp/${name}`, false);
    archive.on('error', (err) => reject(err));
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.log(err);
      } else {
        reject(err);
      }
    });
    archive.pipe(output);

    output.on('close', () => resolve());
    archive.finalize();

    console.log("FINALIZING ARCHIVE");
  });

  console.log("ARCHIVED");

  const sourceBucketName = process.env.sourceBucketName;
  const sourceObjectKey = `${branchName}-${uuidv4()}.zip`;

  await s3.putObject({
    Bucket: sourceBucketName,
    Key: sourceObjectKey,
    Body: fs.createReadStream(filePath),
  }).promise();

  console.log("SAVED SOURCE TO S3");

  return {
    bucketName: sourceBucketName,
    objectKey: sourceObjectKey,
    location: `${sourceBucketName}/${sourceObjectKey}`
  };
}

export const openPR = async (event, context) => {
  console.log("EVENT", event);

  const {
    taskToken,
    executionId,
    title,
    description,
    sourceBranchName,
    destinationBranchName,
  } = event;

  const bitbucketAccessToken = await getAccessToken();
  const executionURL = `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionId}`;

  const data = await openPullRequest({
    accessToken: bitbucketAccessToken,
    workspace: process.env.bitbucketWorkspace,
    repository: process.env.bitbucketRepository,
    title,
    description: JSON.stringify({
      taskToken,
      executionId,
      executionURL,
      description,
    }, null, 2),
    sourceBranchName,
    destinationBranchName,
    closeSourceBranch: true,
  });

  const {
    data: {
      id: pullRequestId,
    } = {}
  } = data;

  await notify({
    title: `${process.env.bitbucketWorkspace}/${process.env.bitbucketRepository} - CI/CD New code to test!`,
    text: `There's new code deployed to the testing stage. A new PR is opened on the source code repository for code review!\nThe PR can be found at https://bitbucket.org/${process.env.bitbucketWorkspace}/${process.env.bitbucketRepository}/pull-requests/${pullRequestId}\nThis CI/CD execution can be found at ${executionURL}`
  });

  return pullRequestId;
}

export const deleteCreatedBranch = async (event, context) => {
  const {
    Payload: {
      branchName,
    },
  } = event;

  const bitbucketAccessToken = await getAccessToken();

  await deleteBranch({
    accessToken: bitbucketAccessToken,
    workspace: process.env.bitbucketWorkspace,
    repository: process.env.bitbucketRepository,
    branchName,
  });
}