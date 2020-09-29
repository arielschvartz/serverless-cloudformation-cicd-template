import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import { Pool } from 'pg';

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
  execSync(`cd /tmp && git clone https://x-token-auth:${bitbucketAccessToken}@bitbucket.org/${process.env.bitbucketWorkspace}/${process.env.bitbucketRepository} --branch ${branchName} ${name}`, { encoding: 'utf8', stdio: 'inherit' });
  // IN THIS CASE SUBMODULES ARE NOT NEEDED SO DO NOT DOWNLOAD THEM
  // execSync(`
  //   cd /tmp/${name};
  //   while IFS= read -r submodule; do
  //     if [ -z "$submodule" ];
  //     then
  //       echo "no submodules";
  //     else
  //       git clone https://x-token-auth:${bitbucketAccessToken}@bitbucket.org/${process.env.bitbucketWorkspace}/$submodule;
  //     fi
  //   done <<< $(git config --file .gitmodules --get-regexp path | awk '{ print $2 }');
  // `, { encoding: 'utf8', stdio: 'inherit' });

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

const getSecretsManagerInstance = async (event) => {
  const {
    Payload: {
      environment,
    },
  } = event;

  let opts = {
    apiVersion: '2017-10-17',
  };

  if (environment === 'qa') {
    Object.assign(opts, { credentials: await assumeQARole() });
  }

  return new AWS.SecretsManager(opts);
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

export const createDatabaseCopy = async (event, context) => {
  const {
    Payload: {
      environment,
      dbName,
      secretId,
    },
  } = event;

  const secretsmanager = await getSecretsManagerInstance(event);
  const {
    SecretString,
  } = await secretsmanager.getSecretValue({
    SecretId: secretId,
  }).promise();

  ({
    username,
    password,
    host,
    port,
  } = JSON.parse(SecretString));

  const pool = new Pool({
    user: username,
    password,
    host,
    port,
    database: dbName,
    min: 0,
    max: 1
  });

  const {
    rows,
  } = await pool.query({
    text: `
      SELECT datname FROM pg_database WHERE datname = $1;
    `,
    values: [dbName],
  });

  if (rows.length < 1) {
    throw new Error(`Database with name '${dbName}' does not exist.`)
  }

  // DELETE ANY BACKUP IF IT EXISTS
  await pool.query({
    text: `
      DROP DATABASE IF EXISTS "${dbName}-backup";
    `,
  });

  // CLOSE ALL CONNECTIONS
  await pool.query({
    text: `
      SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity 
      WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid();
    `,
    values: [dbName]
  })

  // CREATE A COPY
  await pool.query({
    text: `
      CREATE DATABASE "${dbName}-backup" 
      WITH TEMPLATE "${dbName}"
      OWNER "${username}";
    `,
  });
}
