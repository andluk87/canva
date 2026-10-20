const DATABASE='forma-offline-v1';
let connection;
const generations=new Map();
export const cacheGeneration=userId=>generations.get(userId)||0;
export function openDatabase(){
 if(connection)return connection;
 connection=new Promise((resolve,reject)=>{if(!globalThis.indexedDB)return reject(new Error('IndexedDB недоступен'));const request=indexedDB.open(DATABASE,1);request.onupgradeneeded=()=>{const db=request.result;for(const name of ['documents','projects'])if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name,{keyPath:'key'});store.createIndex('userId','userId');}};request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();connection=undefined};resolve(request.result)};request.onerror=()=>{connection=undefined;reject(request.error)}});return connection;
}
const key=(userId,id)=>`${userId}:${id}`;
async function transact(name,mode,action){const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction(name,mode),store=tx.objectStore(name);let value;try{const request=action(store);if(request)request.onsuccess=()=>value=request.result}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||new Error('Ошибка локального хранилища'));tx.onabort=()=>reject(tx.error||new Error('Запись на устройство отменена'));});}
async function guardedWrite(name,userId,generation,record){const db=await openDatabase();if(cacheGeneration(userId)!==generation)throw new Error('Локальная сессия закрыта');return new Promise((resolve,reject)=>{const tx=db.transaction(name,'readwrite');const store=tx.objectStore(name);if(name==='projects'&&!record.project.document){const previous=store.get(record.key);previous.onsuccess=()=>store.put({...record,project:{...record.project,...(previous.result?.project?.document?{document:previous.result.project.document}:{})}});}else store.put(record);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Запись отменена'));});}
export const putDocument=(userId,id,state,generation=cacheGeneration(userId))=>guardedWrite('documents',userId,generation,{...state,key:key(userId,id),userId,id,updatedAt:Date.now()});
export const getDocument=(userId,id)=>transact('documents','readonly',s=>s.get(key(userId,id)));
export const removeDocument=(userId,id)=>transact('documents','readwrite',s=>s.delete(key(userId,id)));
export const putProject=(userId,project,generation=cacheGeneration(userId))=>guardedWrite('projects',userId,generation,{key:key(userId,project.id),userId,id:project.id,project,updatedAt:Date.now()});
export async function getProject(userId,id){return (await transact('projects','readonly',s=>s.get(key(userId,id))))?.project;}
export async function listProjects(userId){const records=await transact('projects','readonly',s=>s.index('userId').getAll(userId));return records.map(r=>r.project);}
export async function clearUserData(userId){generations.set(userId,cacheGeneration(userId)+1);const db=await openDatabase();await new Promise((resolve,reject)=>{const tx=db.transaction(['documents','projects'],'readwrite');for(const name of ['documents','projects']){const request=tx.objectStore(name).index('userId').openCursor(IDBKeyRange.only(userId));request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();cursor.continue();}};}tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Очистка отменена'));});}
export async function closeDatabase(){if(connection)(await connection).close();connection=undefined;}
