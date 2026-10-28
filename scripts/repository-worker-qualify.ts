import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {inspectRepository,buildRepository,stopRepositoryPreview} from '../engine/repository-worker.js';
const exec=promisify(execFile);
const out=resolve('.passage/repository-worker/cases'); await mkdir(out,{recursive:true});
const cases=[
  {id:'todomvc-react',root:resolve('../artifacts/passage-external-todomvc'),repositoryUrl:'https://github.com/tastejs/todomvc',
    prefix:['examples/react/src'],entryPoint:'examples/react/src/index.js',rootElementClass:'todoapp'},
  {id:'react-modal-forms',root:resolve('../artifacts/passage-external-react-modal'),repositoryUrl:'https://github.com/reactjs/react-modal',
    prefix:['src','examples/basic/forms','examples/base.css','examples/basic/app.css'],entryPoint:'examples/basic/forms/index.js',rootElementClass:'padbox',
    moduleAliases:{'react-modal':'src/index.js'},
    bootstrap:{description:'Mount the unmodified upstream Forms example under React19 createRoot; retain upstream Modal.setAppElement behavior. Other upstream examples and legacy ReactDOM.render entry are not executed.',
      source:`import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport Modal from './source/src/index.js';\nimport example from './source/examples/basic/forms/index.js';\nimport './source/examples/base.css';\nimport './source/examples/basic/app.css';\nModal.setAppElement('#root');\ncreateRoot(document.getElementById('root')).render(React.createElement(example.app));`}},
];
for(const c of cases){
  const revision=(await exec('git',['-C',c.root,'rev-parse','HEAD'])).stdout.trim();
  const sourcePaths=(await exec('git',['-C',c.root,'ls-tree','-r','--name-only',revision,'--',...c.prefix])).stdout.trim().split('\n').filter(x=>/\.(?:[cm]?[jt]sx?|css|json)$/.test(x));
  const snapshot=await inspectRepository({rootPath:c.root,repositoryUrl:c.repositoryUrl,revision,sourcePaths,entryPoint:c.entryPoint,
    rootElementClass:c.rootElementClass,bootstrap:c.bootstrap,moduleAliases:c.moduleAliases});
  await writeFile(join(out,`${c.id}.snapshot.json`),JSON.stringify(snapshot,null,2));
  const receipt=await buildRepository({snapshot}); await writeFile(join(out,`${c.id}.build.json`),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({case:c.id,sourceFileCount:snapshot.files.length,...receipt}));
}
if(process.argv.includes('--serve')) {
  process.on('SIGTERM',async()=>{await stopRepositoryPreview();process.exit(0);});
  process.on('SIGINT',async()=>{await stopRepositoryPreview();process.exit(0);});
} else await stopRepositoryPreview();
