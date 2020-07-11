import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';

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

export const rollbackDatabase = async (event, context) => {
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
      DBInstanceIdentifier: old ? getOldInstanceName(rdsIdentifier) : getRollbackInstanceName(rdsIdentifier),
    }).promise());
  } catch (error) {
    if (old && error.code === 'DBInstanceNotFound') {
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