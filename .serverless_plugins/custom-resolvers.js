const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class ParentServiceNameResolver {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.service = this.serverless.service;

    this.parentServiceNameResolver = this.parentServiceNameResolver.bind(this)
    this.escapedFileToStringResolver = this.escapedFileToStringResolver.bind(this)
    this.fileToStringResolver = this.fileToStringResolver.bind(this)

    this.variableResolvers = {
      parent: this.parentServiceNameResolver,
      escapedFileToString: this.escapedFileToStringResolver,
      fileToString: this.fileToStringResolver,
    }
  }

  async parentServiceNameResolver(src) {
    const name = src.slice(7);

    if (name === 'service-name') {
      return this.serverless.pluginManager.cliOptions['parent-project-name']
    }

    throw `Cannot resolve ${src}`
  }

  async escapedFileToStringResolver(src) {
    const name = src.slice(20);

    let content = await this.fileToStringResolver(`fileToString:${name}`);
    content = content.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
    return content;
  }

  async fileToStringResolver(src) {
    const p = src.slice(13)
    const extension = src.split('.').pop();

    let data;
    if (['yml', 'yaml'].indexOf(extension) > -1) {
      const fileRef = this.serverless.variables.fileRefSyntax;
      const { resolver } = this.serverless.variables.variableResolvers.find(r => r.regex === fileRef);

      data = await resolver(`file(${p})`);
      data = JSON.stringify(data);
    } else {
      data = fs.readFileSync(path.resolve(__dirname, '..', p), 'utf-8');
    }

    data = data.replace(/\n/g, '')

    return data
  }
}

module.exports = ParentServiceNameResolver;