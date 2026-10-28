import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {RepairProvider,NEBIUS_ULTRA_MODEL} from '../server/provider.js';
import {Store} from '../server/store.js';

// Explicit final-provider qualification. The ordinary development server is unchanged.
const root=resolve('.passage/nebius-qualification');await mkdir(root,{recursive:true});
const store=new Store(root);
const provider=new RepairProvider(store,{provider:'nebius',model:NEBIUS_ULTRA_MODEL,baseUrl:'https://api.tokenfactory.us-central1.nebius.com/v1',allowLive:true});
const startedAt=new Date().toISOString();
try{
  const result=await provider.completeStructured({runId:'ultra-regional-compatibility',signal:AbortSignal.timeout(490000),promptVersion:'passage-nebius-ultra-temporal-qualification-v1',
    system:'Assess the given frontend event ordering. Return only a JSON object with safe (boolean) and explanation (string, at most 500 characters). Do not include reasoning traces. No commands or external actions.',
    payload:{events:['The user starts an asynchronous availability request.','The user presses Escape; the panel closes, but no request token is invalidated.','The request resolves successfully; its unchanged callback commits the requested date.'],requirement:'Cancelling must preserve the original committed date.'},
    schema:z.object({safe:z.boolean(),explanation:z.string().max(500)}).strict()});
  const output={schema:'passage.nebius-route-qualification.v1',startedAt,completedAt:new Date().toISOString(),purpose:'Exact regional Ultra completion compatibility; not full repair qualification',endpoint:provider.baseUrl,
    expectedSafe:false,matched:result.value.safe===false,receipt:result.receipt,usage:provider.usage(),result:result.value};
  await writeFile(resolve(root,'compatibility.json'),JSON.stringify(output,null,2));
  console.log(JSON.stringify({matched:output.matched,receipt:result.receipt},null,2));
  if(!output.matched)process.exitCode=1;
}catch(error){
  await writeFile(resolve(root,'compatibility-error.json'),JSON.stringify({startedAt,completedAt:new Date().toISOString(),endpoint:provider.baseUrl,error:error instanceof Error?error.message:String(error),usage:provider.usage()},null,2));
  console.error(error instanceof Error?error.message:String(error));process.exitCode=1;
}finally{store.close();}
