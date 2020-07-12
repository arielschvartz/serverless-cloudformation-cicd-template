import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

import {
  notify,
  isTruthy,
} from './utils';

const stepfunctions = new AWS.StepFunctions({ apiVersion: '2016-11-23' });

export const pullRequestApproved = async (event, context) => {
  const body = JSON.parse(event.body);

  const {
    approval: {
      user: {
        display_name: approvalAuthorDisplayName,
        nickname: approvalAuthorNickname,
      },
    },
    pullrequest: {
      id: pullRequestId,
      title,
      description,
      destination: {
        repository: {
          name: destinationRepositoryName,
          full_name: destinationRepositoryFullName,
        },
        branch: {
          name: destinationBranchName,
        }
      },
      source: {
        repository: {
          name: sourceRepositoryName,
          full_name: sourceRepositoryFullName,
        },
        branch: {
          name: sourceBranchName,
        }
      },
      created_on: createdAt,
      author: {
        display_name: authorDisplayName,
        nickname: authorNickname,
      }
    }
  } = body;

  // CHECK IF IS APPROVED FROM A BRANCH TO THE DESTINATION BRANCH AND IS NOT A TEMPORARY BRANCH CREATED BY THE PIPELINE
  if (
    (destinationBranchName !== process.env.destinationBranchName)
    || (sourceBranchName.startsWith(process.env.branchPrefix))
  ) {
    return {
      status: 200,
      body: 'CI/CD did not start. If it should have started, check if you are opening the PR from and to the right branches',
    }
  }

  try {
    await stepfunctions.startExecution({
      stateMachineArn: process.env.stateMachineArn,
      input: JSON.stringify({
        isServerless: isTruthy(process.env.serverlessEnabled),
        isWebpack: isTruthy(process.env.webpackEnabled),
        s3Options: {
          enabled: isTruthy(process.env.syncS3Enabled),
        },
        databaseOptions: {
          migrateEnabled: isTruthy(process.env.migrateEnabled),
          isRDS: isTruthy(process.env.isRDS),
          migrationsChanged: false,
        },
        bitbucket: {
          approver: {
            displayName: approvalAuthorDisplayName,
            nickname: approvalAuthorNickname,
          },
          author: {
            displayName: authorDisplayName,
            nickname: authorNickname,
          },
          pullrequest: {
            id: pullRequestId,
            title,
            description,
            createdAt,
          },
          source: {
            name: sourceBranchName,
            repository: {
              name: sourceRepositoryName,
              fullName: sourceRepositoryFullName,
            }
          },
          destination: {
            name: destinationBranchName,
            repository: {
              name: destinationRepositoryName,
              fullName: destinationRepositoryFullName,
            },
          },
        },
      }),
      name: `${sourceBranchName.substring(0, 40)}-${uuidv4()}`,
    }).promise();

    return {
      status: 200,
      body: 'CI/CD Workflow successfully started.',
    }
  } catch (error) {
    return {
      status: 500,
      body: `CI/CD Workflow did not start. ${error}`,
    }
  }
}

export const pullRequestMergedOrDeclined = async (event, context) => {
  console.log("EVENT", event);

  try {
    const {
      headers: {
        'X-Event-Key': eventKey,
      },
    } = event;

    const body = JSON.parse(event.body);

    const {
      pullrequest: {
        description,
        destination: {
          branch: {
            name: destinationBranchName,
          }
        },
        source: {
          branch: {
            name: sourceBranchName,
          }
        },
      }
    } = body;

    if (
      (destinationBranchName !== process.env.destinationBranchName)
      || (!sourceBranchName.startsWith(process.env.branchPrefix))
    ) {
      return {
        status: 200,
        body: 'The merged PR does not follow the patterns of a running CI/CD execution.',
      }
    }

    const {
      taskToken,
      executionURL,
    } = JSON.parse(description);

    if (eventKey === 'pullrequest:rejected') {
      await stepfunctions.sendTaskFailure({
        taskToken,
        error: 'PullRequestRejected',
        cause: 'The Pull Request was rejected.',
      }).promise();

      await notify({
        title: `${process.env.bitbucketWorkspace}/${process.env.bitbucketRepository} - CI/CD Code Rejected!`,
        text: `The PR was declined! The CI/CD will start the rollback now.\nThis CI/CD execution can be found at ${executionURL}`,
        status: 'error',
      });
    } else if (eventKey === 'pullrequest:fulfilled') {
      await stepfunctions.sendTaskSuccess({
        taskToken,
        output: JSON.stringify({
          action: 'pullrequest:fulfilled'
        }),
      }).promise();

      await notify({
        title: `${process.env.bitbucketWorkspace}/${process.env.bitbucketRepository} - CI/CD Code Approved!`,
        text: `The PR was approved and the new code is being deployed to production now!\nThis CI/CD execution can be found at ${executionURL}`,
        status: 'success',
      });
    } else {
      return {
        status: 200,
        body: `The X-Event-Key ${eventKey} is not a valid one.`
      }
    }

    return {
      status: 200,
      body: 'Successfully notified the step function.'
    }
  } catch (error) {
    console.log("ERROR", error);
    throw error;
  }
}