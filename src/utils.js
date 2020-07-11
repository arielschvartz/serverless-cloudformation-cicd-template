import axios from 'axios';
import AWS from 'aws-sdk';

const sts = new AWS.STS({ apiVersion: '2011-06-15' });

export const assumeQARole = async (sessionName = 'cicd-session') => {
  const {
    Credentials: {
      AccessKeyId: accessKeyId,
      SecretAccessKey: secretAccessKey,
      SessionToken: sessionToken,
    }
  } = await sts.assumeRole({
    RoleSessionName: sessionName,
    RoleArn: process.env.QA_ROLE_ARN,
  }).promise();

  return new AWS.Credentials({
    accessKeyId,
    secretAccessKey,
    sessionToken,
  });
}

const getColorFromStatus = (status) => {
  switch (status) {
    case 'success':
      return '#01AB53';
    case 'failure':
    case 'error':
      return '#E30425';
    default:
      return '#E0E0E0';
  }
}

const notifySlack = async ({ author, title, text, status }) => {
  return axios.post(process.env.slackWebhookUrl, {
    attachments: [{
      color: getColorFromStatus(status),
      blocks: [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: title,
        }
      },{
        type: 'divider',
      },{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        }
      }]
    }]
  });
}

const notifyDiscord = async ({ author, title, text, status }) => {
  return axios.post(`${process.env.slackWebhookUrl}?wait=true`, {
    embeds: [{
      title,
      description: text,
      color: getColorFromStatus(status),
      author,
    }]
  })
}

export const notify = async (params) => {
  const finalParams = Object.assign({
    author: 'CI/CD',
  }, params);

  if (process.env.discordWebhookUrl && process.env.discordWebhookUrl !== '') {
    try {
      await notifyDiscord(finalParams);
    } catch (error) {
      console.log("DISCORD NOTIFICATION FAILED", error);
    }
  }

  if (process.env.slackWebhookUrl && process.env.slackWebhookUrl !== '') {
    try {
      await notifySlack(finalParams);
    } catch (error) {
      console.log("SLACK NOTIFICATION FAILED", error);
    }
  }
}

export const isTruthy = (value) => {
  ['true', 't', true, 1, '1'].indexOf(value) > -1
}