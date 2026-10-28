import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';

// Runs only the disclosed repository-preview protocol. Never reads provider env.
const exec=promisify(execFile);
const {values}=parseArgs({options:{build:{type:'string'},out:{type:'string'},port:{type:'string'},case:{type:'string',default:'todomvc-keyboard'},context:{type:'string',default:'colima-passage'},image:{type:'string',default:'passage-orca-runner:v3'}}});
if(!values.build||!values.out)throw Error('Usage: tsx scripts/capture-actual-at.ts --build BUILD.json --out RECEIPT.json [--case todomvc-keyboard|todomvc|tab-observation]');
if(!['todomvc-keyboard','todomvc','tab-observation'].includes(values.case!))throw Error('Unknown AT protocol');
if(!/^[a-zA-Z0-9_.-]+$/.test(values.context!))throw Error('Invalid Docker context');
const build=JSON.parse(await readFile(resolve(values.build),'utf8'));
const digest=/^[a-f0-9]{64}$/;
if(build.schema!=='passage.repository-build.v1'||!digest.test(build.id)||!digest.test(build.sourceDigest))throw Error('An actual repository build receipt is required');
const url=new URL(build.previewUrl);
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||url.pathname!==`/repository/${build.id}/index.html`||!/^\d+$/.test(url.port))throw Error('Receipt does not identify an isolated local repository preview');
const port=Number(values.port??url.port);
if(port<1024||port>65535)throw Error('Invalid preview port');
if(!Number.isInteger(port))throw Error('Invalid preview port');
url.port=String(port);
const response=await fetch(url,{signal:AbortSignal.timeout(5000),redirect:'error'});
if(!response.ok)throw Error(`Preview is unavailable (${response.status})`);
const docker=(args:string[],timeout=15000)=>exec('docker',['--context',values.context!,...args],{timeout,maxBuffer:1024*1024});
const image=(await docker(['image','inspect',values.image!,'--format','{{.Id}}'])).stdout.trim();
if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('An immutable local runner image is required');
const name=`passage-at-${randomUUID()}`;
const out=resolve(values.out),png=out.replace(/\.json$/,'')+'.png';
if(await lstat(out).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw Error('Choose a new output path; existing evidence is never overwritten.');
await mkdir(dirname(out),{recursive:true});
const startedAt=new Date().toISOString();
let executionError:string|undefined;
try{
  try{
    await docker(['run','--name',name,'--init','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','1536m','--cpus','1','--pids-limit','256','--shm-size','512m',
      '-e',`UPSTREAM_PORT=${port}`,'-e',`TARGET_PATH=${url.pathname}`,'-e',`AT_BUILD_ID=${build.id}`,'-e',`AT_SOURCE_DIGEST=${build.sourceDigest}`,'-e',`AT_CASE=${values.case}`,image],120000);
  }catch(error){executionError=error instanceof Error?error.message:'Runner process failed';}
  await docker(['cp',`${name}:/tmp/passage-at.json`,out]);
  await docker(['cp',`${name}:/tmp/passage-at.png`,png]).catch(()=>undefined);
  const raw=await readFile(out,'utf8'),receipt=JSON.parse(raw);
  if(receipt.buildId!==build.id||receipt.sourceDigest!==build.sourceDigest||(receipt.status==='captured'&&receipt.protocol!==values.case))throw Error('Screen-reader evidence identity mismatch');
  const execution={schema:'passage.actual-at-execution.v1',image,context:values.context,buildId:build.id,sourceDigest:build.sourceDigest,protocol:values.case,
    startedAt,completedAt:new Date().toISOString(),previewUrl:url.href,receiptSha256:createHash('sha256').update(raw).digest('hex'),status:receipt.status,
    taskOutcome:receipt.taskOutcome,humanParticipant:false,independentlyReviewed:false,executionError};
  await writeFile(out.replace(/\.json$/,'')+'.execution.json',JSON.stringify(execution,null,2));
  console.log(JSON.stringify({receipt:out,...execution},null,2));
  if(receipt.status!=='captured'||executionError)process.exitCode=1;
}catch(error){
  await writeFile(out.replace(/\.json$/,'')+'.execution-error.json',JSON.stringify({schema:'passage.actual-at-execution-error.v1',image,context:values.context,
    buildId:build.id,sourceDigest:build.sourceDigest,protocol:values.case,startedAt,completedAt:new Date().toISOString(),status:'error',
    executionError,error:error instanceof Error?error.message:String(error)},null,2));
  throw error;
}finally{await docker(['rm','--force',name]).catch(()=>undefined);}
