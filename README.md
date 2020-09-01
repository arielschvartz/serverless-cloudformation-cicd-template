# serverless-cf-cicd

## Install

```bash
$ npm install serverless-cf-cicd --save-dev
```

or Yarn:

```bash
$ yarn add -D serverless-cf-cicd 
```

Add the plugin to your `serverless.yml` file:

```yaml
plugins:
  - serverless-cf-cicd
```

## Configure

The configuration of the plugin is done by defining a `custom: cicd` object in your `serverless.yml` with your specific configuration.

Besides that, the plugin needs to use the deploymentBucket that your serverless project uses. For that to work, you need to manually define the deployment bucket name in the provider section!

See the sections below for detailed descriptions of the settings.


PS1: The settings with the (Optional) tags are filled with the default option seend below.
PS2: The ${parent:service-name} is filled with your serverless project name!
PS3: The ${region} is filled with the serverless region in which your serverless project is configured.

```yaml
proivder:
  ...
  deploymentBucket:
    name: MY_DEPLOYMENT_BUCKET_NAME #this is important for the plugin to resolve the deployment bucket name

custom:
  cicd:
    # BITBUCKET VARIABLES
    bitbucketRepository: 'repository' # Name of the bitbucket repository
    bitbucketWorkspace: 'workspace' # Name of the bitbucket workspace
    bitbucketClientId: '1234' # The Bitbucket Client ID. See details on the section Bitbucket Config
    bitbucketSecret: '1234' # The Bitbucket Secret. See details on the section Bitbucket Config
    productionBranchName: 'master' # (Optional) Name of the production branch to which the PRs will be opened

    # AWS ACCOUNTS VARIABLES
    productionAccountId: 12345 # The ID of the AWS production account
    qaAccountId: 12345 # The ID of the AWS testing account

    # QA CONFIGS
    qaStageName: 'qa' # (Optional) Name of the testing stage. Usually 'qa' or 'staging'.
    qaRoleName: '${parent:service-name}-cicd-role' # (Optional) Name of the QA role that will be assumed by the production account.

    # STATE MACHINE CONFIGS
    stateMachineName: '${parent:service-name}-cicd' # (Optional) The base name for the created state machines.
    stateMachineRoleName: '${opt:stateMachineName}-state-machine-role' # (Optional) The name of the state machine role
    stateMachinePolicyMame: '${opt:stateMachineName}-state-machine-policy' # (Optional) The name of the policy for the state machine role.

    # CODEBUILD CONFIGS
    codebuildRoleName: '${parent:service-name}-cicd-codebuild-role' # (Optional) The name of the codebuild role
    codebuildPolicyName: '${parent:service-name}-codebuild-policy' # (Optional) The name of the codebuild policy

    # CLOUDFORMATION CONFIGS
    cloudformationRoleName: '${parent:service-name}-cicd-cloudformation-role' # (Optional) The name of the cloudformation role.
    cloudformationPolicyName: '${parent:service-name}-cloudformation-policy' # (Optional) The name of the cloudformation policy

    # SERVERLESS PROJECT CONFIGURATION
    serverlessBuildPackageQaCommand: 'serverless package --stage ${opt:qaStageName} -v -r ${region}' # (Optional) the command for packaging the serverless project for test stage
    serverlessBuildPackageProductionCommand: 'serverless package --stage production -v -r ${region}' # (Optional)  the command for packaging the serverless project for production stage
    serverlessBuildPackageOutputFolder: '.serverless' # (Optional) The serverless package outpout folder
    serverlessBuildPrebuildCommand: null # (Optional) Command to run before running serverless like installing an specific app on the linux machine.

    # WEBPACK PROJECT CONFIGURATION
    webpackEnabled: false # (Optional) Enable a Webpack specific project (usually for static frontends)
    webpackBuildPackageQaCommand: 'npm run build:qa' # (Optional) Command to build the webpack test package
    webpackBuildPackageProductionCommand: 'npm run build:production' # (Optional) Command to build the webpack production package
    webpackBuildPackageOutputFolder: 'dist' # (Optional) The webpack package output folder
    webpackBuildPrebuildCommand: null # (Optional) Command to run before running webpack like installing an specific app on the linux machine.

    # S3 SYNC CONFIGS
    syncS3Enabled: false # (Optional) Enable the sync of on project folder to an s3 bucket
    syncS3RootFolder: './' # (Optional) The folder to be synced
    syncS3EncodeGzip: true # (Optional) Encode the applicable filed the gzip encoding for faster loading times.
    syncS3Source: 'package' # (Optional) From where to sync the files. Can be 'package' for syncing from the generated package or 'source' for syncing from the source code.
    syncS3Type: 'serverless' # (Optional) If you choose to sync the folder from a package, this can be 'serverless' to sync from the serverless package or 'webpack' to sync from the wepback package.

    # DATABASE
    migrateDatabaseEnabled: true # (Optional) Enable the step to migrate the database
    migrationsFolder: 'migrations' # (Optional) The migrations folder so the pipeline can check if there was changes and a migration will be needed or not
    preMigrateCommand: null # (Optional) Command to run before running the migrations like installing an specific app on the linux machine.
    migrateDatabaseCommand: null # (Optional if migrateDatabaseEnabled is false) The command to migrate the database.
    rdsDatabase: true # (Optional) Indicates if the database is a RDS database so it will be snapshoted before migrate and a rollback will be possible.
    rdsIdentifier: null # (Optional) Indicates the RDS identifier so the correct database is migrated and rolled back!
    rdsDomain: null # (Optional) The domain the points to the database so it can be changed and a snapshot is restored.
    hostedZoneId: null # (Optional) The ID of the hosted-zone so the record sets can be updated. Watch serverless-get-hosted-zone for automating this!

    # NOTIFICATIONS
    discordWebhook: null # (Optional) If you want notifications on discord, place here the webhook URL.
    slackWebhook: null # (Optional) If you want notifications on Slack, place here the webhook URL.
```

## Usage

After configuring the project, you need to create the QA roles, deploy the project and create the bitbucket webhooks.

For creating the QA Roles:

```bash
$ sls cicd:createQARoles --stage $YOUR_TESTING_STAGE --profile $YOUR_AWS_TESTING_ACCOUNT_PROFILE
```

For deploying the project and automatically configuring the bitbucket webhooks after:

```bash
$ sls cicd:deploy --stage $YOUR_PRODUCTION_STAGE --profile $YOUR_AWS_PRODUCTION_ACCOUNT_PROFILE
```

If by some reason there's a problem creating the webhooks, you could just delete them from bitbucket and recreate them with the command:

```bash
$ sls cicd:configureBitbucket --stage $YOUR_PRODUCTION_STAGE --profile $YOUR_AWS_PRODUCTION_ACCOUNT_PROFILE
```

## Configuring Bitbucket

1. Access your workspace page. https://bitbucket.org/${workspace}/.
2. Click Settings.
3. Click OAuth consumers.
4. Add consumer
5. Choose a name and mark the permission "Pull Requests - Write" and save.
6. Get the Key and Secret from the consumer.

You can reuse the same consumer for multiple repositories from the same team!