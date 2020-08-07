import axios from 'axios';
import AWS from 'aws-sdk';

const sts = new AWS.STS({ apiVersion: '2011-06-15' });

const discordColors = {
  DEFAULT: 0,
  AQUA: 1752220,
  GREEN: 3066993,
  BLUE: 3447003,
  PURPLE: 10181046,
  GOLD: 15844367,
  ORANGE: 15105570,
  RED: 15158332,
  GREY: 9807270,
  DARKER_GREY: 8359053,
  NAVY: 3426654,
  DARK_AQUA: 1146986,
  DARK_GREEN: 2067276,
  DARK_BLUE: 2123412,
  DARK_PURPLE: 7419530,
  DARK_GOLD: 12745742,
  DARK_ORANGE: 11027200,
  DARK_RED: 10038562,
  DARK_GREY: 9936031,
  LIGHT_GREY: 12370112,
  DARK_NAVY: 2899536,
  LUMINOUS_VIVID_PINK: 16580705,
  DARK_VIVID_PINK: 12320855,
}

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

const getDiscordColorFromStatus = (status) => {
  switch (status) {
    case 'success':
      return discordColors['GREEN'];
    case 'failure':
    case 'error':
      return discordColors['RED'];
    default:
      return discordColors['DEFAULT'];
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
  return axios.post(`${process.env.discordWebhookUrl}?wait=true`, {
    embeds: [{
      title,
      type: 'rich',
      description: text,
      color: getDiscordColorFromStatus(status),
      author: {
        name: author,
      },
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
  return ['true', 't', true, 1, '1'].indexOf(value) > -1
}