import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const sha=x=>createHash('sha256').update(x).digest('hex');
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>10*1024*1024)throw Error('Source limit');}
const job=JSON.parse(input);
if(!Array.isArray(job.files)||job.files.length>200) throw Error('Invalid source manifest');
for(const file of job.files){
  if(!/^[A-Za-z0-9_@][A-Za-z0-9_@./ -]*\.(?:[cm]?[jt]sx?|css|json)$/.test(file.path)||file.path.split('/').some(x=>x==='..'||x==='.'||!x||x==='node_modules')||sha(file.content)!==file.sha256) throw Error('Source integrity rejected');
  const path=join('/work/source',file.path); await mkdir(dirname(path),{recursive:true}); await writeFile(path,file.content);
}
if(job.bootstrap){if(sha(job.bootstrap.source)!==job.bootstrap.sha256)throw Error('Bootstrap integrity rejected');await writeFile('/work/bootstrap.jsx',job.bootstrap.source);}
const result=await build({absWorkingDir:'/work/source',entryPoints:[job.bootstrap?'/work/bootstrap.jsx':job.entryPoint],bundle:true,write:false,outdir:'/work/output',
  alias:Object.fromEntries(Object.entries(job.moduleAliases??{}).map(([name,path])=>[name,join('/work/source',path)])),
  entryNames:'app',assetNames:'[name]',platform:'browser',format:'iife',jsx:'automatic',target:['chrome120'],
  nodePaths:['/opt/passage/node_modules'],define:{'process.env.NODE_ENV':'"production"'},loader:{'.js':'jsx','.svg':'dataurl','.png':'dataurl','.woff':'dataurl','.woff2':'dataurl'},logLevel:'silent'});
const js=result.outputFiles.find(f=>f.path.endsWith('/app.js'))?.text;
if(!js) throw Error('No JavaScript output');
const css=result.outputFiles.find(f=>f.path.endsWith('/app.css'))?.text??'';
process.stdout.write(JSON.stringify({sourceDigest:job.sourceDigest,js,css}));
