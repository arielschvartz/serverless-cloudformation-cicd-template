import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';

import {
  getBitbucketAccessToken,
  getBranchesWithName,
  createBranch,
  openPullRequest,
  declinePullRequest,
  mergePullRequest,
  downloadSourceCode,
} from '../../lib/bitbucket';

import {
  SnapshotNotReadyError
} from '../errors';

import {
  assumeQARole,
} from '../utils';

export const getAccessToken = async () => {
  const bitbucketAccessToken = await getBitbucketAccessToken({
    clientId: process.env.bitbucketClientId,
    clientSecret: process.env.bitbucketSecret,
  });

  return bitbucketAccessToken;
}

export const checkMigrationsChecksumChanged = async (event, context) => {
  const {
    bitbucket: {
      newBranchName: branchName,
    }
  } = event;

  const bitbucketAccessToken = await getAccessToken();
  const name = 'sourceCode'

  execSync('rm -rf /tmp/*', { encoding: 'utf8', stdio: 'inherit' });
  execSync(`cd /tmp && git clone https://x-token-auth:${bitbucketAccessToken}@bitbucket.org/${process.env.bitbucketWorkspace}/${process.env.bitbucketRepository} --branch ${branchName} --recurse-submodules ${name}`, { encoding: 'utf8', stdio: 'inherit' });

  try {
    execSync(`cd /tmp/${name} && git diff origin/${process.env.bitbucketTargetBranch} --name-only --no-renames | grep -q ${process.env.migrationsFolder}/`, { encoding: 'utf8', stdio: 'inherit' });
    return true;
  } catch (error) {
    // COMMAND FAILED BECAUSE GREP RETURNS NOTHING, SO, THERE'S NO CHANGED ON THE MIGRATIONS
    return false;
  }
}

const getRDSInstance = async (event) => {
  const {
    Payload: {
      environment,
    }
  } = event;

  let opts = {
    apiVersion: '2014-10-31'
  };
  if (environment === 'qa') {
    Object.assign(opts, { credentials: await assumeQARole() });
  }

  return new AWS.RDS(opts);
}

export const takeRDSSnapshot = async (event, context) => {
  const {
    Payload: {
      rdsIdentifier,
    },
  } = event;

  const rds = await getRDSInstance(event);
  const snapshotIdentifier = `snapshot-${uuidv4()}`;

  await rds.createDBSnapshot({
    DBInstanceIdentifier: rdsIdentifier,
    DBSnapshotIdentifier: snapshotIdentifier,
  }).promise();

  return snapshotIdentifier;
}

export const isSnapshotReady = async (event, context) => {
  const {
    Payload: {
      rdsIdentifier,
    },
  } = event;

  const rds = await getRDSInstance(event);

  const {
    snapshotIdentifier,
  } = event;

  const {
    DBSnapshots: [
      {
        Status: status,
      } = {}
    ] = [],
  } = await rds.describeDBSnapshots({
    DBInstanceIdentifier: rdsIdentifier,
    DBSnapshotIdentifier: snapshotIdentifier,
  }).promise();

  if (status !== 'available') {
    console.log("CURRENT STATUS IS", status);
    throw new SnapshotNotReadyError();
  }
}