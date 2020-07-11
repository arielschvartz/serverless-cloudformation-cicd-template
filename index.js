'use strict';

const BbPromise = require('bluebird');
const path = require('path');
const fs = require('fs');
const shell = require('shelljs');
const camelCase = require('camelcase');
const { snakeCase } = require('snake-case');
const yaml = require('js-yaml');
const axios = require('axios');

const {
  getBitbucketAccessToken,
  creatHook,
  getHooks,
  downloadSourceCode,
} = require('./lib/bitbucket');

const parameters = {
  'production-branch-name': {
    required: false,
  },
  'bitbucket-repository': {
    required: true,
  },
  'bitbucket-workspace': {
    required: true,
  },
  'bitbucket-client-id': {
    required: true,
  },
  'bitbucket-secret': {
    required: true,
  },
  'production-account-id': {
    required: true,
  },
  'qa-stage-name': {
    required: false,
  },
  'qa-account-id': {
    required: true,
  },
  'qa-role-name': {
    required: false,
  },
  'qa-role-arn': {
    required: false,
  },
  'qa-cloudformation-role-arn': {
    required: false,
  },
  'state-machine-name': {
    required: false,
  },
  'state-machine-role-name': {
    required: false,
  },
  'state-machine-policy-name': {
    required: false,
  },
  'codebuild-role-name': {
    required: false,
  },
  'codebuild-policy-name': {
    required: false,
  },
  // 'cloudformation-enabled': {
  //   required: false,
  // },
  'cloudformation-role-name': {
    required: false,
  },
  'cloudformation-policy-name': {
    required: false,
  },
  'package-bucket-name': {
    required: false,
  },
  'source-bucket-name': {
    required: false,
  },
  'cloudformation-templates-backup-bucket-name': {
    required: false,
  },
  'serverless-enabled': {
    required: false,
  },
  'serverless-build-package-qa-command': {
    required: false,
  },
  'serverless-build-package-production-command': {
    required: false,
  },
  'serverless-build-package-output-folder': {
    required: false,
  },
  'serverless-build-prebuild-command': {
    required: false,
  },
  'webpack-enabled': {
    required: false,
  },
  'webpack-build-package-qa-command': {
    required: false,
  },
  'webpack-build-package-production-command': {
    required: false,
  },
  'webpack-build-package-output-folder': {
    required: false,
  },
  'webpack-build-prebuild-command': {
    required: false,
  },
  'sync-s3-enabled': {
    required: false,
  },
  'sync-s3-root-folder': {
    required: false,
  },
  'sync-s3-encode-gzip': {
    required: false,
  },
  'sync-s3-bucket-name': {
    required: false,
  },
  'sync-s3-source': {
    required: false,
  },
  'migrate-database-enabled': {
    required: false,
  },
  'migrations-folder': {
    required: false,
  },
  'migrate-install-extra': {
    required: false,
  },
  'migrate-database-command': {
    required: false,
  },
  'rds-database': {
    required: false,
  },
  'rds-domain': {
    required: false,
  },
  'hosted-zone': {
    required: false,
  },
  'hosted-zone-id': {
    required: false,
  },
  'validate-enabled': {
    required: false,
  },
  'discord-webhook': {
    required: false,
  },
  'slack-webhook': {
    required: false,
  },
  'pull-request-enabled': {
    required: false,
  },
  'notify-topic-name': {
    required: false,
  },
  'pull-request-topic-name': {
    required: false,
  }
};

class ServerlessCloudfrontCICDTemplate {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};

    this.commands = {
      'cicd:configureBitbucket': {
        usage: 'Create bitbucket webhooks to integrate with the code pipeline.',
        lifecycleEvents: [
          'configure',
        ]
      },
      'cicd:createQARoles': {
        usage: 'Create a Role in the QA environment to be assumed by the pipeline during the CI / CD process.',
        lifecycleEvents: [
          'create',
        ]
      },
      'cicd:package': {
        usage: 'Package the CI/CD project creating the final cloudformation template json and lambda functions zip files.',
        lifecycleEvents: [
          'package'
        ],
      },
      'cicd:deploy': {
        usage: 'Package the CI/CD project and deploys it to AWS creating the pipelines.',
        lifecycleEvents: [
          'deploy',
        ]
      }
    };

    this.hooks = {
      // this is where we declare the hook we want our code to run
      'before:cicd:createQARoles:create': () => BbPromise.bind(this).then(this.setCurrentDir),
      'after:cicd:createQARoles:create': () => BbPromise.bind(this).then(this.createQARoles),
      'before:cicd:package:package': () => BbPromise.bind(this).then(this.setCurrentDir),
      'after:cicd:package:package': () => BbPromise.bind(this).then(this.package),
      'before:cicd:deploy:deploy': () => BbPromise.bind(this).then(this.setCurrentDir),
      'after:cicd:deploy:deploy': () => BbPromise.bind(this).then(this.deploy),
      'after:cicd:configureBitbucket:configure': () => BbPromise.bind(this).then(this.createBitbucketWebhooks),
    }

    // bindings
    this.log = this.log.bind(this)
  }

  log(msg) {
    this.serverless.cli.log(msg)
  }

  get awsCredentials() {
    return {
      ...this.serverless.providers.aws.getCredentials(),
      region: this.awsRegion,
    }
  }

  get awsRegion() {
    return this.serverless.providers.aws.getRegion();
  }

  get awsProfile() {
    return this.serverless.providers.aws.getProfile();
  }

  get cloudformation() {
    if (!this._cloudformation) {
      this._cloudformation = new this.serverless.providers.aws.sdk.CloudFormation({
        ...this.awsCredentials,
        apiVersion: '2010-05-15',
      });
    }

    return this._cloudformation;
  }

  async setCurrentDir() {
    this._currentDir = process.cwd();
  }

  get currentDir() {
    return this._currentDir;
  }

  async info({ cicdConfiguration = false } = {}) {
    if (cicdConfiguration) {
      shell.cd(__dirname);
    } else {
      shell.cd(this.currentDir);
    }

    const command = 'sls print --format yaml ' + this.cliOpts;
    let { stdout: info } = shell.exec(command, { silent: true });
    return yaml.safeLoad('service:' + info.split('service:').slice(1).join('service:'), { indent: 2 });
  }

  async describeStack({ cicdConfiguration = false } = {}) {
    const info = await this.info({ cicdConfiguration });

    let stackName;
    if (cicdConfiguration) {
      ({
        provider: {
          stackName,
        }
      } = info);
    } else {
      ({
        custom: {
          cloudformation: {
            stackName,
          }
        }
      } = info);
    }

    try {
      const {
        Stacks: [stack]
      } = await this.cloudformation.describeStacks({
        StackName: stackName,
      }).promise();

      return stack;
    } catch (error) {
      if (error.message !== `Stack with id ${stackName} does not exist`) {
        throw error;
      }
      return {};
    }
  }

  get cliOpts() {
    const opts = Object.entries(this.serverless.pluginManager.cliOptions).filter(([key, value]) => (
      value
    )).map(([key, value]) => {
      return `--${key} ${value}`
    });

    if (!this.serverless.pluginManager.cliOptions.region) {
      opts.push(`--region ${this.awsRegion}`);
    }

    if (!this.serverless.pluginManager.cliOptions.profile) {
      opts.push(`--profile ${this.awsProfile}`);
    }

    opts.push(`--parent-project-name ${this.serverless.service.service}`);

    if (this.serverless.service.custom.cicd == null) {
      throw new Error('You must set the cicd configuration on the serverless.yml');
    }
    for (const [key, { required }] of Object.entries(parameters)) {
      const configValue = this.serverless.service.custom.cicd[camelCase(key)];
      if (configValue != null && configValue !== '') {
        if (typeof configValue === 'string' && configValue.includes(' ')) {
          opts.push(`--${key} "${configValue.replace("\n", ";")}"`);
        } else {
          opts.push(`--${key} ${configValue}`);
        }
      } else if (required) {
        throw new Error(`The ${camelCase(key)} config parameter is required.`)
      }
    }

    return opts.join(' ')
  }

  async createQARoles() {
    const info = await this.info({ cicdConfiguration: true });

    const {
      service,
      custom: {
        production: {
          accountId: productionAccountId,
        },
        qa: {
          stackName,
          roleName,
        },
        cloudformation: {
          roleName: cfRoleName,
        },
        bucket: {
          artifacts: artifactsBucketName,
        },
      },
    } = info;

    let opts = {
      StackName: stackName,
      Capabilities: ['CAPABILITY_NAMED_IAM'],
      Parameters: [
        {
          ParameterKey: 'ProductionAccountId',
          ParameterValue: `${productionAccountId}`,
        },
        {
          ParameterKey: 'ArtifactBucketName',
          ParameterValue: `${artifactsBucketName}`,
        },
        {
          ParameterKey: 'RoleName',
          ParameterValue: `${roleName}`,
        },
        {
          ParameterKey: 'CloudformationRoleName',
          ParameterValue: `${cfRoleName}`,
        },
      ],
      TemplateBody: JSON.stringify(yaml.safeLoad(fs.readFileSync(path.resolve(__dirname, './resources/QATemplate.yml'), 'utf-8'))),
    };

    let stackId;
    try {
      ({
        Stacks: [
          {
            StackId: stackId,
          } = {}
        ]
      } = await this.cloudformation.describeStacks({
        StackName: stackName,
      }).promise());
    } catch (error) {
      if (error.message !== `Stack with id ${stackName} does not exist`) {
        throw error;
      }
    }

    try {
      if (stackId) {
        await this.cloudformation.updateStack(opts).promise();
        await this.cloudformation.waitFor('stackUpdateComplete', {
          StackName: stackName,
        }).promise()
      } else {
        await this.cloudformation.createStack({
          OnFailure: 'DELETE',
          ...opts
        }).promise();
        await this.cloudformation.waitFor('stackCreateComplete', {
          StackName: stackName,
        }).promise()
      }
    } catch (error) {
      if (error.message !== 'No updates are to be performed.') {
        throw error;
      }
    }

    const {
      StackResources: resources,
    } = await this.cloudformation.describeStackResources({
      StackName: stackName,
    }).promise();
    return resources;
  }

  async package() {
    shell.cd(__dirname);
    const command = 'sls package ' + this.cliOpts;
    const {
      code,
    } = shell.exec(command);
  }

  async deploy() {
    shell.cd(__dirname);
    const command = 'sls deploy ' + this.cliOpts;
    const {
      code,
    } = shell.exec(command);

    if (code === 0) {
      await this.createBitbucketWebhooks();
    }
  }

  async createBitbucketWebhooks() {
    shell.cd(__dirname);
    const {
      Outputs: stackOutputs,
    } = await this.describeStack({ cicdConfiguration: true });

    const {
      OutputValue: serviceEndpoint,
    } = stackOutputs.find((o) => o.OutputKey === 'ServiceEndpoint') || {};

    const {
      custom: {
        bitbucket: {
          clientId,
          secret: clientSecret,
          workspace,
          repository,
        }
      },
      functions,
    } = await this.info({ cicdConfiguration: true });

    try {
      const accessToken = await getBitbucketAccessToken({
        clientId,
        clientSecret,
      });

      const hooks = await getHooks({
        accessToken,
        workspace,
        repository,
      });

      const webhooks = [
        {
          description: 'CICD PullRequest Approved',
          events: ['pullrequest:approved'],
          functionName: 'PRApproved',
        },
        {
          description: 'CICD PullRequest Merged/Declined',
          events: ['pullrequest:fulfilled', 'pullrequest:rejected'],
          functionName: 'PRMergedOrDeclined',
        },
      ];

      for (const { description, functionName, events } of webhooks) {
        if (!hooks.find(({ description: desc }) => desc === description)) {
          this.log(`Creating webhook on Bitbucket: ${description}`);
          const httpEvent = functions[functionName].events.find(obj => obj.http);
          await creatHook({
            accessToken,
            workspace,
            repository,
            description,
            url: `${serviceEndpoint}/${httpEvent.http.path}`,
            events,
          });
        }
      }
    } catch (error) {
      console.log("ERROR", error)
    }
  }
}

module.exports = ServerlessCloudfrontCICDTemplate;