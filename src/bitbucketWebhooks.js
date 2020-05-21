import AWS from 'aws-sdk';

const s3 = new AWS.S3({ apiVersion: '2006-03-01' });
const codepipeline = new AWS.CodePipeline({ apiVersion: '2015-07-09' });

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
    || (sourceBranchName.startsWith('cicd-'))
  ) {
    return;
  }

  await s3.putObject({
    Bucket: process.env.sourceBucketName,
    Body: JSON.stringify({
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
        }
      }
    }),
    Key: process.env.sourceKey,
  }).promise();

  return codepipeline.startPipelineExecution({
    name: process.env.pipelineName,
  }).promise();
}

export const pullRequestMerged = async (event, context) => {
  const body = JSON.parse(event.body);

  console.log("EVENT", JSON.stringify(body));
  return;
}

export const pullRequestDeclined = async (event, context) => {
  const body = JSON.parse(event.body);

  console.log("EVENT", JSON.stringify(body));
  return;
}