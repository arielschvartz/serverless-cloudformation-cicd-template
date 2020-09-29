import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import { Pool } from 'pg';

import {
  assumeQARole,
} from '../utils';

import {
  DatabaseInstanceNotReadyError,
  DatabaseInstanceFailedError,
  DatabaseInstanceNotDeleted,
} from '../errors';

const getRollbackInstanceName = (identifier) => {
  return `${identifier}-rollback`;
}

const getOldInstanceName = (identifier) => {
  return `${identifier}-old`;
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

const getRoute53Instance = async (event) => {
  const {
    Payload: {
      environment,
    }
  } = event;

  let opts = {
    apiVersion: '2013-04-01'
  };
  if (environment === 'qa') {
    Object.assign(opts, { credentials: await assumeQARole() });
  }

  return new AWS.Route53(opts);
}

export const createInstanceFromSnapshot = async (event, context) => {
  const {
    Payload: {
      rdsIdentifier,
      snapshotIdentifier,
    },
  } = event;

  const rds = await getRDSInstance(event);

  const {
    DBInstances: [dbInstance]
  } = await rds.describeDBInstances({
    DBInstanceIdentifier: rdsIdentifier,
  }).promise();

  console.log(dbInstance);

  const {
    DBInstanceClass,
    AutoMinorVersionUpgrade,
    Engine,
    VpcSecurityGroups: vpcSecurityGroups,
    DBParameterGroups: [
      {
        DBParameterGroupName,
      } = {},
    ] = [],
    DBSubnetGroup: {
      DBSubnetGroupName,
    } = {},
    MultiAZ,
    PubliclyAccessible,
    StorageType,
  } = dbInstance;

  const VpcSecurityGroupIds = vpcSecurityGroups.length > 0 ? vpcSecurityGroups.map(g => g.VpcSecurityGroupId) : null

  await rds.restoreDBInstanceFromDBSnapshot({
    DBInstanceIdentifier: getRollbackInstanceName(rdsIdentifier),
    DBSnapshotIdentifier: snapshotIdentifier,
    DBInstanceClass,
    AutoMinorVersionUpgrade,
    Engine,
    VpcSecurityGroupIds,
    DBParameterGroupName,
    DBSubnetGroupName,
    MultiAZ,
    PubliclyAccessible,
    StorageType,
  }).promise();
}

export const isRollbackInstanceReady = async (event, context) => {
  const {
    Payload: {
      rdsIdentifier,
      snapshotIdentifier,
      old,
      final,
    },
  } = event;

  const rds = await getRDSInstance(event);

  let status, databaseURL;

  try {
    ({
      DBInstances: [
        {
          DBInstanceStatus: status,
          Endpoint: {
            Address: databaseURL,
          } = {},
        } = {},
      ] = [],
    } = await rds.describeDBInstances({
      DBInstanceIdentifier: old
        ? getOldInstanceName(rdsIdentifier)
        : (
          final
          ? rdsIdentifier
          : getRollbackInstanceName(rdsIdentifier)
        ),
    }).promise());
  } catch (error) {
    if ((old || final) && error.code === 'DBInstanceNotFound') {
      throw new DatabaseInstanceNotReadyError();
    } else {
      throw error;
    }
  }

  if (status === 'failed') {
    throw new DatabaseInstanceFailedError();
  } else if (status !== 'available') {
    console.log("CURRENT STATUS IS", status);
    throw new DatabaseInstanceNotReadyError();
  }

  return databaseURL;
}

export const updateDatabaseCNAME = async (event, context) => {
  const {
    Payload: {
      databaseURL,
      dbDomain,
      hostedZoneId,
    },
  } = event;

  const route53 = await getRoute53Instance(event);

  await route53.changeResourceRecordSets({
    HostedZoneId: hostedZoneId,
    ChangeBatch: {
      Changes: [{
        Action: 'UPSERT',
        ResourceRecordSet: {
          Name: dbDomain,
          Type: 'CNAME',
          TTL: 300,
          ResourceRecords: [{
            Value: databaseURL
          }],
        },
      }]
    }
  }).promise();
}

export const renameOldDatabaseInstance = async (event, context) => {
  const {
    Payload: {
      rdsIdentifier,
    },
  } = event;

  const rds = await getRDSInstance(event);

  const data = await rds.modifyDBInstance({
    DBInstanceIdentifier: rdsIdentifier,
    ApplyImmediately: true,
    NewDBInstanceIdentifier: getOldInstanceName(rdsIdentifier)
  }).promise();
}

export const renameNewDatabaseInstance = async (event, context) => {
  const {
    Payload: {
      rdsIdentifier,
    },
  } = event;

  const rds = await getRDSInstance(event);

  await rds.modifyDBInstance({
    DBInstanceIdentifier: getRollbackInstanceName(rdsIdentifier),
    ApplyImmediately: true,
    NewDBInstanceIdentifier: rdsIdentifier
  }).promise();
}

export const deleteDBInstance = async (event, context) => {
  const {
    Payload: {
      rdsIdentifier,
    },
  } = event;

  const rds = await getRDSInstance(event);

  await rds.deleteDBInstance({
    DBInstanceIdentifier: getOldInstanceName(rdsIdentifier),
    DeleteAutomatedBackups: true,
    SkipFinalSnapshot: true,
  }).promise();
}

export const isDatabaseInstanceDeleted = async (event, context) => {
  const {
    Payload: {
      rdsIdentifier,
    },
  } = event;

  const rds = await getRDSInstance(event);

  let status;
  try {
    ({
      DBInstances: [
        {
          DBInstanceStatus: status,
        } = {}
      ] = [],
    } = await rds.describeDBInstances({
      DBInstanceIdentifier: getOldInstanceName(rdsIdentifier),
    }).promise());
  } catch (error) {
    if (error.code === 'DBInstanceNotFound') {
      return 'deleted';
    }

    throw error;
  }

  console.log("STATUS", status);
  throw new DatabaseInstanceNotDeleted();
}

export const deleteDBSnapshot = async (event, context) => {
  const {
    Payload: {
      snapshotIdentifier,
    },
  } = event;

  const rds = await getRDSInstance(event);

  await rds.deleteDBSnapshot({
    DBSnapshotIdentifier: snapshotIdentifier,
  }).promise();
}

export const rollbackDatabaseCopy = async (event, context) => {
  const {
    Payload: {
      environment,
      dbName,
      secretId,
    },
  } = event;

  const secretsmanager = new AWS.SecretsManager();
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
    rows: newDBsRows,
  } = await pool.query({
    text: `
      SELECT datname FROM pg_database WHERE datname = $1;
    `,
    values: [dbName],
  });

  if (newDBsRows.length < 1) {
    console.log('The new DB could not be found!');
  }

  const {
    rows: backupDBsRows,
  } = await pool.query({
    text: `
      SELECT datname FROM pg_database WHERE datname = $1;
    `,
    values: [`${dbName}-backup`],
  });

  if (backupDBsRows.length < 1) {
    throw new Error(`Database backup with name '${dbName}-backup' does not exist.`);
  }

  // CLOSE ALL CONNECTIONS
  await pool.query({
    text: `
      SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity 
      WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid();
    `,
    values: [dbName],
  });

  if (newDBsRows.length > 0) {
    // DELETE THE NEW DB
    await pool.query({
      text: `
        DROP DATABASE IF EXISTS "${dbName}";
      `,
    });
  }

  // RENAME THE BACKUP BACK
  await pool.query({
    text: `
      ALTER DATABASE "${dbName}-backup" RENAME TO "${dbName}";
    `,
  });
}
