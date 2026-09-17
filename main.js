const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");
const https = require("https");

const dataDir = path.join(app.getPath("userData"), "library");
const dbFile = path.join(dataDir, "games.json");
const installDir = path.join(dataDir, "installed");
const configFile = path.join(dataDir, "config.json");
const defaultConfig = { serverUrl: "http://localhost:3180", account: "Player", session: "" };
const storeDir = path.join(dataDir, "store-server");
const storeDb = path.join(storeDir, "store.json");
const storeGamesDir = path.join(storeDir, "games");
let storeServer = null;
function ensureStore(){
  fs.mkdirSync(storeGamesDir,{recursive:true});
  if(!fs.existsSync(storeDb)) writeJson(storeDb,{users:{},games:{"sample-game":{id:"sample-game",name:"Game All-stars Sample",type:"html",version:"1.0.0",developer:"Game All-stars",description:"開発用の無料サンプルゲームです。",price:0,metascore:null}}});
  const sample=path.join(storeGamesDir,"sample-game.html");
  if(!fs.existsSync(sample)) fs.writeFileSync(sample,'<!doctype html><html><body style="font-family:sans-serif;background:#202020;color:white;text-align:center;padding:60px"><h1>Game All-stars Sample</h1><p>無料サンプルゲームです。</p><button onclick="document.querySelector(\'p\').textContent=\'プレイ中！\'">PLAY</button></body></html>','utf8');
}
function storeRead(){ensureStore();return readJson(storeDb,{users:{},games:{}})}
function storeSave(d){writeJson(storeDb,d)}
function storeGameFile(id){for(const ext of ['.exe','.html','.htm']){const f=path.join(storeGamesDir,id+ext);if(fs.existsSync(f))return f}return null}
function startStoreServer(){
  ensureStore();
  storeServer=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://localhost:3180'), p=u.pathname;
    const send=(status,obj)=>{const b=Buffer.from(JSON.stringify(obj));res.writeHead(status,{'Content-Type':'application/json','Content-Length':b.length,'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,X-User'});res.end(b)};
    try{
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,X-User'});return res.end()}
      const d=storeRead();
      if(req.method==='GET'&&p==='/api/catalog') return send(200,{games:Object.values(d.games)});
      if(req.method==='GET'&&p==='/api/account'){const user=u.searchParams.get('user')||'Player';d.users[user]??={owned:[]};storeSave(d);return send(200,{user,owned:d.users[user].owned})}
      if(req.method==='GET'&&p.startsWith('/api/ownership/')){const id=decodeURIComponent(p.split('/').pop()),user=u.searchParams.get('user')||'Player';if(!d.users[user]?.owned.includes(id))return send(403,{error:'このゲームはライブラリに追加されていません。'});return send(200,{owned:true})}
      if(req.method==='POST'&&(p==='/api/claim'||p==='/api/purchase')){const chunks=[];for await(const c of req)chunks.push(c);const x=JSON.parse(Buffer.concat(chunks).toString()||'{}'),user=x.user||'Player';if(!d.games[x.gameId])return send(404,{error:'ゲームが見つかりません。'});d.users[user]??={owned:[]};if(!d.users[user].owned.includes(x.gameId))d.users[user].owned.push(x.gameId);storeSave(d);return send(200,{ok:true,owned:true})}
      if(req.method==='POST'&&p==='/api/publish'){const chunks=[];for await(const c of req)chunks.push(c);const x=JSON.parse(Buffer.concat(chunks).toString()||'{}'),id='game-'+Date.now().toString(36);d.games[id]={id,name:x.name,type:x.type,version:x.version||'1.0.0',developer:x.developer||x.user||'Unknown',description:x.description||'',price:0,metascore:null};storeSave(d);return send(200,{ok:true,id})}
      if(req.method==='PUT'&&p.startsWith('/api/publish/')){const id=decodeURIComponent(p.split('/').pop());if(!d.games[id])return send(404,{error:'ゲームが見つかりません。'});const ext=d.games[id].type==='exe'?'.exe':'.html', f=fs.createWriteStream(path.join(storeGamesDir,id+ext));req.pipe(f);f.on('finish',()=>send(200,{ok:true}));return}
      if(req.method==='GET'&&p.startsWith('/api/download/')){const id=decodeURIComponent(p.split('/').pop()),user=u.searchParams.get('user')||'Player';if(!d.users[user]?.owned.includes(id))return send(403,{error:'ライブラリに追加してください。'});const f=storeGameFile(id);if(!f)return send(404,{error:'配布ファイルがありません。'});res.writeHead(200,{'Content-Type':'application/octet-stream','Access-Control-Allow-Origin':'*'});return fs.createReadStream(f).pipe(res)}
      return send(404,{error:'Not found'});
    }catch(e){return send(500,{error:e.message})}
  });
  storeServer.listen(3180,'127.0.0.1');
}

function ensureData(){ fs.mkdirSync(installDir,{recursive:true}); if(!fs.existsSync(dbFile)) fs.writeFileSync(dbFile,"[]","utf8"); if(!fs.existsSync(configFile)) fs.writeFileSync(configFile,JSON.stringify(defaultConfig,null,2),"utf8"); }
function readJson(file,fallback){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJson(file,v){ fs.writeFileSync(file,JSON.stringify(v,null,2),"utf8"); }
function readGames(){ensureData();return readJson(dbFile,[])}
function config(){ensureData();return {...defaultConfig,...readJson(configFile,{})}}
function saveConfig(c){writeJson(configFile,{...defaultConfig,...c})}
function requestJson(method,url,data,extraHeaders={}){
  return new Promise((resolve,reject)=>{
    const u=new URL(url); const lib=u.protocol==='https:'?https:http;
    const body=data?Buffer.from(JSON.stringify(data)):null;
    const req=lib.request(u,{method,headers:{'Content-Type':'application/json',...(body?{'Content-Length':body.length}:{}),...extraHeaders}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();let value;try{value=JSON.parse(text)}catch{value={message:text}}; if(res.statusCode>=200&&res.statusCode<300)resolve(value);else reject(new Error(value.error||value.message||`HTTP ${res.statusCode}`));});});req.on('error',reject);if(body)req.write(body);req.end();
  });
}
function onlineHeaders(){const c=config();return c.session?{'X-Session':c.session}:{}}
function download(url,dest,headers={}){
  return new Promise((resolve,reject)=>{const u=new URL(url);const lib=u.protocol==='https:'?https:http;const file=fs.createWriteStream(dest);const req=lib.get(u,{headers},res=>{if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){file.close();fs.rmSync(dest,{force:true});return download(new URL(res.headers.location,u).toString(),dest,headers).then(resolve,reject)} if(res.statusCode!==200){file.close();fs.rmSync(dest,{force:true});return reject(new Error(`Download failed: HTTP ${res.statusCode}`))}res.pipe(file);file.on('finish',()=>file.close(resolve));});req.on('error',e=>{file.close();fs.rmSync(dest,{force:true});reject(e)});});
}
function createWindow(){const win=new BrowserWindow({width:1100,height:720,minWidth:900,minHeight:560,backgroundColor:'#4d524e',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}});win.loadFile(path.join(__dirname,'renderer','index.html'));}

app.whenReady().then(()=>{
  ensureData();
  startStoreServer();
  ipcMain.handle('config:get',()=>config());
  ipcMain.handle('config:set',(_,c)=>{saveConfig({...config(),...c});return config()});
  ipcMain.handle('games:list',()=>readGames());
  ipcMain.handle('games:register',async()=>{
    const r=await dialog.showOpenDialog({title:'ゲームファイルを登録',properties:['openFile'],filters:[{name:'Game files',extensions:['exe','html','htm']}]});
    if(r.canceled)return {canceled:true}; const source=r.filePaths[0]; const ext=path.extname(source).toLowerCase(); if(!['.exe','.html','.htm'].includes(ext))return {error:'EXE / HTML / HTM ファイルのみ登録できます。'};
    const id=Date.now().toString(36); const dest=path.join(installDir,id+ext); fs.copyFileSync(source,dest); const games=readGames(); games.push({id,name:path.basename(source,ext),type:ext==='.exe'?'exe':'html',installed:true,localPath:dest,version:'1.0.0',owned:true,source:'local',registeredAt:new Date().toISOString()}); writeJson(dbFile,games); return {ok:true};
  });
  ipcMain.handle('games:launch',async(_,id)=>{const g=readGames().find(x=>x.id===id);if(!g||!g.installed||!fs.existsSync(g.localPath))return {error:'ゲームがインストールされていません。'}; if(g.type==='exe')spawn(g.localPath,[],{detached:true,stdio:'ignore'}).unref(); else await shell.openPath(g.localPath);return {ok:true}});
  ipcMain.handle('games:uninstall',(_,id)=>{const games=readGames();const g=games.find(x=>x.id===id);if(!g)return {error:'ゲームが見つかりません。'};if(g.localPath)try{fs.rmSync(g.localPath,{force:true})}catch{}g.installed=false;writeJson(dbFile,games);return {ok:true}});
  ipcMain.handle('store:list',async()=>{const c=config();return requestJson('GET',c.serverUrl+'/api/catalog',null,onlineHeaders()).catch(e=>({error:e.message}))});
  ipcMain.handle('store:account',async()=>{const c=config();return requestJson('GET',c.serverUrl+'/api/account',null,onlineHeaders()).catch(e=>({error:e.message}))});
  ipcMain.handle('store:buy',async(_,gameId)=>{const c=config();try{return await requestJson('POST',c.serverUrl+'/api/claim',{gameId},onlineHeaders())}catch(e){return {error:e.message}}});
  ipcMain.handle('store:install',async(_,gameId)=>{
    const c=config(); const games=readGames(); let g=games.find(x=>x.storeId===gameId); if(!g){try{const cat=await requestJson('GET',c.serverUrl+'/api/catalog',null,onlineHeaders());const item=cat.games.find(x=>x.id===gameId);if(!item)return {error:'ゲームが見つかりません。'};g={id:'store-'+gameId,storeId:gameId,name:item.name,type:item.type,owned:true,installed:false,version:item.version,developer:item.developer};games.push(g)}catch(e){return {error:e.message}}}
    try{await requestJson('GET',c.serverUrl+'/api/ownership/'+encodeURIComponent(gameId),null,onlineHeaders());}catch(e){return {error:'購入済みのゲームだけインストールできます。'} }
    const ext=g.type==='exe'?'.exe':'.html'; const dest=path.join(installDir,g.storeId+ext); try{await download(c.serverUrl+'/api/download/'+encodeURIComponent(gameId),dest,onlineHeaders());g.localPath=dest;g.installed=true;const cat=await requestJson('GET',c.serverUrl+'/api/catalog',null,onlineHeaders());const item=cat.games.find(x=>x.id===gameId);if(item)Object.assign(g,{name:item.name,type:item.type,version:item.version,developer:item.developer,description:item.description});writeJson(dbFile,games);return {ok:true}}catch(e){try{fs.rmSync(dest,{force:true})}catch{}return {error:e.message}}
  });
  ipcMain.handle('store:checkUpdates',async()=>{const c=config();try{const cat=await requestJson('GET',c.serverUrl+'/api/catalog',null,onlineHeaders());const games=readGames();return {updates:games.filter(g=>g.storeId).map(g=>{const item=cat.games.find(x=>x.id===g.storeId);return item&&item.version!==g.version?{id:g.storeId,name:g.name,current:g.version,latest:item.version}:null}).filter(Boolean)}}catch(e){return {error:e.message}}});
  ipcMain.handle('store:update',async(_,gameId)=>{return await ipcMain.handlers?.get?.('store:install')?.(null,gameId) || (async()=>{const c=config();const games=readGames();let g=games.find(x=>x.storeId===gameId);if(!g)return {error:'ライブラリにゲームがありません。'};try{await requestJson('GET',c.serverUrl+'/api/ownership/'+encodeURIComponent(gameId),null,onlineHeaders());const cat=await requestJson('GET',c.serverUrl+'/api/catalog',null,onlineHeaders());const item=cat.games.find(x=>x.id===gameId);if(!item)return {error:'ゲームが見つかりません。'};const ext=g.type==='exe'?'.exe':'.html';const dest=path.join(installDir,g.storeId+ext);await download(c.serverUrl+'/api/download/'+encodeURIComponent(gameId),dest,onlineHeaders());g.localPath=dest;g.installed=true;g.version=item.version;g.name=item.name;g.type=item.type;g.developer=item.developer;g.description=item.description;writeJson(dbFile,games);return {ok:true}}catch(e){return {error:e.message}}})()});
  ipcMain.handle('store:publish',async()=>{
    const r=await dialog.showOpenDialog({title:'公開するゲームファイルを選択',properties:['openFile'],filters:[{name:'Game files',extensions:['exe','html','htm']}]}); if(r.canceled)return {canceled:true}; const source=r.filePaths[0]; const ext=path.extname(source).toLowerCase(); if(!['.exe','.html','.htm'].includes(ext))return {error:'EXE / HTML / HTM のみ公開できます。'};
    const name=path.basename(source,ext); const c=config(); const buffer=fs.readFileSync(source); const meta=await requestJson('POST',c.serverUrl+'/api/publish',{user:c.account,name,type:ext==='.exe'?'exe':'html',version:'1.0.0',developer:c.account,description:'Game All-stars で公開されたゲーム'},onlineHeaders()).catch(e=>({error:e.message})); if(meta.error)return meta;
    return new Promise(resolve=>{const u=new URL(c.serverUrl+'/api/publish/'+meta.id);const lib=u.protocol==='https:'?https:http;const req=lib.request(u,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':buffer.length,'X-User':c.account}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{let v={};try{v=JSON.parse(Buffer.concat(chunks).toString())}catch{};resolve(res.statusCode>=200&&res.statusCode<300?{ok:true,id:meta.id}:{error:v.error||'アップロードに失敗しました。'})})});req.on('error',e=>resolve({error:e.message}));req.write(buffer);req.end()});
  });

  async function onlineCall(method,pathName,data){const c=config();const headers={};if(c.session)headers['X-Session']=c.session;try{return await requestJson(method,c.serverUrl+pathName,data,headers)}catch(e){return {error:e.message}}}
  ipcMain.handle('online:login',async()=>{const r=await dialog.showMessageBox({type:'question',buttons:['ログイン','キャンセル'],defaultId:0,title:'Game All-stars Online',message:'ログイン情報はアカウント設定画面から入力してください。'});return r.response===0?{needsForm:true}: {canceled:true}});
  ipcMain.handle('online:register',async()=>({needsForm:true}));
  ipcMain.handle('online:logout',async()=>{const r=await onlineCall('POST','/api/logout');saveConfig({...config(),session:''});return r});
  ipcMain.handle('online:me',async()=>onlineCall('GET','/api/me'));
  ipcMain.handle('online:friends',async()=>onlineCall('GET','/api/friends'));
  ipcMain.handle('online:addFriend',async()=>{const r=await dialog.showMessageBox({type:'info',buttons:['OK'],title:'フレンド',message:'フレンド追加は設定画面のフレンド欄から行えます。'});return r});
  ipcMain.handle('online:rooms',async()=>onlineCall('GET','/api/rooms'));
  ipcMain.handle('online:createRoom',async()=>({needsForm:true}));
  ipcMain.handle('online:joinRoom',async()=>({needsForm:true}));
  ipcMain.handle('online:room',async()=>({error:'ルームIDが必要です。'}));
  ipcMain.handle('online:roomMessage',async()=>({needsForm:true}));
  ipcMain.handle('online:score',async()=>({needsForm:true}));
  ipcMain.handle('online:leaderboard',async()=>onlineCall('GET','/api/leaderboard?gameId=sample-game'));
  createWindow(); app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow()});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('will-quit',()=>{try{storeServer?.close()}catch{}});
