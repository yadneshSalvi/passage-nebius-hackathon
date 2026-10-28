import http from 'node:http';
import {writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {platform,arch,release} from 'node:os';
import {firefox} from 'playwright';
import {unstable_orca as orca} from '@guidepup/guidepup';
import {observeDaemonLifecycle} from './diagnostics.mjs';
const diagnostics=observeDaemonLifecycle();
const port=Number(process.env.UPSTREAM_PORT??4104);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('A valid local Passage preview port is required');
const path=process.env.TARGET_PATH??'';
if(!/^\/(?:repository\/[a-f0-9]{64}\/index\.html|s\/[a-f0-9-]+)$/.test(path))throw Error('A bound Passage preview path is required');
const identity={buildId:process.env.AT_BUILD_ID,sourceDigest:process.env.AT_SOURCE_DIGEST};
if(!/^[a-f0-9]{64}$/.test(identity.buildId??'')||!/^[a-f0-9]{64}$/.test(identity.sourceDigest??''))throw Error('Exact build/source identity required');
const proxy=http.createServer((req,res)=>{
  const headers={...req.headers,host:`127.0.0.1:${port}`};
  if(headers.origin===`http://127.0.0.1:4183`)headers.origin=`http://127.0.0.1:${port}`;
  const upstream=http.request({hostname:'host.lima.internal',port,path:req.url,method:req.method,headers},response=>{
    res.writeHead(response.statusCode??502,response.headers);response.pipe(res);
  });
  upstream.on('error',()=>{res.writeHead(502);res.end('Preview upstream unavailable');});req.pipe(upstream);
});
await new Promise(ok=>proxy.listen(4183,'127.0.0.1',ok));
let browser;const evidence={schema:'passage.actual-at.v1',...identity,sessionId:randomUUID(),startedAt:new Date().toISOString(),
  provenance:'automated-actual-screen-reader',screenReader:'Orca',guidepupVersion:'0.36.2',browser:'Firefox',
  platform:`${platform()}/${arch()} ${release()}, isolated Colima VM`,compatibility:process.env.PASSAGE_AT_COMPATIBILITY,humanParticipant:false,independentlyReviewed:false,
  backendOutcomeVerified:false,steps:[],status:'error',limitations:['Automated Orca observation is not a human participant study.','Speech is actual Orca output, not a synthesized DOM description.']};
try{
  await orca.start({capture:true});
  browser=await firefox.launch({headless:false,firefoxUserPrefs:{'accessibility.force_disabled':0}});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  let response;await orca.capture(async()=>{response=await page.goto(`http://127.0.0.1:4183${path}`,{waitUntil:'load'});},{capture:true});
  if(response?.status()!==200)throw Error(`Preview returned ${response?.status()}`);
  evidence.browserVersion=browser.version();
  await page.waitForTimeout(1000);
  const todoCase=['todomvc','todomvc-keyboard'].includes(process.env.AT_CASE);
  evidence.protocol=process.env.AT_CASE??'tab-observation';
  if(todoCase){
    await orca.capture(async()=>{await page.getByRole('textbox',{name:'New Todo Input',exact:true}).fill('Pick up a prescription');
    await page.keyboard.press('Enter');await page.waitForTimeout(500);},{capture:true});
    evidence.steps.push({action:'Create fictional task',at:new Date().toISOString(),spoken:await orca.lastSpokenPhrase()});
  }
  for(let i=0;i<(process.env.AT_CASE==='todomvc-keyboard'?3:8);i++){
    await orca.capture(async()=>{await page.keyboard.press('Tab');await page.waitForTimeout(250);},{capture:true});
    evidence.steps.push({action:'Tab',at:new Date().toISOString(),spoken:await orca.lastSpokenPhrase(),
      focus:await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label'),text:document.activeElement?.textContent?.slice(0,120)}))});
  }
  if(todoCase){
    const keyboardOnly=process.env.AT_CASE==='todomvc-keyboard';
    await orca.capture(async()=>{if(keyboardOnly)await page.keyboard.press('Enter');else await page.getByTestId('todo-item-label').dblclick();await page.waitForTimeout(500);},{capture:true});
    evidence.steps.push({action:keyboardOnly?'Activate reached control with Enter':'Enter edit via upstream double-click gesture',at:new Date().toISOString(),spoken:await orca.lastSpokenPhrase()});
    const canEdit=await page.getByRole('textbox',{name:'Edit todo',exact:true}).isVisible();
    if(canEdit){
    await orca.capture(async()=>{await page.getByRole('textbox',{name:'Edit todo',exact:true}).fill('Cancelled edit should not save');
    await page.keyboard.press('Escape');await page.keyboard.press('Tab');await page.waitForTimeout(500);},{capture:true});
    const actualTitle=await page.getByTestId('todo-item-label').innerText();
    evidence.steps.push({action:'Escape then move focus',at:new Date().toISOString(),spoken:await orca.lastSpokenPhrase(),actualTitle});
    evidence.taskOutcome=actualTitle==='Pick up a prescription'?'cancelled-value-preserved':'cancelled-value-changed';
    }else{evidence.taskOutcome='keyboard-edit-blocked';}
  }
  evidence.spokenPhraseLog=await orca.spokenPhraseLog();
  evidence.status=evidence.spokenPhraseLog.some(phrase=>phrase.trim())?'captured':'no-speech-captured';
  await page.screenshot({path:'/tmp/passage-at.png'});
}catch(error){evidence.error=String(error?.stack??error);evidence.causes=[];let cause=error?.cause;while(cause&&evidence.causes.length<5){evidence.causes.push(String(cause?.stack??cause));cause=cause?.cause;}}finally{
  await browser?.close().catch(()=>{});await orca.stop().catch(()=>{});await new Promise(ok=>proxy.close(ok));
  if(evidence.status!=='captured')evidence.failureDiagnostics=await diagnostics.failure();
  diagnostics.restore();
  evidence.completedAt=new Date().toISOString();
  const output=JSON.stringify(evidence,null,2);await writeFile('/tmp/passage-at.json',output);
  console.log(JSON.stringify({status:evidence.status,sha256:createHash('sha256').update(output).digest('hex'),error:evidence.error,causes:evidence.causes}));
}
