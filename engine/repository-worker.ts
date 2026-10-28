import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer, type Server } from 'node:http';

const exec = promisify(execFile);
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const MAX_FILE = 512 * 1024;
const MAX_SOURCE = 8 * 1024 * 1024;
const MAX_BUNDLE = 12 * 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
export interface RepositorySnapshot {
  schema: 'passage.repository.v1'; repositoryUrl: string; revision: string;
  sourceDigest: string; entryPoint: string; rootElementId: string; rootElementClass?: string;
  bootstrap?: {source:string;sha256:string;description:string};
  moduleAliases?: Record<string,string>;
  files: { path: string; sha256: string; content: string }[];
  disclosure: 'public-source';
}
export interface RepositoryRuntime {
  context: string; image: string;
}
export interface RepositoryBuild {
  schema: 'passage.repository-build.v1'; id: string; revision: string;
  sourceDigest: string; bundleDigest: string; previewUrl: string;
  files: { path: string; sha256: string }[];
  createdAt: string; outcomeVerification: 'not-configured';
  isolation: { runtime: 'docker-linux'; context: string; image: string;
    network: 'none'; hostMounts: false; readOnlyRoot: true; user: '1000:1000';
    capabilities: 'none'; memoryBytes: number; pidsLimit: number };
}
export interface RepositoryOutcomeObserver {
  readonly id: string;
  observe(identity: Readonly<{ buildId: string; sourceDigest: string; sessionId: string }>):
    Promise<{ verified: boolean; records: readonly unknown[]; observerId: string; sourceDigest: string }>;
}
export class RepositoryWorkerError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
function safePath(path: string) {
  if (!/^[A-Za-z0-9_@][A-Za-z0-9_@./ -]*\.(?:[cm]?[jt]sx?|css|json)$/.test(path) ||
      path.split('/').some(p => p === '..' || p === '.' || !p || p === 'node_modules') ||
      /(?:^|\/)(?:package(?:-lock)?\.json|[^/]*\.config\.[^/]+)$/.test(path)) {
    throw new RepositoryWorkerError('INVALID_SOURCE_PATH', 'Only reviewed source files may enter the repository worker.');
  }
}
type SnapshotIdentityInput = Omit<RepositorySnapshot, 'sourceDigest'> | RepositorySnapshot;
function manifestHash(snapshot:SnapshotIdentityInput,bootstrap:unknown,aliases:Record<string,string>) {
  return sha(JSON.stringify({ schema: snapshot.schema, repositoryUrl: snapshot.repositoryUrl,
    revision: snapshot.revision, entryPoint: snapshot.entryPoint, rootElementId: snapshot.rootElementId, rootElementClass:snapshot.rootElementClass ?? '',
    disclosure: snapshot.disclosure,
    bootstrap, moduleAliases:aliases,
    files: snapshot.files.map(({ path, sha256 }) => ({ path, sha256 })).sort((a,b) => a.path.localeCompare(b.path)) }));
}
function identity(snapshot:SnapshotIdentityInput) {
  return manifestHash(snapshot,snapshot.bootstrap ? {source:snapshot.bootstrap.source,description:snapshot.bootstrap.description,sha256:snapshot.bootstrap.sha256} : null,
    Object.fromEntries(Object.entries(snapshot.moduleAliases ?? {}).sort(([a],[b])=>a.localeCompare(b))));
}
function identityMatches(snapshot:RepositorySnapshot) {
  if(identity(snapshot)===snapshot.sourceDigest)return true;
  // Earlier v1 receipts hashed bootstrap insertion order. Accept only the six
  // equivalent serializations of the same three exact fields; never rehash a
  // historical baseline merely because an API validator reordered its object.
  if(!snapshot.bootstrap)return manifestHash(snapshot,null,snapshot.moduleAliases??{})===snapshot.sourceDigest;
  const keys=['source','description','sha256'] as const;
  for(const first of keys)for(const second of keys.filter(key=>key!==first)){
    const order=[first,second,keys.find(key=>key!==first&&key!==second)!];
    const bootstrap=Object.fromEntries(order.map(key=>[key,snapshot.bootstrap![key]]));
    if(manifestHash(snapshot,bootstrap,snapshot.moduleAliases??{})===snapshot.sourceDigest)return true;
  }
  return false;
}
export function validateRepositorySnapshot(snapshot: RepositorySnapshot): void {
  if (snapshot.schema !== 'passage.repository.v1' || snapshot.disclosure !== 'public-source' ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(snapshot.repositoryUrl) ||
      !REVISION.test(snapshot.revision) || !/^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(snapshot.rootElementId) || !/^[A-Za-z0-9_ -]{0,160}$/.test(snapshot.rootElementClass ?? '') ||
      !Array.isArray(snapshot.files) || !snapshot.files.length || snapshot.files.length > 200) {
    throw new RepositoryWorkerError('INVALID_SNAPSHOT', 'A bounded public repository snapshot with an immutable revision is required.');
  }
  const paths = new Set<string>(); let bytes = 0;
  for (const file of snapshot.files) {
    safePath(file.path);
    if (paths.has(file.path) || typeof file.content !== 'string' || Buffer.byteLength(file.content) > MAX_FILE ||
        !DIGEST.test(file.sha256) || sha(file.content) !== file.sha256) {
      throw new RepositoryWorkerError('SOURCE_INTEGRITY', 'Repository content does not match its source manifest.');
    }
    paths.add(file.path); bytes += Buffer.byteLength(file.content);
  }
  if (bytes > MAX_SOURCE || !paths.has(snapshot.entryPoint) || !identityMatches(snapshot)) {
    throw new RepositoryWorkerError('SOURCE_INTEGRITY', 'Repository manifest identity or entry point is invalid.');
  }
  if(snapshot.bootstrap && (typeof snapshot.bootstrap.source !== 'string' || snapshot.bootstrap.source.length>10000 ||
    sha(snapshot.bootstrap.source)!==snapshot.bootstrap.sha256 || !snapshot.bootstrap.description || snapshot.bootstrap.description.length>1000)) {
    throw new RepositoryWorkerError('BOOTSTRAP_INTEGRITY','A component mount adapter must be reviewed and content-bound.');
  }
  for(const [name,path] of Object.entries(snapshot.moduleAliases ?? {})) {
    if(!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name) || !paths.has(path)) throw new RepositoryWorkerError('ALIAS_SCOPE','A module alias must resolve to a reviewed source blob.');
  }
}
export async function inspectRepository(input: {
  rootPath: string; repositoryUrl: string; revision: string; sourcePaths: string[];
  entryPoint: string; rootElementId?: string; rootElementClass?: string;
  bootstrap?: {source:string;description:string}; moduleAliases?:Record<string,string>;
}): Promise<RepositorySnapshot> {
  if (!REVISION.test(input.revision)) throw new RepositoryWorkerError('IMMUTABLE_REVISION_REQUIRED', 'Use the full 40-character Git commit.');
  if (!input.sourcePaths.length || input.sourcePaths.length > 200) throw new RepositoryWorkerError('SOURCE_LIMIT', 'Select 1–200 source files.');
  const root = resolve(input.rootPath);
  const remote = (await exec('git', ['-C', root, 'remote', 'get-url', 'origin'], { timeout: 10000, maxBuffer: 10000 })).stdout.trim();
  if (remote.replace(/\.git$/, '') !== input.repositoryUrl.replace(/\.git$/, '')) throw new RepositoryWorkerError('REMOTE_MISMATCH', 'The selected Git remote does not match the public repository identity.');
  const files = [];
  for (const path of [...input.sourcePaths].sort()) {
    safePath(path);
    const mode = (await exec('git', ['-C', root, 'ls-tree', input.revision, '--', path], {timeout:10000,maxBuffer:10000})).stdout;
    if (!/^100644 blob /.test(mode) && !/^100755 blob /.test(mode)) throw new RepositoryWorkerError('UNSAFE_SOURCE_TYPE','Only regular Git source blobs are accepted.');
    const content = (await exec('git', ['-C', root, 'show', `${input.revision}:${path}`], { timeout: 15000, maxBuffer: MAX_FILE })).stdout;
    files.push({path, sha256: sha(content), content});
  }
  const raw = {schema:'passage.repository.v1' as const, repositoryUrl:input.repositoryUrl, revision:input.revision,
    entryPoint:input.entryPoint, rootElementId:input.rootElementId ?? 'root', rootElementClass:input.rootElementClass ?? '', files, disclosure:'public-source' as const,
    ...(input.bootstrap ? {bootstrap:{...input.bootstrap,sha256:sha(input.bootstrap.source)}} : {}), moduleAliases:input.moduleAliases ?? {}};
  const snapshot = {...raw, sourceDigest:identity(raw)};
  validateRepositorySnapshot(snapshot); return snapshot;
}
export function applyRepositoryPatch(snapshot: RepositorySnapshot, patchFiles: Record<string,string> = {}): RepositorySnapshot {
  validateRepositorySnapshot(snapshot);
  const paths = new Set(snapshot.files.map(file => file.path));
  for (const path of Object.keys(patchFiles)) { safePath(path); if (!paths.has(path)) throw new RepositoryWorkerError('PATCH_SCOPE','A patch may only change reviewed source paths.'); }
  const files = snapshot.files.map(file => Object.hasOwn(patchFiles,file.path)
    ? {path:file.path, content:patchFiles[file.path], sha256:sha(patchFiles[file.path])} : {...file});
  const result = {...snapshot,files};
  if(files.some((file,index)=>file.sha256!==snapshot.files[index].sha256))result.sourceDigest = identity(result);
  validateRepositorySnapshot(result); return result;
}
export async function repositoryRuntime(): Promise<RepositoryRuntime> {
  let runtime: RepositoryRuntime;
  try { runtime = JSON.parse(await readFile(resolve('.passage/repository-worker/runtime.json'),'utf8')); }
  catch { throw new RepositoryWorkerError('WORKER_UNQUALIFIED','The isolated repository worker has not been prepared. Run scripts/repository-worker-setup.sh.'); }
  if (!/^[A-Za-z0-9_.-]+$/.test(runtime.context) || !/^sha256:[a-f0-9]{64}$/.test(runtime.image)) {
    throw new RepositoryWorkerError('WORKER_UNQUALIFIED','The worker requires an explicit Docker context and immutable image ID.');
  }
  return runtime;
}
async function docker(runtime:RepositoryRuntime,args:string[],timeout=15000,maxBuffer=MAX_BUNDLE) {
  return exec('docker',['--context',runtime.context,...args],{timeout,maxBuffer});
}
async function dockerInput(runtime:RepositoryRuntime,args:string[],input:string,signal?:AbortSignal):Promise<string> {
  return new Promise((ok,no)=>{
    const child=execFile('docker',['--context',runtime.context,...args],{timeout:120000,maxBuffer:MAX_BUNDLE,encoding:'utf8',signal},(error,stdout,stderr)=>{
      if(error) no(new RepositoryWorkerError('BUILD_FAILED',`Isolated build failed: ${stderr.slice(0,3000) || error.message}`)); else ok(stdout);
    });
    child.stdin?.on('error',()=>undefined); child.stdin?.end(input);
  });
}
export async function qualifyRepositoryWorker() {
  try {
    const runtime = await repositoryRuntime();
    const info = JSON.parse((await docker(runtime,['info','--format','{{json .}}'],5000)).stdout);
    if (info.OSType !== 'linux') throw new Error('A Linux worker is required.');
    const image = JSON.parse((await docker(runtime,['image','inspect',runtime.image,'--format','{{json .}}'],5000)).stdout);
    if (image.Id !== runtime.image || image.Config.Labels?.['org.passage.worker'] !== 'react-static-v1') throw new Error('Worker image identity is not qualified.');
    return {status:'ready' as const, runtime, engineVersion:info.ServerVersion, checkedAt:new Date().toISOString()};
  } catch(error) { return {status:'blocked' as const, reason:error instanceof Error ? error.message : 'Worker unavailable', checkedAt:new Date().toISOString()}; }
}

const artifactRoot = () => resolve('.passage/repository-worker/artifacts');
let preview: Server | undefined;
let previewStart:Promise<void>|undefined;
let previewPort = 4104;
export async function startRepositoryPreview(port=4104):Promise<void> {
  if(preview)return;
  if(!previewStart) previewStart=startPreview(port).finally(()=>{previewStart=undefined;});
  return previewStart;
}
async function startPreview(port:number): Promise<void> {
  if (preview) return;
  const server = createServer(async(request,response) => {
    const headers = {'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors http://127.0.0.1:4101 http://localhost:4101;"};
    const match = /^\/repository\/([a-f0-9]{64})\/(index\.html|app\.js|app\.css)$/.exec((request.url ?? '').split('?')[0]);
    if (request.method !== 'GET' || !match || ![`127.0.0.1:${previewPort}`,`localhost:${previewPort}`].includes(request.headers.host ?? '')) {
      response.writeHead(404,headers); response.end('Repository preview not found.'); return;
    }
    try {
      const manifest = JSON.parse(await readFile(join(artifactRoot(),match[1],'artifacts.json'),'utf8')) as Record<string,string>;
      const data = await readFile(join(artifactRoot(),match[1],match[2]));
      if (sha(data) !== manifest[match[2]]) throw new Error('Artifact integrity mismatch');
      response.writeHead(200,{...headers,'Content-Type':match[2].endsWith('.html')?'text/html; charset=utf-8':match[2].endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'}); response.end(data);
    } catch { response.writeHead(409,headers); response.end('Repository artifact unavailable or changed.'); }
  });
  await new Promise<void>((ok,no) => {server.once('error',no); server.listen(port,'127.0.0.1',()=>{server.off('error',no);ok();});});
  const addr = server.address(); if (addr && typeof addr === 'object') previewPort=addr.port;
  preview=server;
}
export async function stopRepositoryPreview() {
  await previewStart?.catch(()=>undefined);
  if (!preview) return; const server=preview; preview=undefined;
  server.closeAllConnections(); await new Promise<void>(ok=>server.close(()=>ok()));
}
export async function buildRepository(input:{snapshot:RepositorySnapshot;patchFiles?:Record<string,string>;signal?:AbortSignal}): Promise<RepositoryBuild> {
  input.signal?.throwIfAborted();
  const snapshot=applyRepositoryPatch(input.snapshot,input.patchFiles);
  const qualification=await qualifyRepositoryWorker();
  if(qualification.status !== 'ready') throw new RepositoryWorkerError('WORKER_UNQUALIFIED',qualification.reason);
  const runtime=qualification.runtime;
  input.signal?.throwIfAborted();
  const name=`passage-repo-${randomUUID()}`;
  try {
    await docker(runtime,['create','--interactive','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
      '--user','1000:1000','--memory','768m','--cpus','1','--pids-limit','96','--tmpfs','/work:rw,nosuid,nodev,size=268435456,uid=1000,gid=1000',runtime.image]);
    input.signal?.throwIfAborted();
    const stdout=await dockerInput(runtime,['start','--attach','--interactive',name],JSON.stringify(snapshot),input.signal);
    const status=JSON.parse((await docker(runtime,['inspect',name,'--format','{{json .State}}'])).stdout);
    if(status.ExitCode !== 0 || status.OOMKilled) throw new RepositoryWorkerError('BUILD_FAILED','The isolated build failed; inspect its bounded build diagnostic.');
    const output=JSON.parse(stdout) as {js:string;css:string;sourceDigest:string};
    input.signal?.throwIfAborted();
    if(output.sourceDigest !== snapshot.sourceDigest || typeof output.js !== 'string' || typeof output.css !== 'string' ||
      output.js.length+output.css.length > MAX_BUNDLE) throw new RepositoryWorkerError('BUILD_IDENTITY','The worker returned an invalid result identity.');
    const bundleDigest=sha(JSON.stringify({js:sha(output.js),css:sha(output.css)}));
    const id=sha(JSON.stringify({source:snapshot.sourceDigest,image:runtime.image,bundleDigest}));
    const root=join(artifactRoot(),id); await mkdir(root,{recursive:true});
    const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Passage · external source preview</title><link rel="stylesheet" href="app.css"><body><div id="${snapshot.rootElementId}" class="${snapshot.rootElementClass ?? ''}"></div><script src="app.js"></script></body></html>`;
    const contents={'index.html':html,'app.js':output.js,'app.css':output.css};
    for(const [path,content] of Object.entries(contents)) await writeFile(join(root,path),content);
    await writeFile(join(root,'artifacts.json'),JSON.stringify(Object.fromEntries(Object.entries(contents).map(([path,content])=>[path,sha(content)]))));
    await startRepositoryPreview();
    const result:RepositoryBuild={schema:'passage.repository-build.v1',id,revision:snapshot.revision,sourceDigest:snapshot.sourceDigest,bundleDigest,
      previewUrl:`http://127.0.0.1:${previewPort}/repository/${id}/index.html`, files:snapshot.files.map(({path,sha256})=>({path,sha256})),
      createdAt:new Date().toISOString(),outcomeVerification:'not-configured',isolation:{runtime:'docker-linux',context:runtime.context,image:runtime.image,
        network:'none',hostMounts:false,readOnlyRoot:true,user:'1000:1000',capabilities:'none',memoryBytes:805306368,pidsLimit:96}};
    await writeFile(join(root,'receipt.json'),JSON.stringify(result,null,2)); input.signal?.throwIfAborted(); return result;
  } finally {
    await docker(runtime,['rm','--force',name],10000).catch(()=>undefined);
  }
}
