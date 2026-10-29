import {readdirSync} from 'node:fs';import {execFileSync} from 'node:child_process';
for(const folder of ['worker','public','scripts','desktop'])for(const name of readdirSync(folder))if(/\.(?:mjs|cjs|js)$/.test(name))execFileSync(process.execPath,['--check',folder+'/'+name],{stdio:'inherit'});console.log('Syntax checks passed.');
