import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {RepairProvider,NEBIUS_ULTRA_MODEL} from '../server/provider.js';
import {Store} from '../server/store.js';
import {RepositoryJourneyService} from '../server/repository-journey-service.js';
import {startRepositoryPreview,stopRepositoryPreview} from '../engine/repository-worker.js';
import type {RepositoryJourney} from '../shared/repository-journey.js';

const phase=process.argv[2];
if(!['prepare','repair'].includes(phase))throw Error('Usage: tsx scripts/qualify-nebius-journey.ts prepare|repair');
const root=resolve('.passage/nebius-journey-qualification');await mkdir(root,{recursive:true});
const store=new Store(root);
const provider=new RepairProvider(store,{provider:'nebius',model:NEBIUS_ULTRA_MODEL,baseUrl:'https://api.tokenfactory.us-central1.nebius.com/v1',allowLive:true});
const service=new RepositoryJourneyService(store,provider);
service.start();await startRepositoryPreview(0);
let session:RepositoryJourney|undefined;
async function settled(id:string){
  while(['building','capturing','drafting','repairing','verifying'].includes(service.session(id).status))await new Promise(ok=>setTimeout(ok,250));
  const current=service.session(id);await writeFile(resolve(root,'session.json'),JSON.stringify(current,null,2));
  await writeFile(resolve(root,'usage.json'),JSON.stringify(provider.usage(),null,2));
  if(current.status==='error')throw Error(current.error?.message??'Qualification operation failed');
  return current;
}
try{
  if(phase==='prepare'){
    const baseline=JSON.parse(await readFile(resolve('.passage/repository-worker/cases/todomvc-react.snapshot.json'),'utf8'));
    const contract=JSON.parse(await readFile(resolve('.passage/repository-worker/cases/todomvc-react.contract.json'),'utf8'));
    await service.inspect({rootPath:resolve('../artifacts/passage-external-todomvc'),repositoryUrl:baseline.repositoryUrl,revision:baseline.revision,
      sourcePaths:baseline.files.map((file:{path:string})=>file.path),entryPoint:baseline.entryPoint,rootElementId:baseline.rootElementId,rootElementClass:baseline.rootElementClass});
    session=service.create({label:'Nebius Ultra qualification: keyboard edit and cancellation',task:contract.title,snapshot:baseline,contract,sourcePermission:'public-source-development'});
    await writeFile(resolve(root,'session-id.txt'),session.id);
    service.build(session.id);session=await settled(session.id);
    service.capture(session.id);session=await settled(session.id);
    service.draft(session.id,'live');session=await settled(session.id);
    console.log(JSON.stringify({id:session.id,draft:session.draft},null,2));
  }else{
    const id=(await readFile(resolve(root,'session-id.txt'),'utf8')).trim();session=service.session(id);
    if(!session.draft)throw Error('Prepare and inspect the actual draft before repair.');
    if(!session.review)session=service.review(id,{expectedDigest:session.draft.digest,maintainer:'Codex root — automated development intent review',interactionReviewer:'Codex root — automated development interaction review',acknowledgeInferred:true,reviewProvenance:'automated-development'});
    for(let attempt=1;attempt<=3;attempt++){
      service.repair(id);session=await settled(id);
      console.log(JSON.stringify({attempt,repair:session.repairs.at(-1)?.status,checks:session.replays.at(-1)?.execution.checks},null,2));
      if(session.repairs.at(-1)?.status==='accepted')break;
    }
    await writeFile(resolve(root,'export.json'),JSON.stringify(service.export(id),null,2));
    if(session.repairs.at(-1)?.status!=='accepted')process.exitCode=1;
  }
}catch(error){
  await writeFile(resolve(root,`error-${Date.now()}.json`),JSON.stringify({phase,at:new Date().toISOString(),error:error instanceof Error?error.message:String(error),usage:provider.usage()},null,2));
  console.error(error instanceof Error?error.message:String(error));process.exitCode=1;
}finally{await service.close();await stopRepositoryPreview();store.close();}
