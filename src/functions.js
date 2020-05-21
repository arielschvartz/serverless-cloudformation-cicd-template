import axios from 'axios';
import AWS from 'aws-sdk';

const codepipeline = new AWS.CodePipeline({
  apiVersion: '2015-07-09',
});

export const saveCFTemplate = async (event, context) => {
  const {
    'CodePipeline.job': {
      id: jobId,
      data: {
        inputArtifacts,
        artifactCredentials: {
          secretAccessKey,
          sessionToken,
          accessKeyId,
        },
      }
    }
  } = event;

  try {
    const s3 = new AWS.S3({
      apiVersion: '2006-03-01',
      accessKeyId,
      secretAccessKey,
      sessionToken,
    });

    for (const artifact of inputArtifacts) {
      const {
        location: {
          s3Location: {
            bucketName: inputBucketName,
            objectKey: inputObjectKey,
          },
        },
        name,
      } = artifact;

      await s3.copyObject({
        Bucket: process.env.bucketName, 
        CopySource: `/${inputBucketName}/${inputObjectKey}`, 
        Key: name,
        MetadataDirective: 'REPLACE'
      }).promise();
    }


    await codepipeline.putJobSuccessResult({
      jobId,
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

export const notifyForValidation = (event, context) => {
  
}

export const openPullRequest = (event, context) => {
  
}

export const notifySuccess = (event, context) => {
  
}