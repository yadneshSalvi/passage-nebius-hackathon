import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { repositorySnapshotSchema } from '../server/repository-journey-routes.js';
import { inspectRepository, applyRepositoryPatch, validateRepositorySnapshot, buildRepository, type RepositorySnapshot } from '../engine/repository-worker.js';
const exec=promisify(execFile);
let root:string, revision:string, snapshot:RepositorySnapshot;
const remote='https://github.com/example/independent-app';
beforeAll(async()=>{
  root=await mkdtemp(join(tmpdir(),'passage-source-test-'));
  await exec('git',['init',root]);
  await exec('git',['-C',root,'remote','add','origin',remote]);
  await writeFile(join(root,'app.jsx'),'export default function App(){return <button>Continue</button>}');
  await symlink('/etc/passwd',join(root,'linked.js'));
  await exec('git',['-C',root,'add','app.jsx','linked.js']);
  await exec('git',['-C',root,'-c','user.name=Passage test','-c','user.email=test@example.invalid','commit','-m','Independent source fixture']);
  revision=(await exec('git',['-C',root,'rev-parse','HEAD'])).stdout.trim();
  snapshot=await inspectRepository({rootPath:root,repositoryUrl:remote,revision,sourcePaths:['app.jsx'],entryPoint:'app.jsx'});
});
afterAll(async()=>{await rm(root,{recursive:true,force:true});});
describe('isolated repository admission',()=>{
  it('reads the immutable Git blob rather than mutable working-tree bytes',async()=>{
    await writeFile(join(root,'app.jsx'),'uncommitted material must not enter a pinned snapshot');
    const again=await inspectRepository({rootPath:root,repositoryUrl:remote,revision,sourcePaths:['app.jsx'],entryPoint:'app.jsx'});
    expect(again).toEqual(snapshot); expect(again.files[0].content).toContain('<button>Continue</button>');
  });
  it('rejects a different claimed repository',async()=>{
    await expect(inspectRepository({rootPath:root,repositoryUrl:'https://github.com/other/repo',revision,sourcePaths:['app.jsx'],entryPoint:'app.jsx'})).rejects.toMatchObject({code:'REMOTE_MISMATCH'});
  });
  it('rejects symbolic links instead of copying their target',async()=>{
    await expect(inspectRepository({rootPath:root,repositoryUrl:remote,revision,sourcePaths:['linked.js'],entryPoint:'linked.js'})).rejects.toMatchObject({code:'UNSAFE_SOURCE_TYPE'});
  });
  it('detects modified bytes and modified entry-point identity',()=>{
    const changed=structuredClone(snapshot); changed.files[0].content+='\n';
    expect(()=>validateRepositorySnapshot(changed)).toThrow('source manifest');
    expect(()=>validateRepositorySnapshot({...snapshot,rootElementId:'other'})).toThrow('manifest identity');
  });
  it('creates a new immutable identity for a scoped patch without mutating baseline',()=>{
    const next=applyRepositoryPatch(snapshot,{'app.jsx':'export default function App(){return <button aria-label="Continue booking">Continue</button>}'});
    expect(next.sourceDigest).not.toBe(snapshot.sourceDigest);
    expect(snapshot.files[0].content).not.toContain('aria-label');
    expect(()=>validateRepositorySnapshot(next)).not.toThrow();
  });
  it('retains component identity across JSON/API property ordering without accepting changed bootstrap bytes',async()=>{
    const component=await inspectRepository({rootPath:root,repositoryUrl:remote,revision,sourcePaths:['app.jsx'],entryPoint:'app.jsx',
      bootstrap:{source:'import App from "./app.jsx"; export default App;',description:'A disclosed component mount.'},moduleAliases:{'z-component':'app.jsx','a-component':'app.jsx'}});
    const parsed=repositorySnapshotSchema.parse(JSON.parse(JSON.stringify(component)));
    parsed.moduleAliases={'a-component':'app.jsx','z-component':'app.jsx'};
    expect(()=>validateRepositorySnapshot(parsed)).not.toThrow();
    expect(applyRepositoryPatch(parsed).sourceDigest).toBe(component.sourceDigest);
    expect(()=>validateRepositorySnapshot({...parsed,bootstrap:{...parsed.bootstrap!,source:'different source'}})).toThrow();
  });
  it('preserves the original digest of a legacy v1 component receipt after API parsing',async()=>{
    const legacy=repositorySnapshotSchema.parse(JSON.parse(await readFile(new URL('./fixtures/legacy-repository-manifest.json',import.meta.url),'utf8')));
    expect(()=>validateRepositorySnapshot(legacy)).not.toThrow();
    expect(applyRepositoryPatch(legacy).sourceDigest).toBe(legacy.sourceDigest);
    expect(()=>validateRepositorySnapshot({...legacy,bootstrap:{...legacy.bootstrap!,description:'A different adapter meaning.'}})).toThrow();
    const changed=applyRepositoryPatch(legacy,{'app.jsx':'export default function App(){return <button>Next</button>}'});
    expect(changed.sourceDigest).not.toBe(legacy.sourceDigest);
    expect(()=>validateRepositorySnapshot(repositorySnapshotSchema.parse(changed))).not.toThrow();
  });
  it('rejects new files, path escape and build configuration changes',()=>{
    expect(()=>applyRepositoryPatch(snapshot,{'other.jsx':'x'})).toThrow('reviewed source paths');
    for(const path of ['../escape.js','.env.js','node_modules/react/index.js','vite.config.js','package.json']){
      expect(()=>applyRepositoryPatch(snapshot,{[path]:'x'})).toThrow();
    }
  });
  it('rejects branch references, duplicate paths and oversized files',async()=>{
    await expect(inspectRepository({rootPath:root,repositoryUrl:remote,revision:'main',sourcePaths:['app.jsx'],entryPoint:'app.jsx'})).rejects.toMatchObject({code:'IMMUTABLE_REVISION_REQUIRED'});
    expect(()=>validateRepositorySnapshot({...snapshot,files:[...snapshot.files,...snapshot.files]})).toThrow();
    expect(()=>applyRepositoryPatch(snapshot,{'app.jsx':'x'.repeat(600000)})).toThrow();
  });
  it('rejects a cancelled job before starting or qualifying a worker',async()=>{
    const controller=new AbortController();controller.abort(new Error('Operator cancelled this job'));
    await expect(buildRepository({snapshot,signal:controller.signal})).rejects.toThrow('Operator cancelled');
  });
});
