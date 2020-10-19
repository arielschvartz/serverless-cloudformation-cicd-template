import AWS from 'aws-sdk';
import extract from 'extract-zip';
import { execSync } from 'child_process';
import fs from 'fs';

import {
  StackDoesNotExistError,
  StackStillNotReady,
  StackCreateError,
} from './errors';

import {
  assumeQARole,
} from './utils';

const getCredentials = async (event) => {
  const {
    Payload: {
      environment,
    }
  } = event;

  if (environment === 'qa') {
    return { credentials: await assumeQARole() }
  } else {
    return {};
  }
}

const getS3Instance = async (event) => {
  return new AWS.S3(
    Object.assign({ apiVersion: '2006-03-01' }, await getCredentials(event))
  )
}

const getCFInstance = async (event) => {
  return new AWS.CloudFormation(
    Object.assign({ apiVersion: '2010-05-15' }, await getCredentials(event))
  );
}

const getRole = (event) => {
  const {
    Payload: {
      environment,
    }
  } = event;

  if (environment === 'qa') {
    return process.env.CF_QA_ROLE_ARN;
  } else {
    return process.env.CF_PRODUCTION_ROLE_ARN;
  }
}

export const checkIfCFStackExists = async (event, context) => {
  const {
    Payload: {
      package: {
        stackName,
      },
    }
  } = event;

  const cloudformation = await getCFInstance(event);

  let stack;
  try {
    ({
      Stacks: [stack] = [],
    } = await cloudformation.describeStacks({
      StackName: stackName,
    }).promise());
  } catch (e) {
    console.log("ERROR", e);
    if (e.message === `Stack with id ${stackName} does not exist`) {
      throw new StackDoesNotExistError();
    } else {
      throw e;
    }
  }

  if (!stack) {
    throw new StackDoesNotExistError();
  }
}

export const createBaseTemplate = async (event, context) => {
  const {
    Payload: {
      package: {
        stackName,
        deploymentBucket,
      },
    }
  } = event;

  const roleArn = getRole(event);

  const cloudformation = await getCFInstance(event);

  await cloudformation.createStack({
    StackName: stackName,
    Capabilities: [
      'CAPABILITY_IAM',
      'CAPABILITY_NAMED_IAM',
      'CAPABILITY_AUTO_EXPAND',
    ],
    RoleARN: roleArn,
    TemplateBody: process.env.TEMPLATE,
    OnFailure: 'DELETE',
    Parameters: [
      {
        ParameterKey: 'DeploymentBucketName',
        ParameterValue: deploymentBucket,
      },
      {
        ParameterKey: 'RoleArn',
        ParameterValue: roleArn,
      }
    ]
  }).promise();
}

export const updateCFTemplate = async (event, context) => {
  const {
    Payload: {
      package: {
        package: {
          Location: location,
        },
        stackName,
        deploymentBucket,
      },
    }
  } = event;

  const roleArn = getRole(event);

  // INSTANCE FOR DOWNLOADING THE ARTIFACT
  const s3 = new AWS.S3({ apiVersion: '2006-03-01' })

  const bucketName = location.split('/')[0].split(':::')[1];
  const key = `${location.split('/').slice(1).join('/')}`;

  const {
    Body: file,
  } = await s3.getObject({
    Bucket: bucketName,
    Key: key,
  }).promise();

  const extractFolder = '/tmp/artifact';
  execSync(`rm -rf ${extractFolder} && mkdir -p ${extractFolder}`);

  await fs.writeFileSync(`${extractFolder}.zip`, file);
  await extract(`${extractFolder}.zip`, { dir: extractFolder });

  const templateBody = fs.readFileSync(`${extractFolder}/cloudformation-template-update-stack.json`, 'utf8');
  const templateKey = `${key.split("/").slice(0, -1).join("/")}/template.json`;

  await s3.putObject({
    Body: templateBody,
    Bucket: bucketName,
    Key: templateKey,
  }).promise();

  const cloudformation = await getCFInstance(event);
  await cloudformation.updateStack({
    StackName: stackName,
    Capabilities: [
      'CAPABILITY_IAM',
      'CAPABILITY_NAMED_IAM',
      'CAPABILITY_AUTO_EXPAND',
    ],
    RoleARN: roleArn,
    TemplateURL: `https://${bucketName}.s3.amazonaws.com/${templateKey}`
  }).promise();
}

export const isStackReady = async (event, context) => {
  const {
    Payload: {
      package: {
        stackName,
      },
    }
  } = event;

  const cloudformation = await getCFInstance(event);

  let stack;
  try {
    ({
      Stacks: [stack],
    } = await cloudformation.describeStacks({
      StackName: stackName,
    }).promise());
  } catch (e) {
    console.log("ERROR", e);
    throw new StackDoesNotExistError();
  }

  if (!stack) {
    throw new StackDoesNotExistError();
  }

  const {
    StackStatus: status,
  } = stack;

  const progressStatuses = ['CREATE_IN_PROGRESS', 'UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'];

  const doneStatuses = ['CREATE_COMPLETE', 'UPDATE_COMPLETE'];

  if (progressStatuses.indexOf(status) > -1) {
    throw new StackStillNotReady();
  } else if (doneStatuses.indexOf(status) === -1) {
    throw new StackCreateError(status);
  }
}

export const success = async (event, context) => {

}
