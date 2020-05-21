const queryString = require('query-string');

const r = queryString.stringifyUrl({
  url: 'https://www.lawgile.com.br',
  query: {
    q: 'name ~ "cicd/LAW-372-permitir-deletar-uma-task"'
  }
});

console.log(r);
