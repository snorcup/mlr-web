import {readdirSync, statSync} from 'node:fs';
for (const path of ['index.html','js/app.js','css/style.css','Dockerfile','docker-compose.yml']) {
  if (!statSync(path).isFile()) throw new Error(`missing ${path}`);
}
console.log('build check ok');
