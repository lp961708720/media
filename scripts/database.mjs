import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,readdirSync} from 'node:fs';
import path from 'node:path';
export function adapter(db){return {prepare(sql){let args=[];return {bind(...a){args=a;return this},async all(){return {results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}},_run(){return db.prepare(sql).run(...args)}}},async batch(stmts){db.exec('BEGIN IMMEDIATE');try{const results=stmts.map(s=>{const r=s._run();return {meta:{changes:Number(r.changes)}}});db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}}};}
export function openDatabase(dir,{memory=false}={}){
 mkdirSync(dir,{recursive:true});const db=new DatabaseSync(memory?':memory:':path.join(dir,'studio.sqlite'));
 db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;');
 db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
 const migrations=new URL('../drizzle/',import.meta.url);
 // Adopt the existing 0.1 database without replaying its initial schema.
 if(db.prepare("SELECT name FROM sqlite_master WHERE name='accounts'").get())db.prepare('INSERT OR IGNORE INTO _migrations VALUES (?,?)').run('0000_media_studio.sql',new Date().toISOString());
 for(const name of readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort()){
  if(db.prepare('SELECT name FROM _migrations WHERE name=?').get(name))continue;
  db.exec('BEGIN IMMEDIATE');try{db.exec(readFileSync(new URL(name,migrations),'utf8'));db.prepare('INSERT INTO _migrations VALUES (?,?)').run(name,new Date().toISOString());db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');db.close();throw e}
 }
 db.prepare("UPDATE extras SET data=json_set(data,'$.status','interrupted','$.schedule_enabled',json('false'),'$.error','应用已关闭，前次运行中断；请手动重新运行') WHERE kind='workflow' AND json_extract(data,'$.status')='running'").run();
 db.prepare("UPDATE ai_runs SET status='interrupted' WHERE status='running'").run();return {db,DB:adapter(db)};
}
export function backupSnapshot(db,owner){
 const tables={accounts:'accounts',records:'records',revisions:'revisions',runs:'ai_runs',audit:'audit_logs',batches:'import_batches',import_details:'import_details',extras:'extras',usage_events:'usage_events',creative_projects:'creative_projects',creative_artifacts:'creative_artifacts',creative_account_state:'creative_account_state'};db.exec('BEGIN');try{const result=Object.fromEntries(Object.entries(tables).map(([name,table])=>[name,db.prepare('SELECT * FROM '+table+' WHERE owner_id=?').all(owner)]));result.preferences=db.prepare("SELECT * FROM preferences WHERE owner_id=? AND key!='lock'").all(owner);result.extra_revisions=db.prepare('SELECT x.* FROM extra_revisions x JOIN extras e ON e.id=x.extra_id WHERE e.owner_id=?').all(owner);result.creative_project_revisions=db.prepare('SELECT x.* FROM creative_project_revisions x JOIN creative_projects p ON p.id=x.project_id WHERE p.owner_id=?').all(owner);result.creative_artifact_revisions=db.prepare('SELECT x.* FROM creative_artifact_revisions x JOIN creative_artifacts a ON a.id=x.artifact_id WHERE a.owner_id=?').all(owner);db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}
}
