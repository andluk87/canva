import type {User,Project} from '../api';
import {getProject,putProject,listProjects,clearUserData,cacheGeneration} from './store.mjs';
const USER_KEY='forma.offline.user';const SIGNED_OUT='forma.offline.signed-out';
export function cachedUser():User|null{try{if(localStorage.getItem(SIGNED_OUT))return null;const saved=JSON.parse(localStorage.getItem(USER_KEY)||'null');return saved?.user?.id&&saved.verifiedAt>Date.now()-7*86400000?saved.user:null}catch{return null}}
export function rememberUser(user:User){try{localStorage.removeItem(SIGNED_OUT);localStorage.setItem(USER_KEY,JSON.stringify({user,verifiedAt:Date.now()}))}catch{}}
export function signOutPending(){try{return !!localStorage.getItem(SIGNED_OUT)}catch{return false}}
export function clearSignOutPending(){try{localStorage.removeItem(SIGNED_OUT)}catch{}}
export async function forgetUser(userId?:string,pending=false){try{localStorage.removeItem(USER_KEY);if(pending)localStorage.setItem(SIGNED_OUT,'1');else localStorage.removeItem(SIGNED_OUT)}catch{}if(userId)await clearUserData(userId);}
export async function cacheProject(userId:string,project:Project,generation=cacheGeneration(userId)){if(cachedUser()?.id!==userId)return;try{await putProject(userId,project,generation)}catch{}}
export async function cachedProject(userId:string,id:string){try{return await getProject(userId,id) as Project|undefined}catch{return undefined}}
export async function cachedProjects(userId:string){try{return await listProjects(userId) as Project[]}catch{return []}}
export async function cacheProjects(userId:string,projects:Project[]){const generation=cacheGeneration(userId);for(const project of projects){if(generation!==cacheGeneration(userId)||cachedUser()?.id!==userId)return;await cacheProject(userId,project,generation)}}
