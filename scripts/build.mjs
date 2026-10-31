import {readFileSync,writeFileSync,mkdirSync,rmSync,cpSync} from 'node:fs';
rmSync('dist',{recursive:true,force:true});mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
const html=readFileSync('public/index.html','utf8').replace('/* APP_CSS */',()=>readFileSync('public/style.css','utf8')).replace('/* APP_JS */',()=>readFileSync('public/app.js','utf8')+'\n'+readFileSync('public/features.js','utf8')+'\n'+readFileSync('public/projects.js','utf8')+'\n'+readFileSync('public/benchmarks.js','utf8'));
const code=readFileSync('worker/index.js','utf8').replace("const APP_HTML = '__APP_HTML__';",'const APP_HTML = '+JSON.stringify(html)+';');
cpSync('worker','dist/server',{recursive:true});writeFileSync('dist/server/index.js',code);cpSync('.openai/hosting.json','dist/.openai/hosting.json');cpSync('drizzle','dist/.openai/drizzle',{recursive:true});console.log('Built worker, UI and migrations.');
