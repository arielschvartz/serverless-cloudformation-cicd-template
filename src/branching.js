import axios from 'axios';
import path from 'path';
import fs from 'fs';
import AWS from 'aws-sdk';

import {
  getBitbucketAccessToken,
  getBranchesWithName,
  createBranch,
  openPullRequest,
  declinePullRequest,
  mergePullRequest,
  downloadSourceCode,
} from '../lib/bitbucket';

const codepipeline = new AWS.CodePipeline({
  apiVersion: '2015-07-09',
});

// REFERENCE OF THE EVENT https://docs.aws.amazon.com/codepipeline/latest/userguide/action-reference-Lambda.html
export const openNewBranch = async (event, context) => {
  let jobId;

  try {
    ({
      'CodePipeline.job': {
        id: jobId,
      },
    } = event);

    const {
      'CodePipeline.job': {
        data: {
          inputArtifacts: [{
            location: {
              s3Location: {
                bucketName: inputBucketName,
                objectKey: inputObjectKey,
              },
            },
          }],
          outputArtifacts: [{
            location: {
              s3Location: {
                bucketName: outputBucketName,
                objectKey: outputObjectKey,
              }
            }
          }],
          artifactCredentials: {
            secretAccessKey,
            sessionToken,
            accessKeyId,
          },
        }
      }
    } = event;

    console.log("DESTRUCTURED EVENT");

    const s3 = new AWS.S3({
      apiVersion: '2006-03-01',
      accessKeyId,
      secretAccessKey,
      sessionToken,
    });

    console.log("INSTANTIATED S3");

    // GET AND PARSE THE INPUT OBJECT
    const {
      Body: body,
    } = await s3.getObject({
      Bucket: inputBucketName,
      Key: inputObjectKey,
    }).promise();

    console.log("GOT OBJECT", body);

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
    } = JSON.parse(body);

    const bitbucketAccessToken = await getBitbucketAccessToken({
      clientId: process.env.bitbucketClientId,
      clientSecret: process.env.bitbucketSecret,
    });

    console.log("GOT ACCESS TOKEN")

    let tempBranchName = `cicd/${sourceBranchName}`

    // GET THE NUMBER OF BRANCHES WITH THIS NAME TO ADD VERSION
    const numberOfBranchesWithThisName = await getBranchesWithName({
      accessToken: bitbucketAccessToken,
      workspace: process.env.bitbucketWorkspace,
      repository: process.env.bitbucketRepository,
      branchName: sourceBranchName.substring(0, 30),
    });

    if (numberOfBranchesWithThisName > 1) {
      tempBranchName = `cicd/${numberOfBranchesWithThisName - 1}-${sourceBranchName}`;
    }

    tempBranchName = tempBranchName.substring(0, 40);

    console.log("BRANCH NAME", tempBranchName);

    // 1. CREATE A NEW BRANCH
    await createBranch({
      accessToken: bitbucketAccessToken,
      workspace: process.env.bitbucketWorkspace,
      repository: process.env.bitbucketRepository,
      newBranchName: tempBranchName,
      destinationBranchName,
    });

    console.log("CREATED BRANCH")

    // 2. OPEN A PULL REQUEST AND MERGE IT (SINCE IT'S NOT POSSIBLE TO SIMPLY MERGE BRANCHES THROUGH BITBUCKET API)
    const {
      data,
      data: {
        id: pullRequestId,
      },
    } = await openPullRequest({
      accessToken: bitbucketAccessToken,
      workspace: process.env.bitbucketWorkspace,
      repository: process.env.bitbucketRepository,
      title,
      description,
      sourceBranchName,
      destinationBranchName: tempBranchName,
    });

    console.log("OPENED PULL REQUEST");

    await mergePullRequest({
      accessToken: bitbucketAccessToken,
      workspace: process.env.bitbucketWorkspace,
      repository: process.env.bitbucketRepository,
      pullRequestId,
    });

    console.log("MERGED PULL REQUEST");

    // 3. CLOSE THE ORIGINAL PR
    try {
      await declinePullRequest({
        accessToken: bitbucketAccessToken,
        workspace: process.env.bitbucketWorkspace,
        repository: process.env.bitbucketRepository,
        pullRequestId: originalPullRequestId,
        reason: 'Automatic Delcine from the CI/CD pipeline.',
      })
    } catch (error) {
      console.log("COULD NOT CLOSE THE ORIGINAL PULL REQUEST, MAYBE IT WAS ALREADY CLOSED");
    }

    // 4. DOWNLOAD SOURCE CODE
    const filePath = '/tmp/code.zip';

    console.log("workspace", process.env.bitbucketWorkspace);
    console.log("repository", process.env.bitbucketRepository);
    console.log("branchName", tempBranchName);

    let downloaded = false;
    let downloadAttempts = 0;
    while (!downloaded) {
      downloadAttempts += 1;
      try {
        await downloadSourceCode({
          accessToken: bitbucketAccessToken,
          workspace: process.env.bitbucketWorkspace,
          repository: process.env.bitbucketRepository,
          branchName: tempBranchName,
          file: filePath,
        });

        downloaded = true;
        console.log("DOWNLOADED SOURCE");
      } catch (error) {
        console.log("FAILED TO DOWNLOAD SOURCE");
        if (downloadAttempts === 5) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }


    // 5. SAVE THE CODE AS THE OUTPUT ARTIFACT
    await s3.putObject({
      Bucket: outputBucketName,
      Key: outputObjectKey,
      Body: fs.createReadStream(filePath),
    }).promise();

    console.log("SAVED SOURCE TO S3");

    await codepipeline.putJobSuccessResult({
      jobId,
      outputVariables: {
        BRANCH_NAME: tempBranchName,
      }
    }).promise();
  } catch (error) {
    console.log("ERROR", error);

    if (jobId) {
      await codepipeline.putJobFailureResult({
        failureDetails: {
          message: error.message,
          type: 'JobFailed',
        },
        jobId,
      }).promise();
    } else {
      throw error;
    }
  }
}