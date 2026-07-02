import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, enableIndexedDbPersistence, collection, doc, getDoc, getDocs,
  addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const VERSION = "v1.3.8";
const DEFAULT_BACKUP_URL = "https://script.google.com/macros/s/AKfycbz7pwTBSDwVwja4ugxvlJoNYb4ksBk7METKzGd3bCARUzea99Sx0BTAJHIDi5N2iW7e/exec";
const COLLECTIONS = [
  "users","branches","dailySales","dailyDrafts","dailyExpenses","cupCounts","dessertOT",
  "attendance","salaryAdvances","ownerExpenses","ownerExpenseTemplates","compensationSettings","compensationRecords",
  "appSettings","auditLogs","backupsMetadata"
];
const ROLE_LABELS = {
  owner:"เจ้าของ",
  manager:"ผู้จัดการ",
  supervisor:"หัวหน้างาน",
  staff:"พนักงาน",
  daily:"รายวัน"
};
const ROLE_ORDER = {owner:1, manager:2, supervisor:3, staff:4, daily:5};
const DEFAULT_BRANCHES = [
  {id:"nongkhai", name:"หนองคาย", active:true, order:1},
  {id:"udonthani", name:"อุดรธานี", active:true, order:2},
  {id:"sriracha", name:"ศรีราชา", active:true, order:3},
  {id:"nakhonphanom", name:"นครพนม", active:true, order:4},
  {id:"booth", name:"ออกบูธ", active:true, order:5}
];
const DEFAULT_SETTINGS = {
  storeName:"Love Matcha",
  primaryColor:"#436b2a",
  secondaryColor:"#eef7e9",
  fontScale:1,
  logoUrl:"./icons/logo.png",
  autoBackup:{mode:"off", intervalMinutes:60, url:DEFAULT_BACKUP_URL},
  advanceAccessUserIds:[],
  dailyWorkerPay:{fullDayAmount:360, hourAmount:40, halfHourAmount:20},
  rendoPartTimePay:{hourAmount:50},
  dailyBonus:{
    nongkhai:{enabled:false, threshold:0, amount:0},
    booth:{enabled:false, threshold:0, amount:0},
    nakhonphanom:{enabled:true, threshold:10000, amount:100},
    udonthani:{enabled:true, threshold:5000, amount:100},
    sriracha:{enabled:true, threshold:5000, amount:100}
  },
  monthlyBonus:{
    allTiers:[{min:100000, amount:1000}],
    selectedBranchIds:["udonthani","sriracha"],
    selectedTiers:[
      {min:90000, amount:900},
      {min:80000, amount:800},
      {min:70000, amount:700},
      {min:60000, amount:600},
      {min:50000, amount:500}
    ]
  },
  dessertItems:[
    {id:"dessert_brownie", name:"บราวนี่", price:45, percent:10},
    {id:"dessert_cookie", name:"คุกกี้", price:35, percent:10},
    {id:"dessert_cake", name:"เค้ก", price:55, percent:10}
  ]
};

const clone = (obj) => (typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));

let appState = {
  firebase:null, auth:null, db:null, authUid:null,
  users:[], branches:[], settings:clone(DEFAULT_SETTINGS),
  currentUser:null, currentPage:"dashboard",
  online:navigator.onLine, charts:{}, backupTimer:null,
  dailyExisting:null, dailyDraftExisting:null, dailyLoadToken:0, restorePreview:null
};

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const content = () => $("#pageContent");

function firebaseConfigReady(config){
  return config && config.apiKey && !String(config.apiKey).includes("ใส่") && config.projectId && !String(config.projectId).includes("ใส่");
}
function safeClone(obj){
  return JSON.parse(JSON.stringify(obj, (_, value) => {
    if (value && typeof value.toDate === "function") return value.toDate().toISOString();
    if (value === undefined) return null;
    return value;
  }));
}
function uid(prefix="id"){
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}
function money(n){
  const v = Number(n || 0);
  return v.toLocaleString("th-TH", {maximumFractionDigits:2});
}
function numberValue(v){
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(String(v).replaceAll(",",""));
  return Number.isFinite(n) ? n : 0;
}
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function todayISO(){
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
}
function currentMonthKey(){ return todayISO().slice(0,7); }
function monthOf(dateISO){ return String(dateISO || "").slice(0,7); }
function thaiDate(iso){
  if(!iso) return "-";
  const d = new Date(`${iso}T00:00:00`);
  const days = ["วันอาทิตย์","วันจันทร์","วันอังคาร","วันพุธ","วันพฤหัสบดี","วันศุกร์","วันเสาร์"];
  return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()+543}`;
}
function thaiMonth(monthKey){
  const [y,m] = String(monthKey || currentMonthKey()).split("-").map(Number);
  const names = ["","มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  return `${names[m]} ${y+543}`;
}
function previousMonthKey(monthKey){
  const [y,m] = String(monthKey || currentMonthKey()).split("-").map(Number);
  const d = new Date(y, (m || 1) - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function formatTs(v){
  if(!v) return "-";
  const d = typeof v.toDate === "function" ? v.toDate() : new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return `${thaiDate(d.toISOString().slice(0,10))} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function showToast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=>t.classList.remove("show"), 3300);
}
function setLoading(msg="กำลังโหลด..."){ content().innerHTML = `<div class="loading">${msg}</div>`; }
function requireOnline(){
  if(!appState.online){
    showToast("ออฟไลน์อยู่ กรุณาต่ออินเตอร์เน็ตก่อน");
    return false;
  }
  return true;
}
function requireRole(roles){
  return appState.currentUser && roles.includes(appState.currentUser.role);
}
function isOwner(){ return appState.currentUser?.role === "owner"; }
function isManager(){ return appState.currentUser?.role === "manager"; }
function isOwnerOrManager(){ return ["owner","manager"].includes(appState.currentUser?.role); }
function isDailyWorker(user=appState.currentUser){ return user?.role === "daily"; }
function canAccessAdvances(user=appState.currentUser){
  if(!user) return false;
  if(["owner","manager"].includes(user.role)) return true;
  return (appState.settings.advanceAccessUserIds || []).includes(user.id);
}
function dailyPaySettings(){
  const p = appState.settings.dailyWorkerPay || DEFAULT_SETTINGS.dailyWorkerPay;
  const legacyHalfHour = numberValue(p.halfHourAmount || 0);
  const hourAmount = numberValue(p.hourAmount || (legacyHalfHour ? legacyHalfHour * 2 : 40));
  return {fullDayAmount:numberValue(p.fullDayAmount || 360), hourAmount, halfHourAmount:hourAmount / 2};
}

function rendoPaySettings(){
  const p = appState.settings.rendoPartTimePay || DEFAULT_SETTINGS.rendoPartTimePay;
  return {hourAmount:numberValue(p.hourAmount || 50)};
}
function isNongkhaiUser(user=appState.currentUser){
  return !!user && ((user.branchIds || []).includes("nongkhai") || user.primaryBranchId === "nongkhai");
}
function rendoTimeOptions(selected=""){
  const out=[];
  for(let minutes=18*60; minutes<=22*60; minutes+=30){
    const h = Math.floor(minutes/60), m = minutes%60;
    const v = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    out.push(`<option value="${v}" ${selected===v?"selected":""}>${v}</option>`);
  }
  return out.join("");
}
function calcRendoPartTimeHours(r){
  if(!r?.rendoPartTime) return 0;
  return Math.max(0, (minutesFromTime(r.rendoEndTime)-minutesFromTime(r.rendoStartTime)) / 60);
}
function calcRendoPartTimePay(r){
  return calcRendoPartTimeHours(r) * rendoPaySettings().hourAmount;
}
function addDaysISO(iso, days){
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate()+days);
  d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
}
function previousDayISO(iso=todayISO()){ return addDaysISO(iso, -1); }
function daysInMonth(monthKey){
  const [y,m] = String(monthKey || currentMonthKey()).split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function monthKeysBetween(startDate, endDate){
  const out=[];
  let [y,m] = String(startDate).slice(0,7).split("-").map(Number);
  const end = String(endDate).slice(0,7);
  while(true){
    const mk = `${y}-${String(m).padStart(2,"0")}`;
    out.push(mk);
    if(mk === end) break;
    m += 1; if(m > 12){ y += 1; m = 1; }
    if(out.length > 36) break;
  }
  return out;
}
function monthStartEnd(monthKey){
  const [y,m]=String(monthKey).split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return {start:`${monthKey}-01`, end:`${monthKey}-${String(last).padStart(2,"0")}`};
}
function selectedBranchIdsFromChecks(selector=".dash-branch-check"){
  const ids = $$(selector+":checked").map(x=>x.value);
  return ids.length ? ids : visibleBranches().map(b=>b.id);
}
function expenseScopeLabel(scope){ return scope === "ALL" ? "รวมทุกสาขา" : (scope === "MULTI" ? "หลายสาขา (แบ่งตาม % ยอดขาย)" : branchName(scope)); }
function salesExpenseTotal(r){ return numberValue(r.milkCost) + numberValue(r.otherExpenseTotal); }
function calculateDessertPayTotalForSale(r){
  if(!r?.otEnabled) return 0;
  return (r.desserts || []).reduce((sum,d)=>{
    const current = dessertItemById(d.itemId) || dessertItemByName(d.name) || {};
    const price = current.name ? numberValue(current.price) : numberValue(d.price);
    const percent = current.name ? numberValue(current.percent) : numberValue(d.percent);
    return sum + price * numberValue(d.qty) * percent / 100;
  },0);
}
function allocateAmountBySales(amount, branchIds, salesByBranch){
  const ids = [...new Set((branchIds || []).filter(Boolean))];
  if(!ids.length || !amount) return [];
  const total = ids.reduce((s,id)=>s+numberValue(salesByBranch[id]),0);
  if(total > 0) return ids.map(id=>({branchId:id, amount:amount * numberValue(salesByBranch[id]) / total}));
  const each = amount / ids.length;
  return ids.map(id=>({branchId:id, amount:each}));
}
function userExpenseBranchIds(user){
  const ids = (user?.branchIds || []).filter(id=>id && id !== "ALL" && activeBranches().some(b=>b.id===id));
  return ids.length ? ids : activeBranches().map(b=>b.id);
}
function branchName(id){ return appState.branches.find(b=>b.id===id)?.name || id || "-"; }
function userName(id){ return appState.users.find(u=>u.id===id)?.name || id || "-"; }
function activeBranches(){ return appState.branches.filter(b=>b.active).sort((a,b)=>(a.order||0)-(b.order||0)); }
function visibleBranches(user=appState.currentUser){
  const branches = activeBranches();
  if(!user) return [];
  if(["owner","manager"].includes(user.role)) return branches;
  return branches.filter(b => (user.branchIds || []).includes(b.id));
}
function canSeeBranch(branchId){
  return visibleBranches().some(b=>b.id===branchId);
}
function roleBadge(role){ return `<span class="badge-role">${ROLE_LABELS[role] || role}</span>`; }
function dessertItemByName(name){
  return (appState.settings.dessertItems || []).find(x=>x.name === name) || null;
}
function dessertItemById(id){
  return (appState.settings.dessertItems || []).find(x=>x.id === id) || null;
}
const HIDDEN_HISTORY_ACTIONS = new Set(["ซ่อนประวัติ", "แสดงประวัติกลับ"]);
const PRIMARY_HISTORY_ACTIONS = ["เพิ่มยอดขาย", "แก้ไขยอดขาย", "เช็คชื่อ"];
function isPrimaryHistoryAction(action=""){
  return PRIMARY_HISTORY_ACTIONS.some(x => String(action || "").includes(x));
}
function safeFileName(name){
  return String(name || "LoveMatcha").replace(/[\\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0,120);
}
function applyTheme(){
  const s = appState.settings || DEFAULT_SETTINGS;
  document.documentElement.style.setProperty("--primary", s.primaryColor || DEFAULT_SETTINGS.primaryColor);
  document.documentElement.style.setProperty("--primary-dark", s.primaryColor || DEFAULT_SETTINGS.primaryColor);
  document.documentElement.style.setProperty("--secondary", s.secondaryColor || DEFAULT_SETTINGS.secondaryColor);
  document.documentElement.style.setProperty("--fontScale", String(s.fontScale || 1));
  $("#loginStoreName").textContent = s.storeName || "Love Matcha";
  $("#appTitle").textContent = s.storeName || "Love Matcha";
  $("#appLogo").src = s.logoUrl || "./icons/logo.png";
  $$(".login-logo").forEach(img => img.src = s.logoUrl || "./icons/logo.png");
}
function updateOnlineUi(){
  const pill = $("#onlinePill");
  if(!pill) return;
  appState.online = navigator.onLine;
  pill.textContent = appState.online ? "ออนไลน์" : "ออฟไลน์";
  pill.className = `pill ${appState.online ? "ok" : "danger"}`;
  $("#offlineBanner").classList.toggle("hidden", appState.online);
  $$(".write-action").forEach(el => el.disabled = !appState.online);

  // ป้องกันข้อมูลมั่วตอน Offline: เปิดดูได้ แต่แก้ไข/บันทึก/ลบ/restore ไม่ได้
  const controls = $$("#pageContent input, #pageContent textarea, #pageContent select");
  controls.forEach(el => {
    if(!appState.online){
      if(el.dataset.offlinePrevDisabled === undefined) el.dataset.offlinePrevDisabled = el.disabled ? "1" : "0";
      el.disabled = true;
      el.classList.add("offline-locked");
    }else if(el.dataset.offlinePrevDisabled !== undefined){
      el.disabled = el.dataset.offlinePrevDisabled === "1";
      delete el.dataset.offlinePrevDisabled;
      el.classList.remove("offline-locked");
    }
  });
  document.body.classList.toggle("is-offline", !appState.online);
}
window.addEventListener("online", updateOnlineUi);
window.addEventListener("offline", updateOnlineUi);

function renderOpenByServerHelp(){
  const area = document.getElementById("loginArea");
  if(!area) return;
  area.innerHTML = `
    <div class="state warn">
      <b>เปิดไฟล์แบบดับเบิลคลิกไม่ได้</b><br>
      ระบบนี้ใช้ Firebase + PWA จึงต้องเปิดผ่าน GitHub Pages หรือเปิดผ่านเซิร์ฟเวอร์จำลองในเครื่อง
      ไม่ควรเปิดด้วย <b>file://index.html</b> เพราะเบราว์เซอร์จะบล็อกไฟล์ JavaScript/Service Worker และทำให้ค้างได้
    </div>
    <div class="panel" style="text-align:left;margin-top:12px">
      <b>วิธีเปิดทดสอบในเครื่องแบบง่าย</b>
      <ol style="padding-left:22px;line-height:1.8">
        <li>แตก ZIP ทั้งโฟลเดอร์</li>
        <li>ดับเบิลคลิกไฟล์ <b>เปิดทดสอบในเครื่อง.bat</b></li>
        <li>เบราว์เซอร์จะเปิด <b>http://localhost:8000</b></li>
      </ol>
      <div class="state warn">ถ้าจะใช้งานจริงหลายเครื่อง ให้เอาขึ้น GitHub Pages ตามคู่มือ README_SETUP_TH.md</div>
    </div>`;
}

async function start(){
  window.__LOVE_MATCHA_APP_BOOTED = true;
  if(location.protocol === "file:"){
    renderOpenByServerHelp();
    return;
  }
  if(!("serviceWorker" in navigator) === false){
    try { await navigator.serviceWorker.register("./sw.js"); } catch(e){ console.warn("SW", e); }
  }
  if(!firebaseConfigReady(window.LOVE_MATCHA_FIREBASE_CONFIG)){
    $("#loginScreen").classList.add("hidden");
    $("#configScreen").classList.remove("hidden");
    return;
  }
  appState.firebase = initializeApp(window.LOVE_MATCHA_FIREBASE_CONFIG);
  appState.auth = getAuth(appState.firebase);
  appState.db = getFirestore(appState.firebase);
  try { await enableIndexedDbPersistence(appState.db); } catch(e){ console.warn("Firestore offline cache:", e.message); }
  onAuthStateChanged(appState.auth, async user => {
    if(user){
      appState.authUid = user.uid;
      await initAfterAuth();
    }
  });
  await signInAnonymously(appState.auth);
}
start().catch(err => {
  console.error(err);
  $("#loginArea").innerHTML = `<div class="state error">เปิดระบบไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
});

async function initAfterAuth(){
  await loadBaseData();
  normalizeSettings();
  applyTheme();
  const users = appState.users.filter(u=>u.active !== false);
  if(users.length === 0) renderFirstSetup();
  else renderLogin();
  updateOnlineUi();
}

async function loadBaseData(){
  const [usersSnap, branchesSnap, settingsSnap] = await Promise.all([
    getDocs(collection(appState.db, "users")),
    getDocs(collection(appState.db, "branches")),
    getDoc(doc(appState.db, "appSettings", "main"))
  ]);
  appState.users = usersSnap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>(ROLE_ORDER[a.role]||9)-(ROLE_ORDER[b.role]||9) || String(a.name).localeCompare(String(b.name),"th"));
  appState.branches = branchesSnap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
  appState.settings = settingsSnap.exists() ? mergeDeep(clone(DEFAULT_SETTINGS), settingsSnap.data()) : clone(DEFAULT_SETTINGS);
}
function mergeDeep(target, source){
  for(const [k,v] of Object.entries(source || {})){
    if(v && typeof v === "object" && !Array.isArray(v) && !(v?.toDate)){
      target[k] = mergeDeep(target[k] || {}, v);
    }else{
      target[k] = v;
    }
  }
  return target;
}
function normalizeSettings(){
  const s = appState.settings || DEFAULT_SETTINGS;
  s.dessertItems = (s.dessertItems || []).map(x=>({
    id:String(x.id || `dessert_${String(x.name || "").trim().replace(/\s+/g,"_")}`),
    name:String(x.name || "").trim(),
    price:numberValue(x.price),
    percent:numberValue(x.percent || 10)
  })).filter(x=>x.name);
  if(!s.dessertItems.length) s.dessertItems = clone(DEFAULT_SETTINGS.dessertItems);
  s.advanceAccessUserIds = Array.isArray(s.advanceAccessUserIds) ? s.advanceAccessUserIds : [];
  const legacyHalfHour = numberValue(s.dailyWorkerPay?.halfHourAmount || 20);
  const hourAmount = numberValue(s.dailyWorkerPay?.hourAmount || (legacyHalfHour ? legacyHalfHour * 2 : 40));
  s.dailyWorkerPay = {fullDayAmount:numberValue(s.dailyWorkerPay?.fullDayAmount || 360), hourAmount, halfHourAmount:hourAmount / 2};
  s.rendoPartTimePay = {hourAmount:numberValue(s.rendoPartTimePay?.hourAmount || 50)};
  appState.settings = mergeDeep(clone(DEFAULT_SETTINGS), s);
  if(!appState.settings.autoBackup) appState.settings.autoBackup = clone(DEFAULT_SETTINGS.autoBackup);
  if(!appState.settings.autoBackup.url) appState.settings.autoBackup.url = DEFAULT_BACKUP_URL;
}

function renderFirstSetup(){
  $("#loginArea").innerHTML = `
    <div class="state warn">ยังไม่มีผู้ใช้ในระบบ กรุณาสร้างเจ้าของคนแรก</div>
    <div class="grid">
      <div class="field"><label>ชื่อเจ้าของ</label><input id="firstName" autocomplete="name" placeholder="เช่น คุณบอส"></div>
      <div class="field"><label>PIN 4 ตัว</label><input id="firstPin" inputmode="numeric" maxlength="4" type="password" placeholder="กรอกตัวเลข 4 ตัว"></div>
      <button id="firstSetupBtn" class="btn full write-action">สร้างระบบครั้งแรก</button>
    </div>`;
  $("#firstSetupBtn").onclick = setupFirstOwner;
}
async function setupFirstOwner(){
  if(!requireOnline()) return;
  const name = $("#firstName").value.trim();
  const pin = $("#firstPin").value.trim();
  if(!name || !/^\d{4}$/.test(pin)) return showToast("กรุณากรอกชื่อและ PIN ตัวเลข 4 ตัว");
  const batch = writeBatch(appState.db);
  DEFAULT_BRANCHES.forEach(b => batch.set(doc(appState.db, "branches", b.id), {...b, createdAt:serverTimestamp(), updatedAt:serverTimestamp()}));
  batch.set(doc(appState.db, "appSettings", "main"), {...DEFAULT_SETTINGS, createdAt:serverTimestamp(), updatedAt:serverTimestamp()});
  batch.set(doc(appState.db, "compensationSettings", "main"), {createdAt:serverTimestamp(), updatedAt:serverTimestamp(), note:"ใช้ appSettings เป็นหลัก"});
  batch.set(doc(appState.db, "users", uid("owner")), {
    name, pin, role:"owner", branchIds:["ALL"], active:true, canViewTeamAttendance:true,
    createdAt:serverTimestamp(), createdBy:"first_setup", updatedAt:serverTimestamp(), updatedBy:"first_setup"
  });
  await batch.commit();
  await addDoc(collection(appState.db, "auditLogs"), {
    action:"first_setup", actorName:name, role:"owner", details:{message:"สร้างระบบครั้งแรก"},
    hidden:false, createdAt:serverTimestamp(), createdAtISO:new Date().toISOString(), authUid:appState.authUid
  });
  showToast("สร้างระบบสำเร็จ");
  await initAfterAuth();
}
function renderLogin(){
  const remembered = JSON.parse(localStorage.getItem("love_matcha_remember_v1") || "{}");
  const users = appState.users.filter(u=>u.active !== false);
  $("#loginArea").innerHTML = `
    <form id="loginForm" class="grid">
      <div class="field">
        <label>เลือกผู้ใช้</label>
        <select id="loginUser">
          ${users.map(u=>`<option value="${u.id}" ${remembered.userId===u.id?"selected":""}>${escapeHtml(u.name)} - ${ROLE_LABELS[u.role] || u.role}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>PIN 4 ตัว</label>
        <input id="loginPin" inputmode="numeric" maxlength="4" type="password" value="${escapeHtml(remembered.pin || "")}" placeholder="••••" autocomplete="current-password">
      </div>
      <label class="check-item"><input id="rememberLogin" type="checkbox" ${remembered.userId?"checked":""}> จดจำ user และ PIN ในเครื่องนี้</label>
      <button class="btn full write-action" type="submit">เข้าสู่ระบบ</button>
    </form>`;
  $("#loginForm").onsubmit = async (e)=>{
    e.preventDefault();
    await login();
  };
}
async function login(){
  const id = $("#loginUser").value;
  const pin = $("#loginPin").value.trim();
  const user = appState.users.find(u=>u.id===id && u.active !== false);
  if(!user) return showToast("ไม่พบผู้ใช้");
  if(String(user.pin) !== pin){
    await audit("login_failed", {selectedUser:user.name}, null, null, {id:user.id, name:user.name, role:user.role});
    return showToast("PIN ไม่ถูกต้อง");
  }
  appState.currentUser = user;
  if($("#rememberLogin").checked){
    localStorage.setItem("love_matcha_remember_v1", JSON.stringify({userId:id, pin}));
  }else localStorage.removeItem("love_matcha_remember_v1");
  await audit("login_success", {user:user.name});
  $("#loginScreen").classList.add("hidden");
  $("#mainApp").classList.remove("hidden");
  buildNav();
  setupAutoBackupTimer();
  const firstPage = NAV.find(n=>n.roles.includes(appState.currentUser.role) && (n.id !== "advances" || canAccessAdvances()))?.id || "daily";
  navigate(firstPage);
}
$("#changePinTopBtn")?.addEventListener("click", openChangePinDialog);
$("#logoutBtn").onclick = ()=>{
  appState.currentUser = null;
  $("#mainApp").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
  renderLogin();
};
function openChangePinDialog(){
  if(!appState.currentUser) return;
  const oldPin = prompt("กรอก PIN เดิม");
  if(oldPin === null) return;
  const newPin = prompt("กรอก PIN ใหม่ 4 ตัว");
  if(newPin === null) return;
  changeOwnPinByValues(String(oldPin).trim(), String(newPin).trim());
}
async function changeOwnPinByValues(oldPin, newPin){
  if(!requireOnline()) return;
  if(String(appState.currentUser.pin) !== oldPin) return showToast("PIN เดิมไม่ถูกต้อง");
  if(!/^\d{4}$/.test(newPin)) return showToast("PIN ใหม่ต้องเป็นตัวเลข 4 ตัว");
  const before = safeClone(appState.currentUser);
  await updateDoc(doc(appState.db, "users", appState.currentUser.id), {pin:newPin, updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id});
  appState.currentUser.pin = newPin;
  await audit("เปลี่ยน PIN", {user:appState.currentUser.name}, {...before, pin:"****"}, {...appState.currentUser, pin:"****"});
  const remembered = JSON.parse(localStorage.getItem("love_matcha_remember_v1") || "{}");
  if(remembered.userId === appState.currentUser.id){
    localStorage.setItem("love_matcha_remember_v1", JSON.stringify({userId:appState.currentUser.id, pin:newPin}));
  }
  showToast("เปลี่ยน PIN สำเร็จ");
  await loadBaseData();
}

async function audit(action, details={}, before=null, after=null, actorOverride=null){
  try{
    const actor = actorOverride || appState.currentUser || {};
    await addDoc(collection(appState.db, "auditLogs"), {
      action, details:safeClone(details), before:safeClone(before), after:safeClone(after),
      actorId:actor.id || null, actorName:actor.name || "ไม่ทราบชื่อ", role:actor.role || null,
      hidden:false, createdAt:serverTimestamp(), createdAtISO:new Date().toISOString(), authUid:appState.authUid
    });
  }catch(e){ console.warn("audit failed", e); }
}
async function afterWrite(actionName){
  if(!appState.settings?.autoBackup) return;
  const mode = appState.settings.autoBackup.mode || "off";
  if(mode === "onAction" || mode === "both"){
    // v1.3.8: ไม่รอ backup ให้เสร็จก่อน เพื่อให้ปุ่ม Save / ส่งยอดตอบสนองเร็วขึ้นและไม่กระตุก
    setTimeout(()=>performBackup(`auto_${actionName}`, true).catch(e=>console.warn("auto backup", e)), 0);
  }
}

const NAV = [
  {id:"dashboard", label:"แดชบอร์ด", icon:"🏠", roles:["owner","manager"]},
  {id:"daily", label:"ยอดขาย", icon:"🧾", roles:["owner","manager","supervisor","staff","daily"]},
  {id:"monthly", label:"รายเดือน", icon:"📅", roles:["owner","manager","supervisor","staff","daily"]},
  {id:"personal", label:"แข่งขัน", icon:"📊", roles:["owner","manager","supervisor","staff"]},
  {id:"attendance", label:"เช็คชื่อ", icon:"✅", roles:["owner","manager","supervisor","staff","daily"]},
  {id:"ownerExpenses", label:"ลงรายจ่าย", icon:"🧮", roles:["owner","manager"]},
  {id:"advances", label:"เบิกเงิน", icon:"💸", roles:["owner","manager","supervisor","staff","daily"]},
  {id:"compensation", label:"ค่าตอบแทน", icon:"💰", roles:["owner","manager"]},
  {id:"history", label:"ประวัติ", icon:"🕘", roles:["owner","manager"]},
  {id:"systemHistory", label:"ระบบ", icon:"🔒", roles:["owner"]},
  {id:"backup", label:"สำรอง", icon:"☁️", roles:["owner"]},
  {id:"users", label:"ผู้ใช้", icon:"👥", roles:["owner","manager","supervisor"]},
  {id:"settings", label:"ตั้งค่า", icon:"⚙️", roles:["owner","manager"]}
];
function buildNav(){
  const nav = $("#bottomNav");
  const items = NAV.filter(n=>n.roles.includes(appState.currentUser.role) && (n.id !== "advances" || canAccessAdvances()));
  nav.innerHTML = items.map(n=>`<button class="nav-item" data-page="${n.id}"><span>${n.icon}</span><b>${n.label}</b></button>`).join("");
  $$(".nav-item", nav).forEach(btn=>btn.onclick=()=>navigate(btn.dataset.page));
}
function navigate(page){
  appState.currentPage = page;
  $$(".nav-item").forEach(b=>b.classList.toggle("active", b.dataset.page===page));
  const renderers = {
    dashboard:renderDashboard, daily:renderDaily, monthly:renderMonthly,
    personal:renderPersonal, attendance:renderAttendance, ownerExpenses:renderOwnerExpenses, advances:renderAdvances,
    compensation:renderCompensation, history:renderHistory, systemHistory:renderSystemHistory, backup:renderBackup, users:renderUsers, settings:renderSettings
  };
  (renderers[page] || renderDashboard)().catch(err=>{
    console.error(err);
    content().innerHTML = `<div class="state error">เกิดข้อผิดพลาด: ${escapeHtml(err.message)}</div>`;
  });
  updateOnlineUi();
}
function pageTitle(title, sub=""){
  return `<div class="page-title"><div><h2>${title}</h2>${sub?`<p>${sub}</p>`:""}</div><span class="pill muted">${ROLE_LABELS[appState.currentUser.role]}: ${escapeHtml(appState.currentUser.name)}</span></div>`;
}
function branchOptions({includeAll=false, selected=""}={}){
  let b = visibleBranches();
  const allOpt = includeAll && isOwnerOrManager() ? `<option value="ALL" ${selected==="ALL"?"selected":""}>รวมทุกสาขา</option>` : "";
  return allOpt + b.map(x=>`<option value="${x.id}" ${selected===x.id?"selected":""}>${escapeHtml(x.name)}</option>`).join("");
}
function personalBranchOptions(selected="ALL"){
  const b = visibleBranches();
  return `<option value="ALL" ${selected==="ALL"?"selected":""}>รวมทุกสาขา</option>` + b.map(x=>`<option value="${x.id}" ${selected===x.id?"selected":""}>${escapeHtml(x.name)}</option>`).join("");
}
function usersForBranch(branchId){
  return appState.users.filter(u => u.active !== false && ["manager","supervisor","staff","daily"].includes(u.role) && (
    u.role === "manager" || (u.branchIds || []).includes(branchId) || (u.branchIds || []).includes("ALL")
  )).sort((a,b)=>(ROLE_ORDER[a.role]||9)-(ROLE_ORDER[b.role]||9) || String(a.name).localeCompare(String(b.name),"th"));
}
async function getSalesForMonth(monthKey, branchId="ALL", options={}){
  const snap = await getDocs(query(collection(appState.db, "dailySales"), where("monthKey", "==", monthKey)));
  let rows = snap.docs.map(d=>({id:d.id, ...d.data()}));
  if(branchId !== "ALL") rows = rows.filter(r=>r.branchId === branchId);
  else if(!options.allBranches) rows = rows.filter(r=>isOwnerOrManager() || canSeeBranch(r.branchId));
  return rows.sort((a,b)=>String(a.date).localeCompare(String(b.date)) || String(a.branchId).localeCompare(String(b.branchId)));
}
async function getSalesForRange(startDate, endDate, branchIds=null, options={}){
  const months = monthKeysBetween(startDate, endDate);
  const snaps = await Promise.all(months.map(mk=>getDocs(query(collection(appState.db, "dailySales"), where("monthKey", "==", mk)))));
  let rows = snaps.flatMap(snap=>snap.docs.map(d=>({id:d.id, ...d.data()})));
  rows = rows.filter(r=>String(r.date) >= startDate && String(r.date) <= endDate);
  const ids = branchIds && branchIds.length ? branchIds : (isOwnerOrManager() ? activeBranches().map(b=>b.id) : visibleBranches().map(b=>b.id));
  rows = rows.filter(r=>ids.includes(r.branchId));
  if(!options.allBranches) rows = rows.filter(r=>isOwnerOrManager() || canSeeBranch(r.branchId));
  return rows.sort((a,b)=>String(a.date).localeCompare(String(b.date)) || String(a.branchId).localeCompare(String(b.branchId)));
}
function aggregateSales(rows){
  const open = rows.filter(r=>!r.closed);
  return {
    totalAll: open.reduce((s,r)=>s+numberValue(r.totalAll),0),
    net: open.reduce((s,r)=>s+numberValue(r.netSales),0),
    lineMan: open.reduce((s,r)=>s+numberValue(r.lineMan),0),
    grab: open.reduce((s,r)=>s+numberValue(r.grab),0),
    milk: open.reduce((s,r)=>s+numberValue(r.milkCost),0),
    milkCashOut: open.reduce((s,r)=>s+numberValue(r.milkCashOut ?? r.milkCost),0),
    expense: open.reduce((s,r)=>s+numberValue(r.otherExpenseTotal),0),
    expenseCashOut: open.reduce((s,r)=>s+numberValue(r.otherExpenseCashOut ?? r.otherExpenseTotal),0),
    salesExpenseTotal: open.reduce((s,r)=>s+salesExpenseTotal(r),0),
    ownerCashOut: open.reduce((s,r)=>s+numberValue(r.ownerCashOut),0),
    cashDiff: open.reduce((s,r)=>s+numberValue(r.cashDiff),0),
    cupsUsed: open.reduce((s,r)=>s+numberValue(r.cupsUsed),0),
    openDays: open.length,
    closedDays: rows.filter(r=>r.closed).length
  };
}
function kpis(items){
  return `<div class="kpi-grid">${items.map(x=>`<div class="kpi"><small>${x.label}</small><b>${x.value}</b>${x.sub?`<div class="sub">${x.sub}</div>`:""}</div>`).join("")}</div>`;
}
async function computeCompensationSummary(monthKey){
  const payUsers = appState.users.filter(u=>u.active!==false && ["supervisor","staff","daily"].includes(u.role));
  const {rows, totals, bySelectedBonusBranch} = await computePersonalSales(monthKey, "ALL");
  const dailyBonus = {};
  rows.filter(r=>!r.closed).forEach(r=>{
    const rule = appState.settings.dailyBonus?.[r.branchId] || {};
    if(rule.enabled && numberValue(r.totalAll) > numberValue(rule.threshold)){
      (r.workerIds || []).forEach(id=> dailyBonus[id] = (dailyBonus[id] || 0) + numberValue(rule.amount));
    }
  });
  const monthlyBonus = {};
  payUsers.forEach(u=>{
    if(!["supervisor","staff"].includes(u.role)){ monthlyBonus[u.id] = 0; return; }
    const allTotal = totals[u.id] || 0;
    const selectedTotal = bySelectedBonusBranch[u.id] || 0;
    let b = 0;
    for(const t of appState.settings.monthlyBonus?.allTiers || []) if(allTotal > numberValue(t.min)) b = Math.max(b, numberValue(t.amount));
    if(!b){ for(const t of appState.settings.monthlyBonus?.selectedTiers || []) if(selectedTotal > numberValue(t.min)) b = Math.max(b, numberValue(t.amount)); }
    monthlyBonus[u.id] = b;
  });
  const dessertOT = {};
  rows.filter(r=>r.otEnabled).forEach(r=>{
    const workers = r.otWorkerIds || [];
    const per = workers.length ? calculateDessertPayTotalForSale(r) / workers.length : 0;
    workers.forEach(id => dessertOT[id] = (dessertOT[id] || 0) + per);
  });
  const attSnap = await getDocs(query(collection(appState.db, "attendance"), where("monthKey","==",monthKey)));
  const dailyWages = {}, rendoOT = {};
  attSnap.docs.map(d=>d.data()).forEach(r=>{
    const u = appState.users.find(x=>x.id===r.userId);
    if(u?.role === "daily"){
      if(!dailyWages[r.userId]) dailyWages[r.userId] = {full:0, hourly:0, total:0};
      const pay = calcDailyAttendancePay(r);
      if((r.workType || "full") === "hourly") dailyWages[r.userId].hourly += pay;
      else dailyWages[r.userId].full += pay;
      dailyWages[r.userId].total += pay;
    }
    if(r.rendoPartTime) rendoOT[r.userId] = (rendoOT[r.userId] || 0) + calcRendoPartTimePay(r);
  });
  const advSnap = await getDocs(query(collection(appState.db, "salaryAdvances"), where("monthKey","==",monthKey)));
  const advances = {};
  advSnap.docs.map(d=>d.data()).forEach(r=>advances[r.userId]=(advances[r.userId]||0)+numberValue(r.amount));
  const [compSnap, prevCompSnap] = await Promise.all([
    getDocs(query(collection(appState.db, "compensationRecords"), where("monthKey","==",monthKey))),
    getDocs(query(collection(appState.db, "compensationRecords"), where("monthKey","==",previousMonthKey(monthKey))))
  ]);
  const records = {}, prevRecords = {};
  compSnap.docs.forEach(d=>records[d.data().userId]=({id:d.id, ...d.data()}));
  prevCompSnap.docs.forEach(d=>prevRecords[d.data().userId]=({id:d.id, ...d.data()}));
  const result = {};
  payUsers.forEach(u=>{
    const r = records[u.id] || {};
    const isDaily = u.role === "daily";
    let salary = 0, dailyFullWageBeforeExclude=0, dailyHourlyWageBeforeExclude=0;
    if(isDaily){
      const wage = dailyWages[u.id] || {full:0, hourly:0, total:0};
      const fullPaid = !!(r.dailyFullPaidAlready ?? r.dailyPaidAlready);
      const hourlyPaid = !!(r.dailyHourlyPaidAlready ?? r.dailyPaidAlready);
      dailyFullWageBeforeExclude = numberValue(wage.full);
      dailyHourlyWageBeforeExclude = numberValue(wage.hourly);
      salary = (fullPaid ? 0 : dailyFullWageBeforeExclude) + (hourlyPaid ? 0 : dailyHourlyWageBeforeExclude);
    }else{
      const prevSalary = prevRecords[u.id]?.salary;
      salary = numberValue((r.salary !== undefined && r.salary !== null && r.salary !== "") ? r.salary : (prevSalary ?? 0));
    }
    const otOther = numberValue(r.otOther);
    const dessert = numberValue(dessertOT[u.id]);
    const boothBonus = numberValue(r.boothBonus);
    const rendo = numberValue(rendoOT[u.id]);
    const daily = isDaily ? 0 : numberValue(dailyBonus[u.id]);
    const monthly = isDaily ? 0 : numberValue(monthlyBonus[u.id]);
    const deduction = numberValue(r.deduction);
    const advance = numberValue(advances[u.id]);
    const employeeSS = isDaily ? 0 : salary * .05;
    const employerSS = isDaily ? 0 : salary * .05;
    const netTransfer = salary + otOther + dessert + boothBonus + rendo + daily + monthly - deduction - advance - employeeSS;
    const totalCost = salary + otOther + dessert + boothBonus + rendo + daily + monthly - deduction + employerSS;
    result[u.id] = {user:u, record:r, salary, otOther, dessertOT:dessert, boothBonus, rendoOT:rendo, dailyBonus:daily, monthlyBonus:monthly, deduction, advances:advance, employeeSS, employerSS, netTransfer, totalCost, dailyFullWageBeforeExclude, dailyHourlyWageBeforeExclude};
  });
  return result;
}
async function computeOwnerExpenseAllocationsForMonth(monthKey){
  const rows = await getSalesForMonth(monthKey, "ALL", {allBranches:true});
  const salesByBranch = {};
  activeBranches().forEach(b=>salesByBranch[b.id]=0);
  rows.filter(r=>!r.closed).forEach(r=>salesByBranch[r.branchId]=(salesByBranch[r.branchId]||0)+numberValue(r.totalAll));
  const allocations = [], directItems = [];
  const addAllocated = (source)=>{
    const scopeIds = source.scope === "ALL" ? activeBranches().map(b=>b.id) : [source.scope];
    const pieces = allocateAmountBySales(numberValue(source.amount), scopeIds, salesByBranch);
    pieces.forEach(p=>allocations.push({...source, branchId:p.branchId, allocatedAmount:p.amount}));
    directItems.push(source);
  };
  const comp = await computeCompensationSummary(monthKey);
  Object.values(comp).forEach(c=>{
    if(!c.totalCost) return;
    const ids = userExpenseBranchIds(c.user);
    const source = {kind:"payroll", monthKey, date:`${monthKey}-01`, name:`ค่าตอบแทน ${c.user.name}`, amount:numberValue(c.totalCost), scope:ids.length===activeBranches().length?"ALL":(ids.length===1?ids[0]:"MULTI"), sourceUserId:c.user.id, note:"ดึงจากค่าตอบแทน: ต้นทุนรวม+ปกส."};
    const pieces = allocateAmountBySales(source.amount, ids, salesByBranch);
    pieces.forEach(p=>allocations.push({...source, branchId:p.branchId, allocatedAmount:p.amount}));
    directItems.push(source);
  });
  const [tplSnap, expSnap] = await Promise.all([
    getDocs(collection(appState.db, "ownerExpenseTemplates")),
    getDocs(query(collection(appState.db, "ownerExpenses"), where("monthKey","==",monthKey)))
  ]);
  tplSnap.docs.map(d=>({id:d.id, ...d.data()})).filter(t=>t.active!==false).forEach(t=>addAllocated({kind:"recurring", id:t.id, monthKey, date:`${monthKey}-01`, name:t.name, amount:numberValue(t.amount), scope:t.scope || "ALL", note:t.note || "รายจ่ายประจำ"}));
  expSnap.docs.map(d=>({id:d.id, ...d.data()})).forEach(e=>addAllocated({kind:"other", id:e.id, monthKey, date:e.date, name:e.name, amount:numberValue(e.amount), scope:e.scope || "ALL", note:e.note || ""}));
  const byBranch = {};
  activeBranches().forEach(b=>byBranch[b.id]=0);
  allocations.forEach(a=>byBranch[a.branchId]=(byBranch[a.branchId]||0)+numberValue(a.allocatedAmount));
  return {monthKey, allocations, directItems, byBranch, total:Object.values(byBranch).reduce((s,v)=>s+v,0), salesByBranch};
}
async function computeOwnerExpenseAllocationsForRange(startDate, endDate, branchIds=null){
  const months = monthKeysBetween(startDate, endDate);
  const results = await Promise.all(months.map(m=>computeOwnerExpenseAllocationsForMonth(m)));
  const byBranch = {}, selected = branchIds && branchIds.length ? branchIds : activeBranches().map(b=>b.id);
  selected.forEach(id=>byBranch[id]=0);
  const allocations=[];
  results.forEach(res=>res.allocations.forEach(a=>{
    if(a.date && (String(a.date) < startDate || String(a.date) > endDate) && a.kind === "other") return;
    if(selected.includes(a.branchId)){
      allocations.push(a);
      byBranch[a.branchId]=(byBranch[a.branchId]||0)+numberValue(a.allocatedAmount);
    }
  }));
  return {allocations, byBranch, total:Object.values(byBranch).reduce((s,v)=>s+v,0)};
}

async function renderDashboard(){
  const monthKey = currentMonthKey();
  const {start,end} = monthStartEnd(monthKey);
  const branches = visibleBranches();
  content().innerHTML = `
    ${pageTitle("Dashboard", "เลือกช่วงวันที่และสาขาได้")}
    <div class="panel dashboard-filter-panel">
      <div class="grid three compact-grid">
        <div class="field"><label>ตั้งแต่วันที่</label><input id="dashStart" type="date" value="${start}"></div>
        <div class="field"><label>ถึงวันที่</label><input id="dashEnd" type="date" value="${end}"></div>
        <div class="field"><label>&nbsp;</label><button id="dashThisMonth" type="button" class="btn secondary">เดือนนี้</button></div>
      </div>
      <div class="field"><label>เลือกสาขาที่ต้องการแสดง</label><div class="check-list branch-check-grid">${branches.map(b=>`<label class="check-item"><input class="dash-branch-check" type="checkbox" value="${b.id}" checked> ${escapeHtml(b.name)}</label>`).join("")}</div></div>
      <button id="reloadDashboard" class="btn write-action">โหลด Dashboard</button>
    </div>
    <div id="dashboardResult"><div class="loading">กำลังคำนวณ...</div></div>`;
  const reload=()=>loadDashboardResult().catch(e=>{$("#dashboardResult").innerHTML=`<div class="state error">คำนวณไม่สำเร็จ: ${escapeHtml(e.message)}</div>`;});
  $("#reloadDashboard").onclick = reload;
  $("#dashStart").onchange = reload;
  $("#dashEnd").onchange = reload;
  $$(".dash-branch-check").forEach(x=>x.onchange=reload);
  $("#dashThisMonth").onclick = ()=>{ const m=currentMonthKey(); const r=monthStartEnd(m); $("#dashStart").value=r.start; $("#dashEnd").value=r.end; $$(".dash-branch-check").forEach(x=>x.checked=true); reload(); };
  await loadDashboardResult();
}
async function loadDashboardResult(){
  const startDate = $("#dashStart").value, endDate = $("#dashEnd").value;
  if(!startDate || !endDate || startDate > endDate) return showToast("กรุณาเลือกช่วงวันที่ให้ถูกต้อง");
  const branchIds = selectedBranchIdsFromChecks();
  $("#dashboardResult").innerHTML = `<div class="loading">กำลังคำนวณ...</div>`;
  const [rows, ownerExpense] = await Promise.all([
    getSalesForRange(startDate, endDate, branchIds),
    computeOwnerExpenseAllocationsForRange(startDate, endDate, branchIds)
  ]);
  const ag = aggregateSales(rows);
  const ownerExpenseTotal = numberValue(ownerExpense.total);
  const profitAfterExpenses = ag.totalAll - ag.salesExpenseTotal - ownerExpenseTotal;
  const latest = rows.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)) || String(branchName(a.branchId)).localeCompare(String(branchName(b.branchId)),"th")).slice(0,12);
  $("#dashboardResult").innerHTML = `
    ${kpis([
      {label:"รายได้รวมทั้งเดือน/ช่วง", value:`${money(ag.totalAll)} บาท`, sub:`${startDate} ถึง ${endDate}`},
      {label:"รายจ่ายรวมทั้งเดือน", value:`${money(ag.salesExpenseTotal)} บาท`, sub:"ค่านม + รายจ่ายในหน้ายอดขาย"},
      {label:"รายจ่ายเจ้าของลง", value:`${money(ownerExpenseTotal)} บาท`, sub:"รวมเงินเดือน/รายวัน/ประจำ/รายจ่ายอื่น"},
      {label:"เอาเงินสดให้เจ้าของ", value:`${money(ag.ownerCashOut)} บาท`},
      {label:"จำนวนแก้วที่ใช้รวม", value:`${money(ag.cupsUsed)} ใบ`},
      {label:"รายได้หลังหักค่าใช้จ่าย", value:`${money(profitAfterExpenses)} บาท`, sub:"รายได้รวม - รายจ่ายรวม - รายจ่ายเจ้าของลง"}
    ])}
    <div class="panel">
      <div class="flex"><h3>กราฟรายได้ตามสาขา</h3><span class="pill muted">เลือกไว้ ${branchIds.length} สาขา</span></div>
      <div id="branchChartBox" class="canvas-box"><canvas id="branchChart"></canvas></div>
    </div>
    <div class="panel">
      <h3>รายการล่าสุด</h3>
      ${salesLatestTable(latest)}
    </div>`;
  const labels = branchIds.map(branchName);
  const values = branchIds.map(id=>aggregateSales(rows.filter(r=>r.branchId===id)).totalAll);
  drawBar("branchChart", labels, values, "รายได้รวมทั้งหมด");
}
function salesLatestTable(rows){
  if(!rows.length) return `<div class="empty">ยังไม่มีข้อมูล</div>`;
  return `<div class="table-wrap sales-table-wrap"><table class="sales-table mobile-card-table">
    <thead><tr><th>วันที่</th><th>สาขา</th><th>สถานะ</th><th class="money">รายได้รวมทั้งหมด</th><th class="money">รายจ่ายรวมทั้งหมด</th><th class="money">เอาเงินสดให้เจ้าของ</th><th class="money">เงินสดขาด/เกิน</th><th>หมายเหตุ</th></tr></thead>
    <tbody>${rows.map(r=>`<tr class="${r.closed?"closed-short-row":""}">
      <td data-label="วันที่">${thaiDate(r.date)}</td>
      <td data-label="สาขา">${escapeHtml(branchName(r.branchId))}</td>
      <td data-label="สถานะ">${r.closed?`<span class="pill warn">หยุดร้าน</span>`:`<span class="pill ok">เปิดร้าน</span>`}</td>
      <td data-label="รายได้รวมทั้งหมด" class="money">${money(r.totalAll)}</td>
      <td data-label="รายจ่ายรวมทั้งหมด" class="money">${money(salesExpenseTotal(r))}</td>
      <td data-label="เอาเงินสดให้เจ้าของ" class="money">${money(r.ownerCashOut)}</td>
      <td data-label="เงินสดขาด/เกิน" class="money">${money(r.cashDiff)}</td>
      <td data-label="หมายเหตุ">${escapeHtml(r.note||"")}</td>
    </tr>`).join("")}</tbody></table></div>`;
}
function salesTable(rows, options={}){
  if(!rows.length) return `<div class="empty">ยังไม่มีข้อมูล</div>`;
  const showDetails = !!options.details;
  return `<div class="table-wrap sales-table-wrap"><table class="sales-table">
    <thead><tr><th>วันที่</th><th>สาขา</th><th>สถานะ</th><th class="money">รายได้รวมทั้งหมด</th><th class="money">รายจ่ายรวมทั้งหมด</th><th class="money">เอาเงินสดให้เจ้าของ</th><th class="money">เงินสดขาด/เกิน</th><th>หมายเหตุ</th>${showDetails?`<th>รายละเอียด</th>`:""}</tr></thead>
    <tbody>${rows.map((r,i)=>{
      if(r.closed){
        const note = r.note ? ` · ${escapeHtml(r.note)}` : "";
        return `<tr class="sales-main-row closed-short-row">
          <td data-label="วันที่">${thaiDate(r.date)}</td>
          <td data-label="สาขา">${escapeHtml(branchName(r.branchId))}</td>
          <td data-label="สถานะ"><span class="pill warn">หยุดร้าน</span></td>
          <td data-label="สรุป" colspan="${showDetails?6:5}" class="closed-short-cell"><b>หยุดร้าน</b>${note}</td>
        </tr>`;
      }
      return `<tr class="sales-main-row">
        <td data-label="วันที่">${thaiDate(r.date)}</td><td data-label="สาขา">${escapeHtml(branchName(r.branchId))}</td>
        <td data-label="สถานะ"><span class="pill ok">เปิดร้าน</span></td>
        <td data-label="รายได้รวมทั้งหมด" class="money">${money(r.totalAll)}</td>
        <td data-label="รายจ่ายรวมทั้งหมด" class="money">${money(salesExpenseTotal(r))}</td>
        <td data-label="เอาเงินสดให้เจ้าของ" class="money">${money(r.ownerCashOut)}</td>
        <td data-label="เงินสดขาด/เกิน" class="money">${money(r.cashDiff)}</td>
        <td data-label="หมายเหตุ">${escapeHtml(r.note||"")}</td>
        ${showDetails?`<td data-label="รายละเอียด"><button type="button" class="btn secondary small monthly-detail-btn" data-detail="${i}">แสดงรายละเอียด</button></td>`:""}
      </tr>
      ${showDetails?`<tr class="monthly-detail-row hidden" data-detail="${i}"><td colspan="9" class="monthly-detail-cell">${monthlySalesDetailHtml(r)}</td></tr>`:""}`;
    }).join("")}</tbody></table></div>`;
}

function monthlySalesDetailHtml(r){
  const expenses = r.expenses || [];
  const milkCash = numberValue(r.milkCashOut ?? r.milkCost);
  const expenseCash = numberValue(r.otherExpenseCashOut ?? r.otherExpenseTotal);
  const totalExpense = numberValue(r.milkCost) + numberValue(r.otherExpenseTotal);
  const paymentMismatch = numberValue(r.paymentMismatch);
  const detailRow = (label, value, strong=false) => `<tr${strong?' class="strong-row"':''}><th>${label}</th><td>${value}</td></tr>`;
  const workerNames = (r.workerNames||[]).map(escapeHtml).join(", ") || "-";
  const salesRows = [
    detailRow("พนักงานในกะ", workerNames),
    detailRow("ยอดขายก่อนส่วนลด", `<span class="money-value">${money(r.grossSales)} บาท</span>`),
    detailRow("ส่วนลด", `<span class="money-value">${money(r.discount)} บาท</span>`),
    detailRow("รายได้รวม", `<span class="money-value">${money(r.netSales)} บาท</span>`),
    detailRow("เงินสด", `<span class="money-value">${money(r.cashSales)} บาท</span>`),
    detailRow("เงินโอน", `<span class="money-value">${money(r.transferSales)} บาท</span>`),
    detailRow("Line Man", `<span class="money-value">${money(r.lineMan)} บาท</span>`),
    detailRow("Grab", `<span class="money-value">${money(r.grab)} บาท</span>`),
    detailRow("เงินสด+โอน ขาด/เกิน", `<span class="money-value">${money(paymentMismatch)} บาท</span>`),
    detailRow("รายได้รวมทั้งหมด", `<span class="money-value"><b>${money(r.totalAll)} บาท</b></span>`, true)
  ].join("");
  const cashRows = [
    detailRow("เงินสดเปิดกะ", `<span class="money-value">${money(r.cashOpen)} บาท</span>`),
    detailRow("เงินสดปิดกะ", `<span class="money-value">${money(r.cashClose)} บาท</span>`),
    detailRow("ค่านมรวม", `<span class="money-value">${money(r.milkCost)} บาท</span>`),
    detailRow("นมวัว", `<span class="money-value">${money(r.cowMilkCost ?? r.milkCost)} บาท ${r.cowMilkPaidTransfer?"(โอนจ่าย)":""}</span>`),
    detailRow("นมโอ๊ต", `<span class="money-value">${money(r.oatMilkCost)} บาท ${r.oatMilkPaidTransfer?"(โอนจ่าย)":""}</span>`),
    detailRow("ค่านมที่หักเงินสด", `<span class="money-value">${money(milkCash)} บาท</span>`),
    detailRow("รายจ่ายอื่นรวม", `<span class="money-value">${money(r.otherExpenseTotal)} บาท</span>`),
    detailRow("รายจ่ายที่หักเงินสด", `<span class="money-value">${money(expenseCash)} บาท</span>`),
    detailRow("รายจ่ายรวมทั้งหมด", `<span class="money-value"><b>${money(totalExpense)} บาท</b></span>`, true),
    detailRow("เอาเงินสดให้เจ้าของ", `<span class="money-value"><b>${money(r.ownerCashOut)} บาท</b></span>`, true),
    detailRow("เงินสดที่ควรเหลือ", `<span class="money-value">${money(r.cashShouldRemain)} บาท</span>`),
    detailRow("เงินสดขาด/เกิน", `<span class="money-value">${money(r.cashDiff)} บาท</span>`)
  ].join("");
  const expensesHtml = expenses.length
    ? `<div class="detail-expense-grid">${expenses.map(e=>`<div class="detail-mini-item"><b>${escapeHtml(e.name||e.detail||"รายจ่ายอื่น")}</b><span>${money(e.amount)} บาท</span><small>${e.paidByTransfer?"โอนจ่าย — ไม่หักเงินสด":"เงินสด — หักเงินสด"}${e.note?` · ${escapeHtml(e.note)}`:""}</small></div>`).join("")}</div>`
    : `<div class="empty compact">ไม่มีรายจ่ายอื่น</div>`;
  const notes = [
    r.paymentMismatchReason ? `<b>เหตุผลเงินสด+โอนไม่ตรง:</b> ${escapeHtml(r.paymentMismatchReason)}` : "",
    r.cashDiffReason ? `<b>สาเหตุเงินสดขาด/เกิน:</b> ${escapeHtml(r.cashDiffReason)}` : "",
    r.note ? `<b>หมายเหตุ:</b> ${escapeHtml(r.note)}` : ""
  ].filter(Boolean);
  return `<div class="monthly-detail-card">
    <div class="monthly-detail-toolbar"><b>รายละเอียด ${thaiDate(r.date)}</b><button type="button" class="btn ghost small monthly-detail-close">ปิด/ซ่อนรายละเอียด</button></div>
    <div class="monthly-detail-scroll" aria-label="เลื่อนซ้ายขวาเพื่อดูรายละเอียด">
      <div class="monthly-detail-columns">
        <section class="detail-table-card sales-detail-card">
          <h4>🧾 ตารางยอดขาย</h4>
          <table class="detail-table"><tbody>${salesRows}</tbody></table>
        </section>
        <section class="detail-table-card cash-detail-card">
          <h4>💵 ตารางเงินสด / รายจ่าย</h4>
          <table class="detail-table"><tbody>${cashRows}</tbody></table>
        </section>
        <section class="detail-table-card expense-detail-card">
          <h4>🧺 รายจ่ายอื่น ๆ</h4>
          ${expensesHtml}
        </section>
      </div>
    </div>
    ${notes.length ? `<div class="detail-notes">${notes.map(n=>`<div>${n}</div>`).join("")}</div>` : ""}
  </div>`;
}
function bindMonthlyDetailButtons(){
  $$(".monthly-detail-btn").forEach(btn=>{
    btn.onclick = ()=>{
      const row = $(`.monthly-detail-row[data-detail="${btn.dataset.detail}"]`);
      if(!row) return;
      const isHidden = row.classList.toggle("hidden");
      btn.textContent = isHidden ? "แสดงรายละเอียด" : "ซ่อนรายละเอียด";
    };
  });
  $$(".monthly-detail-close").forEach(btn=>{
    btn.onclick = ()=>{
      const row = btn.closest(".monthly-detail-row");
      if(!row) return;
      row.classList.add("hidden");
      const key = row.dataset.detail;
      const opener = $(`.monthly-detail-btn[data-detail="${key}"]`);
      if(opener) opener.textContent = "แสดงรายละเอียด";
      opener?.scrollIntoView({behavior:"smooth", block:"center"});
    };
  });
}
function drawBar(canvasId, labels, values, label){
  const el = document.getElementById(canvasId);
  if(!el) return;
  const box = el.parentElement;
  if(window.Chart){
    if(appState.charts[canvasId]) appState.charts[canvasId].destroy();
    appState.charts[canvasId] = new Chart(el, {
      type:"bar",
      data:{labels, datasets:[{label, data:values}]},
      options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}}}
    });
  }else{
    const max = Math.max(...values, 1);
    box.innerHTML = `<div class="fallback-bars">${labels.map((x,i)=>`<div class="fallback-bar"><b>${escapeHtml(x)}</b><div class="bar"><span style="width:${Math.max(3,(values[i]/max)*100)}%"></span></div><span>${money(values[i])}</span></div>`).join("")}</div>`;
  }
}

async function renderDaily(){
  const b = visibleBranches()[0];
  const date = todayISO();
  content().innerHTML = `
    ${pageTitle("บันทึกยอดขายรายวัน")}
    <div id="previousSalesWarn"></div>
    <form id="dailyForm" class="daily-form-wide">
      <div class="panel daily-panel daily-panel-head daily-control-panel">
        <h3>วันที่ / สาขา / สถานะร้าน</h3>
        <div class="daily-control-grid">
          <div class="field"><label>เดือน</label><input id="dailyMonth" type="month" value="${date.slice(0,7)}"></div>
          <div class="field"><label>วันที่</label><input id="dailyDate" type="date" value="${date}"><small id="dailyThaiDate">${thaiDate(date)}</small></div>
          <div class="field"><label>สาขา</label><select id="dailyBranch">${branchOptions({selected:b?.id})}</select></div>
          <label class="check-item daily-closed-control"><input id="dailyClosed" type="checkbox"> หยุดร้านวันนี้</label>
        </div>
      </div>

      <div id="openShopFields">
        <div class="panel daily-panel daily-section staff-section">
          <h3>👥 พนักงานในกะ</h3>
          <small>เลือกคนที่ทำงานจริง 1-4 คน</small>
          <div id="workersBox" class="check-list" style="margin-top:8px"></div>
        </div>

        <div class="panel daily-panel daily-section sales-section">
          <h3>🧾 ข้อมูลยอดขาย</h3>
          <div class="grid three">
            <div class="field"><label>ยอดขายก่อนส่วนลด</label><input id="grossSales" inputmode="decimal" class="calc-money" placeholder="0"></div>
            <div class="field"><label>ส่วนลด</label><input id="discount" inputmode="decimal" class="calc-money" placeholder="0"></div>
            <div class="field"><label>รายได้รวม</label><input id="netSales" disabled></div>
            <div class="field"><label>เงินสด</label><input id="cashSales" inputmode="decimal" class="calc-money" placeholder="0"></div>
            <div class="field"><label>เงินโอน</label><input id="transferSales" inputmode="decimal" class="calc-money" placeholder="0"></div>
            <div class="field"><label>เหตุผลถ้าเงินสด+โอนไม่ตรง</label><input id="paymentMismatchReason" placeholder="เช่น มีค้างชำระ / กรอกผิด"></div>
            <div class="field"><label>Line Man</label><input id="lineMan" inputmode="decimal" class="calc-money" placeholder="0"></div>
            <div class="field"><label>Grab</label><input id="grab" inputmode="decimal" class="calc-money" placeholder="0"></div>
            <div class="field"><label>รายได้รวมทั้งหมด</label><input id="totalAll" disabled></div>
            <div class="field"><label>ยอดขายเฉลี่ยต่อคน</label><input id="avgPerPerson" disabled></div>
          </div>
          <div id="salesWarn"></div>
        </div>

        <div class="panel daily-panel daily-section cash-section">
          <h3>💵 ข้อมูลเงินสด / รายจ่าย</h3>
          <div class="grid three">
            <div class="field"><label>เงินสดเปิดกะ</label><input id="cashOpen" inputmode="decimal" class="calc-money" placeholder="0"></div>
            <div class="field"><label>เงินสดปิดกะ</label><input id="cashClose" inputmode="decimal" class="calc-money" placeholder="0"></div>
            <div class="field pay-field"><label>ค่านมวัว</label><input id="cowMilkCost" inputmode="decimal" class="calc-money" placeholder="0"><label class="inline-check"><input id="cowMilkPaidTransfer" type="checkbox" class="calc-money"> โอนจ่าย ไม่หักเงินสด</label></div>
            <div class="field pay-field"><label>ค่านมโอ๊ต</label><input id="oatMilkCost" inputmode="decimal" class="calc-money" placeholder="0"><label class="inline-check"><input id="oatMilkPaidTransfer" type="checkbox" class="calc-money"> โอนจ่าย ไม่หักเงินสด</label></div>
            <div class="field"><label>เอาเงินสดออกให้เจ้าของ</label><input id="ownerCashOut" inputmode="decimal" class="calc-money" placeholder="0"></div>
            <div class="field"><label>เงินสดที่ควรเหลือ</label><input id="cashShouldRemain" disabled></div>
            <div class="field"><label>เงินสดขาด/เกิน</label><input id="cashDiff" disabled></div>
          </div>
          <div class="divider"></div>
          <div class="flex"><b>รายจ่ายอื่น ๆ</b><button id="addExpenseBtn" type="button" class="btn secondary small write-action">+ เพิ่มรายการ</button></div>
          <div id="expensesBox" class="grid" style="margin-top:8px"></div>
          <div class="field" style="margin-top:10px"><label>สาเหตุถ้าเงินสดขาด/เกิน</label><input id="cashDiffReason" placeholder="บังคับกรอกถ้าไม่ตรง"></div>
          <div id="cashWarn"></div>
        </div>

        <div class="panel daily-panel daily-section cup-section">
          <h3>🥤 ข้อมูลแก้ว</h3>
          <div class="grid three">
            <div class="field"><label>แก้วคงเหลือวันก่อน</label><input id="prevCupRemain" inputmode="numeric" class="calc-money" placeholder="0"><small>ระบบพยายามดึงให้อัตโนมัติ แต่แก้ได้</small></div>
            <div class="field"><label>แก้วเพิ่มวันนี้</label><input id="cupsAdded" inputmode="numeric" class="calc-money" placeholder="0"></div>
            <div class="field"><label>แก้วคงเหลือวันนี้</label><input id="cupsRemain" inputmode="numeric" class="calc-money" placeholder="0"></div>
            <div class="field"><label>แก้วที่ใช้จริง</label><input id="cupsUsed" disabled></div>
            <div class="field"><label>หมายเหตุแก้ว</label><input id="cupNote" placeholder="กรอกถ้าคำนวณติดลบ"></div>
          </div>
          <div id="cupWarn"></div>
        </div>

        <div class="panel daily-panel daily-section ot-section">
          <h3>🍰 OT ทำขนม</h3>
          <label class="check-item"><input id="otEnabled" type="checkbox"> เปิดช่อง OT ทำขนมวันนี้</label>
          <div id="otFields" class="hidden">
            <div class="field" style="margin-top:10px"><label>คนที่ทำ OT</label><div id="otWorkersBox" class="check-list"></div></div>
            <div class="flex" style="margin-top:10px"><b>รายการขนม</b><button id="addDessertBtn" type="button" class="btn secondary small write-action">+ เพิ่มรายการขนม</button></div>
            <div id="dessertsBox" class="grid" style="margin-top:8px"></div>
            <div id="otSummary" class="state ok"></div>
          </div>
        </div>
      </div>

      <div class="panel daily-panel daily-section note-section">
        <h3>📝 หมายเหตุ</h3>
        <textarea id="dailyNote" placeholder="บันทึกเพิ่มเติมของวันนั้น"></textarea>
      </div>
      <div id="existingWarn"></div>
      <div class="sticky-save grid two"><button id="saveDraftDailyBtn" type="button" class="btn secondary full write-action">บันทึกชั่วคราว</button><button id="saveDailyBtn" type="submit" class="btn full write-action">บันทึกยอดขายเข้าระบบจริง</button></div>
    </form>`;
  bindDaily();
}
function bindDaily(){
  $("#dailyDate").onchange = ()=>{ $("#dailyThaiDate").textContent = thaiDate($("#dailyDate").value); $("#dailyMonth").value = $("#dailyDate").value.slice(0,7); loadExistingDaily(); };
  $("#dailyMonth").onchange = ()=>{ const m=$("#dailyMonth").value; if(m) $("#dailyDate").value = `${m}-01`; $("#dailyThaiDate").textContent = thaiDate($("#dailyDate").value); loadExistingDaily(); };
  $("#dailyBranch").onchange = ()=>{ refreshDailyWorkers(); loadExistingDaily(); };
  $("#dailyClosed").onchange = ()=>{ $("#openShopFields").classList.toggle("hidden", $("#dailyClosed").checked); recalcDaily(); };
  $("#addExpenseBtn").onclick = ()=>addExpenseRow();
  $("#addDessertBtn").onclick = ()=>addDessertRow();
  $("#otEnabled").onchange = ()=>{ $("#otFields").classList.toggle("hidden", !$("#otEnabled").checked); recalcDaily(); };
  $("#dailyForm").oninput = (e)=>{ if(e.target.matches(".calc-money") || e.target.type==="checkbox") recalcDaily(); };
  $("#saveDraftDailyBtn").onclick = saveDailyDraft;
  $("#dailyForm").onsubmit = saveDaily;
  refreshDailyWorkers();
  addExpenseRow();
  addDessertRow();
  loadExistingDaily();
  loadDailyMissingSalesWarning();
  updateOnlineUi();
}
async function loadDailyMissingSalesWarning(){
  const box = $("#previousSalesWarn");
  if(!box) return;
  const date = previousDayISO();
  const branches = visibleBranches();
  try{
    const snaps = await Promise.all(branches.map(b=>getDoc(doc(appState.db, "dailySales", `${b.id}_${date}`))));
    const missing = branches.filter((b,i)=>!snaps[i].exists());
    box.innerHTML = missing.length ? `<div class="state warn"><b>เตือนยอดขายเมื่อวาน (${thaiDate(date)}) ยังไม่ครบ</b><br>ยังไม่ได้ลงข้อมูลหรือกดหยุดร้าน: ${missing.map(b=>escapeHtml(b.name)).join(", ")}<br>กรุณาย้อนกลับไปเลือกวันที่เมื่อวาน แล้วบันทึกยอดขายหรือเลือก “หยุดร้านวันนี้” ให้ครบทุกสาขา</div>` : "";
  }catch(e){ console.warn(e); box.innerHTML = ""; }
}
function refreshDailyWorkers(selected=[]){
  const branchId = $("#dailyBranch").value;
  const users = usersForBranch(branchId);
  const html = users.map(u=>`<label class="check-item"><input class="workerCheck" type="checkbox" value="${u.id}" ${selected.includes(u.id)?"checked":""}> ${escapeHtml(u.name)} ${roleBadge(u.role)}</label>`).join("") || `<div class="empty">ยังไม่มีผู้ใช้ในสาขานี้</div>`;
  $("#workersBox").innerHTML = html;
  $("#otWorkersBox").innerHTML = users.map(u=>`<label class="check-item"><input class="otWorkerCheck" type="checkbox" value="${u.id}"> ${escapeHtml(u.name)}</label>`).join("");
  $$(".workerCheck").forEach(x=>x.onchange=()=>{ syncOTWorkers(); recalcDaily(); });
  $$(".otWorkerCheck").forEach(x=>x.onchange=recalcDaily);
}
function syncOTWorkers(){
  const selected = $$(".workerCheck:checked").map(x=>x.value);
  $$(".otWorkerCheck").forEach(x=>{ if(selected.includes(x.value)) x.checked = true; });
}
function addExpenseRow(row={}){
  const id = uid("exp");
  const div = document.createElement("div");
  div.className = "grid three expense-row";
  div.dataset.id = id;
  div.innerHTML = `
    <div class="field"><label>ชื่อรายการ</label><input class="exp-name" value="${escapeHtml(row.name||"")}" placeholder="เช่น ซื้อของ / ค่าขนส่ง"></div>
    <div class="field pay-field"><label>จำนวนเงิน</label><input class="exp-amount calc-money" inputmode="decimal" value="${row.amount ?? ""}" placeholder="0"><label class="inline-check"><input class="exp-transfer calc-money" type="checkbox" ${row.paidByTransfer?"checked":""}> โอนจ่าย ไม่หักเงินสด</label></div>
    <div class="field"><label>หมายเหตุ</label><div class="flex"><input class="exp-note" value="${escapeHtml(row.note||"")}" placeholder="-"><button type="button" class="btn ghost small write-action remove-row">ลบ</button></div></div>`;
  $("#expensesBox").appendChild(div);
  $(".remove-row", div).onclick = ()=>{ div.remove(); recalcDaily(); };
  div.oninput = recalcDaily;
  updateOnlineUi();
}
function addDessertRow(row={}){
  const items = appState.settings.dessertItems || [];
  const selectedItem = row.itemId ? dessertItemById(row.itemId) : dessertItemByName(row.name || row.itemName || "");
  const selectedId = selectedItem?.id || "";
  const options = items.map(x=>`<option value="${escapeHtml(x.id)}" ${selectedId===x.id?"selected":""}>${escapeHtml(x.name)}</option>`).join("");
  const div = document.createElement("div");
  div.className = "panel dessert-row";
  div.style.margin = "8px 0";
  div.innerHTML = `
    <div class="grid three">
      <div class="field"><label>ทำขนมอะไร</label><select class="dessert-name"><option value="">เลือกขนม</option>${options}</select></div>
      <div class="field"><label>กี่ชิ้น / กี่หน่วย</label><input class="dessert-qty calc-money" inputmode="decimal" value="${row.qty ?? ""}" placeholder="0"></div>
      <div class="field"><label>หมายเหตุ</label><div class="flex"><input class="dessert-note" value="${escapeHtml(row.note||"")}" placeholder="-"><button type="button" class="btn ghost small write-action remove-row">ลบ</button></div></div>
    </div>`;
  $("#dessertsBox").appendChild(div);
  if(!items.length){
    $(".dessert-name", div).innerHTML = `<option value="">ยังไม่มีชนิดขนมในระบบ</option>`;
  }
  $(".remove-row", div).onclick = ()=>{ div.remove(); recalcDaily(); };
  div.oninput = recalcDaily;
  $(".dessert-name", div).onchange = recalcDaily;
  updateOnlineUi();
}
function collectDailyForm(){
  const closed = $("#dailyClosed").checked;
  const workerIds = $$(".workerCheck:checked").map(x=>x.value).slice(0,4);
  const expenses = $$(".expense-row").map(r=>{
    const amount = numberValue($(".exp-amount",r).value);
    const paidByTransfer = !!$(".exp-transfer",r)?.checked;
    return {id:r.dataset.id, name:$(".exp-name",r).value.trim(), amount, paidByTransfer, cashAmount:paidByTransfer?0:amount, note:$(".exp-note",r).value.trim()};
  }).filter(x=>x.name || x.amount || x.note);
  const desserts = $$(".dessert-row").map(r=>{
    const itemId = $(".dessert-name",r).value.trim();
    const item = dessertItemById(itemId) || {};
    const name = item.name || "";
    return {id:uid("dessert"), itemId, name, price:numberValue(item.price), qty:numberValue($(".dessert-qty",r).value), percent:numberValue(item.percent), note:$(".dessert-note",r).value.trim()};
  }).filter(x=>x.name || x.qty || x.note);
  const otWorkerIds = $$(".otWorkerCheck:checked").map(x=>x.value);
  const grossSales = numberValue($("#grossSales").value);
  const discount = numberValue($("#discount").value);
  const netSales = grossSales - discount;
  const cashSales = numberValue($("#cashSales").value);
  const transferSales = numberValue($("#transferSales").value);
  const lineMan = numberValue($("#lineMan").value);
  const grab = numberValue($("#grab").value);
  const totalAll = netSales + lineMan + grab;
  const otherExpenseTotal = expenses.reduce((s,x)=>s+numberValue(x.amount),0);
  const otherExpenseCashOut = expenses.reduce((s,x)=>s+numberValue(x.cashAmount),0);
  const cashOpen = numberValue($("#cashOpen").value);
  const cashClose = numberValue($("#cashClose").value);
  const cowMilkCost = numberValue($("#cowMilkCost").value);
  const oatMilkCost = numberValue($("#oatMilkCost").value);
  const cowMilkPaidTransfer = !!$("#cowMilkPaidTransfer")?.checked;
  const oatMilkPaidTransfer = !!$("#oatMilkPaidTransfer")?.checked;
  const milkCost = cowMilkCost + oatMilkCost;
  const milkCashOut = (cowMilkPaidTransfer?0:cowMilkCost) + (oatMilkPaidTransfer?0:oatMilkCost);
  const ownerCashOut = numberValue($("#ownerCashOut").value);
  const cashShouldRemain = cashOpen + cashSales - milkCashOut - otherExpenseCashOut - ownerCashOut;
  const cashDiff = cashClose - cashShouldRemain;
  const prevCupRemain = numberValue($("#prevCupRemain").value);
  const cupsAdded = numberValue($("#cupsAdded").value);
  const cupsRemain = numberValue($("#cupsRemain").value);
  const cupsUsed = prevCupRemain + cupsAdded - cupsRemain;
  const dessertPayTotal = $("#otEnabled").checked ? desserts.reduce((s,x)=>s+(x.price*x.qty*x.percent/100),0) : 0;
  const dessertPayPerPerson = otWorkerIds.length ? dessertPayTotal / otWorkerIds.length : 0;
  const result = {
    date:$("#dailyDate").value, monthKey:monthOf($("#dailyDate").value), branchId:$("#dailyBranch").value, closed,
    workerIds, workerNames:workerIds.map(userName), workerCount:workerIds.length,
    grossSales, discount, netSales, cashSales, transferSales,
    paymentMismatch: Math.round((cashSales+transferSales-netSales)*100)/100,
    paymentMismatchReason:$("#paymentMismatchReason").value.trim(),
    lineMan, grab, totalAll, avgPerPerson: workerIds.length ? totalAll/workerIds.length : 0,
    cashOpen, cashClose, cowMilkCost, cowMilkPaidTransfer, oatMilkCost, oatMilkPaidTransfer, milkCost, milkCashOut, ownerCashOut, expenses, otherExpenseTotal, otherExpenseCashOut, cashShouldRemain, cashDiff,
    cashDiffReason:$("#cashDiffReason").value.trim(),
    prevCupRemain, cupsAdded, cupsRemain, cupsUsed, cupNote:$("#cupNote").value.trim(),
    otEnabled:$("#otEnabled").checked, otWorkerIds, otWorkerNames:otWorkerIds.map(userName), desserts, dessertPayTotal, dessertPayPerPerson,
    note:$("#dailyNote").value.trim()
  };
  return closed ? normalizeClosedDailyData(result) : result;
}
function normalizeClosedDailyData(d){
  return {
    date:d.date, monthKey:d.monthKey, branchId:d.branchId, closed:true,
    workerIds:[], workerNames:[], workerCount:0,
    grossSales:0, discount:0, netSales:0, cashSales:0, transferSales:0,
    paymentMismatch:0, paymentMismatchReason:"", lineMan:0, grab:0, totalAll:0, avgPerPerson:0,
    cashOpen:0, cashClose:0, cowMilkCost:0, cowMilkPaidTransfer:false, oatMilkCost:0, oatMilkPaidTransfer:false, milkCost:0, milkCashOut:0, ownerCashOut:0, expenses:[], otherExpenseTotal:0, otherExpenseCashOut:0, cashShouldRemain:0, cashDiff:0, cashDiffReason:"",
    prevCupRemain:0, cupsAdded:0, cupsRemain:0, cupsUsed:0, cupNote:"",
    otEnabled:false, otWorkerIds:[], otWorkerNames:[], desserts:[], dessertPayTotal:0, dessertPayPerPerson:0,
    note:d.note || ""
  };
}
function recalcDaily(){
  const d = collectDailyForm();
  $("#netSales").value = money(d.netSales);
  $("#totalAll").value = money(d.totalAll);
  $("#avgPerPerson").value = money(d.avgPerPerson);
  $("#cashShouldRemain").value = money(d.cashShouldRemain);
  $("#cashDiff").value = money(d.cashDiff);
  $("#cupsUsed").value = money(d.cupsUsed);
  const warns = [];
  if(!d.closed && Math.abs(d.paymentMismatch) > 0.009) warns.push(`เงินสด + เงินโอน ไม่เท่ากับรายได้รวม ต่าง ${money(d.paymentMismatch)} บาท ต้องกรอกเหตุผล`);
  if(!d.closed && d.workerCount < 1) warns.push("ต้องเลือกพนักงานในกะอย่างน้อย 1 คน");
  if(!d.closed && d.workerCount > 4) warns.push("เลือกพนักงานในกะได้ไม่เกิน 4 คน");
  $("#salesWarn").innerHTML = warns.length ? `<div class="state warn">${warns.join("<br>")}</div>` : "";
  $("#cashWarn").innerHTML = (!d.closed && Math.abs(d.cashDiff) > 0.009) ? `<div class="state warn">เงินสดขาด/เกิน ${money(d.cashDiff)} บาท ต้องกรอกสาเหตุ</div>` : "";
  $("#cupWarn").innerHTML = (!d.closed && d.cupsUsed < 0) ? `<div class="state warn">แก้วที่ใช้จริงติดลบ ต้องตรวจสอบและกรอกหมายเหตุ</div>` : "";
  $("#otSummary").innerHTML = `บันทึกจำนวนขนมแล้ว ระบบจะคำนวณเงิน OT ในหน้า “ค่าตอบแทน” ตามชนิดขนม/ราคา/% ที่เจ้าของหรือผู้จัดการตั้งไว้`;
}
function clearDailyForm(){
  const ids = ["grossSales","discount","cashSales","transferSales","paymentMismatchReason","lineMan","grab","cashOpen","cashClose","cowMilkCost","oatMilkCost","ownerCashOut","cashDiffReason","prevCupRemain","cupsAdded","cupsRemain","cupNote","dailyNote"];
  ids.forEach(id=>{ const el = document.getElementById(id); if(el) el.value = ""; });
  ["netSales","totalAll","avgPerPerson","cashShouldRemain","cashDiff","cupsUsed"].forEach(id=>{ const el = document.getElementById(id); if(el) el.value = ""; });
  const closed = $("#dailyClosed");
  if(closed) closed.checked = false;
  $("#openShopFields")?.classList.remove("hidden");
  $$(".workerCheck,.otWorkerCheck").forEach(x=>x.checked=false);
  ["cowMilkPaidTransfer","oatMilkPaidTransfer"].forEach(id=>{ const el=document.getElementById(id); if(el) el.checked=false; });
  const expensesBox = $("#expensesBox");
  if(expensesBox){ expensesBox.innerHTML = ""; addExpenseRow(); }
  const dessertsBox = $("#dessertsBox");
  if(dessertsBox){ dessertsBox.innerHTML = ""; addDessertRow(); }
  const otEnabled = $("#otEnabled");
  if(otEnabled) otEnabled.checked = false;
  $("#otFields")?.classList.add("hidden");
  ["salesWarn","cashWarn","cupWarn","existingWarn"].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=""; });
}
async function loadPreviousOpeningDefaults(options={}){
  const branchId = $("#dailyBranch").value;
  const date = $("#dailyDate").value;
  if(!branchId || !date) return;
  try{
    const snap = await getDocs(query(collection(appState.db, "dailySales"), where("branchId", "==", branchId)));
    if(options.token && options.token !== appState.dailyLoadToken) return;
    const prev = snap.docs.map(d=>d.data()).filter(r=>r.date < date && !r.closed).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
    if(prev){
      if(options.force || !$("#cashOpen").value) $("#cashOpen").value = numberValue(prev.cashClose);
      if(options.force || !$("#prevCupRemain").value) $("#prevCupRemain").value = numberValue(prev.cupsRemain);
    }
    recalcDaily();
  }catch(e){ console.warn(e); }
}
async function loadExistingDaily(){
  const branchId = $("#dailyBranch").value, date=$("#dailyDate").value;
  if(!branchId || !date) return;
  const token = ++appState.dailyLoadToken;
  appState.dailyExisting = null;
  appState.dailyDraftExisting = null;
  clearDailyForm();
  await loadPreviousOpeningDefaults({force:true, token});
  if(token !== appState.dailyLoadToken) return;
  const id = `${branchId}_${date}`;
  const [saleSnap, draftSnap] = await Promise.all([
    getDoc(doc(appState.db, "dailySales", id)),
    getDoc(doc(appState.db, "dailyDrafts", id))
  ]);
  if(token !== appState.dailyLoadToken) return;
  appState.dailyExisting = saleSnap.exists() ? {id:saleSnap.id, ...saleSnap.data()} : null;
  appState.dailyDraftExisting = draftSnap.exists() ? {id:draftSnap.id, ...draftSnap.data()} : null;
  const warns = [];
  if(appState.dailyExisting) warns.push("วันนี้/สาขานี้มีข้อมูลที่บันทึกเข้าระบบจริงแล้ว ถ้าบันทึกยอดขายจะเป็นการแก้ไขข้อมูลเดิม ระบบจะถามยืนยันก่อน");
  if(appState.dailyDraftExisting && !appState.dailyExisting) warns.push("พบข้อมูลบันทึกชั่วคราวของวันนี้ ระบบโหลดขึ้นมาให้แล้ว แต่ยังไม่ถูกนำไปคำนวณรายวัน/รายเดือนจนกว่าจะกดบันทึกยอดขายเข้าระบบจริง");
  if(appState.dailyDraftExisting && appState.dailyExisting) warns.push("มีข้อมูลชั่วคราวค้างอยู่ด้วย แต่ระบบแสดงข้อมูลจริงก่อน หากต้องการใช้ข้อมูลชั่วคราวให้แก้ใหม่แล้วกดบันทึกชั่วคราวอีกครั้ง");
  $("#existingWarn").innerHTML = warns.length ? `<div class="state warn">${warns.join("<br>")}</div>` : "";
  if(appState.dailyExisting) fillDailyForm(appState.dailyExisting);
  else if(appState.dailyDraftExisting) fillDailyForm(appState.dailyDraftExisting.data || appState.dailyDraftExisting);
  recalcDaily();
}
function setInputValue(id, value){
  const el = document.getElementById(id);
  if(el) el.value = value ?? "";
}
function fillDailyForm(d){
  if(!d) return;
  const closed = !!d.closed;
  $("#dailyClosed").checked = closed;
  $("#openShopFields").classList.toggle("hidden", closed);
  setInputValue("dailyNote", d.note || "");
  if(closed) return;
  refreshDailyWorkers(d.workerIds || []);
  const fieldMap = {
    grossSales:"grossSales", discount:"discount", cashSales:"cashSales", transferSales:"transferSales", paymentMismatchReason:"paymentMismatchReason",
    lineMan:"lineMan", grab:"grab", cashOpen:"cashOpen", cashClose:"cashClose", ownerCashOut:"ownerCashOut",
    cashDiffReason:"cashDiffReason", prevCupRemain:"prevCupRemain", cupsAdded:"cupsAdded", cupsRemain:"cupsRemain", cupNote:"cupNote"
  };
  Object.entries(fieldMap).forEach(([key,id])=>setInputValue(id, d[key] ?? ""));
  setInputValue("cowMilkCost", d.cowMilkCost ?? d.milkCost ?? "");
  setInputValue("oatMilkCost", d.oatMilkCost ?? "");
  const cowChk = $("#cowMilkPaidTransfer"), oatChk = $("#oatMilkPaidTransfer");
  if(cowChk) cowChk.checked = !!d.cowMilkPaidTransfer;
  if(oatChk) oatChk.checked = !!d.oatMilkPaidTransfer;
  const expensesBox = $("#expensesBox");
  if(expensesBox){
    expensesBox.innerHTML = "";
    (d.expenses || []).length ? (d.expenses || []).forEach(addExpenseRow) : addExpenseRow();
  }
  const dessertsBox = $("#dessertsBox");
  if(dessertsBox){
    dessertsBox.innerHTML = "";
    (d.desserts || []).length ? (d.desserts || []).forEach(addDessertRow) : addDessertRow();
  }
  $("#otEnabled").checked = !!d.otEnabled;
  $("#otFields").classList.toggle("hidden", !d.otEnabled);
  $$(".otWorkerCheck").forEach(x=>{ x.checked = (d.otWorkerIds || []).includes(x.value); });
  recalcDaily();
}
function validateDaily(d){
  if(!d.date || !d.branchId) return "กรุณาเลือกวันที่และสาขา";
  if(!canSeeBranch(d.branchId)) return "คุณไม่มีสิทธิ์บันทึกสาขานี้";
  if(d.closed) return "";
  if(d.workerCount < 1) return "ต้องเลือกพนักงานในกะอย่างน้อย 1 คน";
  if(d.workerCount > 4) return "เลือกพนักงานในกะได้ไม่เกิน 4 คน";
  if(Math.abs(d.paymentMismatch) > 0.009 && !d.paymentMismatchReason) return "เงินสด+เงินโอนไม่ตรงรายได้รวม กรุณากรอกเหตุผล";
  if(Math.abs(d.cashDiff) > 0.009 && !d.cashDiffReason) return "เงินสดขาด/เกิน กรุณากรอกสาเหตุ";
  if(d.cupsUsed < 0 && !d.cupNote) return "แก้วที่ใช้จริงติดลบ กรุณากรอกหมายเหตุ";
  if(d.otEnabled && d.desserts.length && d.otWorkerIds.length < 1) return "เปิด OT ทำขนมแล้ว กรุณาเลือกคนที่ทำ OT";
  return "";
}
async function saveDaily(e){
  e.preventDefault();
  if(!requireOnline()) return;
  const data = collectDailyForm();
  const err = validateDaily(data);
  if(err) return showToast(err);
  const id = `${data.branchId}_${data.date}`;
  const ref = doc(appState.db, "dailySales", id);
  const beforeSnap = await getDoc(ref);
  const before = beforeSnap.exists() ? {id:beforeSnap.id, ...beforeSnap.data()} : null;
  if(before && !confirm(`วันที่ ${thaiDate(data.date)} สาขา ${branchName(data.branchId)} มีข้อมูลแล้ว ต้องการแก้ไขทับใช่ไหม?`)) return;
  const nowISO = new Date().toISOString();
  const nowFields = before
    ? {updatedAt:serverTimestamp(), updatedAtISO:nowISO, updatedBy:appState.currentUser.id, updatedByName:appState.currentUser.name}
    : {createdAt:serverTimestamp(), createdAtISO:nowISO, createdBy:appState.currentUser.id, createdByName:appState.currentUser.name, updatedAt:serverTimestamp(), updatedAtISO:nowISO, updatedBy:appState.currentUser.id, updatedByName:appState.currentUser.name};
  const batch = writeBatch(appState.db);
  batch.set(ref, {...data, ...nowFields});
  // mirror collections for easier backup/export; วันหยุดร้านต้องล้างข้อมูลยอด/แก้วออกจาก collection ย่อย
  if(data.closed) batch.delete(doc(appState.db, "cupCounts", id));
  else batch.set(doc(appState.db, "cupCounts", id), {dailySalesId:id, branchId:data.branchId, date:data.date, monthKey:data.monthKey, prevCupRemain:data.prevCupRemain, cupsAdded:data.cupsAdded, cupsRemain:data.cupsRemain, cupsUsed:data.cupsUsed, updatedAt:serverTimestamp()}, {merge:true});
  for(const old of (before?.expenses || [])){ if(old.id) batch.delete(doc(appState.db, "dailyExpenses", `${id}_${old.id}`)); }
  for(const exp of data.expenses){ batch.set(doc(appState.db, "dailyExpenses", `${id}_${exp.id}`), {...exp, dailySalesId:id, branchId:data.branchId, date:data.date, monthKey:data.monthKey, updatedAt:serverTimestamp()}); }
  for(const old of (before?.desserts || [])){ if(old.id) batch.delete(doc(appState.db, "dessertOT", `${id}_${old.id}`)); }
  for(const dessert of data.desserts){ batch.set(doc(appState.db, "dessertOT", `${id}_${dessert.id}`), {...dessert, dailySalesId:id, branchId:data.branchId, date:data.date, monthKey:data.monthKey, otWorkerIds:data.otWorkerIds, dessertPayTotal:(dessert.price*dessert.qty*dessert.percent/100), updatedAt:serverTimestamp()}); }
  batch.delete(doc(appState.db, "dailyDrafts", id));
  await batch.commit();
  await audit(before ? "แก้ไขยอดขาย" : "เพิ่มยอดขาย", {date:data.date, branch:branchName(data.branchId)}, before, data);
  await afterWrite("daily_sales");
  showToast(data.closed ? "บันทึกหยุดร้านแล้ว และล้างข้อมูลยอดของวันนั้นแล้ว" : "บันทึกยอดขายสำเร็จ");
  await loadExistingDaily();
}

async function saveDailyDraft(){
  if(!requireOnline()) return;
  const data = collectDailyForm();
  if(!data.date || !data.branchId) return showToast("กรุณาเลือกวันที่และสาขา");
  if(!canSeeBranch(data.branchId)) return showToast("คุณไม่มีสิทธิ์บันทึกสาขานี้");
  const id = `${data.branchId}_${data.date}`;
  const before = await getDoc(doc(appState.db, "dailyDrafts", id));
  const draft = {
    id, date:data.date, monthKey:data.monthKey, branchId:data.branchId,
    data:safeClone(data), savedTemporarily:true,
    updatedAt:serverTimestamp(), updatedAtISO:new Date().toISOString(),
    updatedBy:appState.currentUser.id, updatedByName:appState.currentUser.name
  };
  if(!before.exists()){
    draft.createdAt = serverTimestamp();
    draft.createdAtISO = new Date().toISOString();
    draft.createdBy = appState.currentUser.id;
    draft.createdByName = appState.currentUser.name;
  }
  await setDoc(doc(appState.db, "dailyDrafts", id), draft, {merge:true});
  await audit("บันทึกยอดขายชั่วคราว", {date:data.date, branch:branchName(data.branchId)}, before.exists()?before.data():null, draft);
  await afterWrite("daily_draft");
  showToast("บันทึกชั่วคราวแล้ว ยังไม่นำไปคำนวณรายวัน/รายเดือน");
  await loadExistingDaily();
}

async function renderMonthly(){
  const monthKey = currentMonthKey();
  content().innerHTML = `
    ${pageTitle("สรุปรายเดือน", "เลือกเดือนและสาขาเพื่อดูยอดรวม")}
    <div class="panel">
      <div class="grid three">
        <div class="field"><label>เดือน</label><input id="monthSelect" type="month" value="${monthKey}"></div>
        <div class="field"><label>สาขา</label><select id="summaryBranch">${branchOptions({includeAll:true, selected:isOwnerOrManager()?"ALL":visibleBranches()[0]?.id})}</select></div>
        <div class="field"><label>&nbsp;</label><button id="reloadMonthly" class="btn secondary">โหลดสรุป</button></div>
      </div>
    </div>
    <div id="monthlyResult"></div>`;
  $("#reloadMonthly").onclick = loadMonthlyResult;
  $("#monthSelect").onchange = loadMonthlyResult;
  $("#summaryBranch").onchange = loadMonthlyResult;
  await loadMonthlyResult();
}
async function loadMonthlyResult(){
  const monthKey = $("#monthSelect").value;
  const branchId = $("#summaryBranch").value;
  $("#monthlyResult").innerHTML = `<div class="loading">กำลังคำนวณ...</div>`;
  const rows = await getSalesForMonth(monthKey, branchId);
  const displayRows = rows.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)) || String(a.branchId).localeCompare(String(b.branchId)));
  const ag = aggregateSales(rows);
  $("#monthlyResult").innerHTML = `
    ${kpis([
      {label:"รายได้รวมทั้งหมด", value:`${money(ag.totalAll)} บาท`},
      {label:"ค่านมรวม", value:`${money(ag.milk)} บาท`},
      {label:"รายจ่ายอื่น ๆ รวม", value:`${money(ag.expense)} บาท`},
      {label:"เอาเงินสดให้เจ้าของรวม", value:`${money(ag.ownerCashOut)} บาท`},
      {label:"เงินสดขาด/เกินรวม", value:`${money(ag.cashDiff)} บาท`},
      {label:"จำนวนแก้วที่ใช้รวม", value:`${money(ag.cupsUsed)} ใบ`},
      {label:"เปิดร้าน", value:`${ag.openDays} วัน`},
      {label:"หยุดร้าน", value:`${ag.closedDays} วัน`}
    ])}
    <div class="panel monthly-branch-panel">
      <div class="flex">
        <h3>ตารางรายวันแยกตามสาขา</h3>
        <button id="exportMonthlyCsv" class="btn secondary small">Export CSV</button>
        <button id="exportMonthlyJson" class="btn secondary small">Export JSON</button>
      </div>
      ${monthlyBranchTables(displayRows, branchId)}
    </div>`;
  $("#exportMonthlyCsv").onclick = ()=>downloadText(`LoveMatcha_${monthKey}_${branchId}.csv`, dailyRowsToCsv(rows), "text/csv");
  $("#exportMonthlyJson").onclick = ()=>downloadText(`LoveMatcha_${monthKey}_${branchId}.json`, JSON.stringify(rows, null, 2), "application/json");
  bindMonthlyDetailButtons();
}
function monthlyBranchTables(rows, selectedBranchId="ALL"){
  const branches = (selectedBranchId === "ALL" ? visibleBranches() : activeBranches().filter(b=>b.id===selectedBranchId && canSeeBranch(b.id)));
  const hasAny = rows.length > 0;
  if(!branches.length) return `<div class="empty">ไม่มีสาขาที่มีสิทธิ์ดู</div>`;
  return branches.map(branch=>{
    const branchRows = rows.filter(r=>r.branchId === branch.id).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    if(!branchRows.length && hasAny && selectedBranchId === "ALL") return "";
    return `<section class="monthly-branch-block">
      <div class="monthly-branch-head"><h3>${escapeHtml(branch.name)}</h3><span class="pill muted">${branchRows.length} รายการ</span></div>
      ${monthlyRowsTable(branchRows, branch.id)}
    </section>`;
  }).join("") || `<div class="empty">ยังไม่มีข้อมูลในเดือนนี้</div>`;
}
function monthlyRowsTable(rows, branchId){
  if(!rows.length) return `<div class="empty compact">ยังไม่มีข้อมูลสาขานี้</div>`;
  return `<div class="table-wrap monthly-simple-wrap"><table class="monthly-simple-table">
    <colgroup>
      <col class="monthly-col-date">
      <col class="monthly-col-staff">
      <col class="monthly-col-money">
      <col class="monthly-col-money">
      <col class="monthly-col-owner">
      <col class="monthly-col-detail">
    </colgroup>
    <thead><tr><th>วันที่</th><th>ชื่อพนักงานในกะ</th><th class="money">รายได้รวมทั้งหมด</th><th class="money">รายจ่ายรวมทั้งหมด</th><th class="money">เงินสดให้เจ้าของ</th><th>รายละเอียด</th></tr></thead>
    <tbody>${rows.map((r,i)=>{
      const key = `${branchId}_${i}`;
      if(r.closed){
        return `<tr class="monthly-main-row closed-short-row"><td data-label="วันที่">${thaiDate(r.date)}</td><td data-label="สรุป" colspan="5" class="closed-short-cell"><b>หยุดร้าน</b>${r.note?` · ${escapeHtml(r.note)}`:""}</td></tr>`;
      }
      const totalExpense = numberValue(r.milkCost) + numberValue(r.otherExpenseTotal);
      return `<tr class="monthly-main-row">
        <td data-label="วันที่">${thaiDate(r.date)}</td>
        <td data-label="ชื่อพนักงานในกะ">${(r.workerNames||[]).map(escapeHtml).join(", ") || "-"}</td>
        <td data-label="รายได้รวมทั้งหมด" class="money">${money(r.totalAll)}</td>
        <td data-label="รายจ่ายรวมทั้งหมด" class="money">${money(totalExpense)}</td>
        <td data-label="เงินสดให้เจ้าของ" class="money">${money(r.ownerCashOut)}</td>
        <td data-label="รายละเอียด"><button type="button" class="btn secondary small monthly-detail-btn" data-detail="${key}">แสดงรายละเอียด</button></td>
      </tr>
      <tr class="monthly-detail-row hidden" data-detail="${key}"><td colspan="6" class="monthly-detail-cell">${monthlySalesDetailHtml(r)}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}
function dailyRowsToCsv(rows){
  const headers = ["date","thaiDate","branchId","branchName","closed","workerNames","grossSales","discount","netSales","cashSales","transferSales","lineMan","grab","totalAll","avgPerPerson","cashOpen","cashClose","cowMilkCost","cowMilkPaidTransfer","oatMilkCost","oatMilkPaidTransfer","milkCost","milkCashOut","otherExpenseTotal","otherExpenseCashOut","ownerCashOut","cashShouldRemain","cashDiff","cupsUsed","note"];
  const esc = v => `"${String(v ?? "").replaceAll('"','""')}"`;
  return [headers.join(","), ...rows.map(r=>headers.map(h=>{
    if(h==="thaiDate") return esc(thaiDate(r.date));
    if(h==="branchName") return esc(branchName(r.branchId));
    if(h==="workerNames") return esc((r.workerNames || []).join(" "));
    return esc(r[h]);
  }).join(","))].join("\n");
}
function downloadText(filename, text, type="text/plain"){
  const blob = new Blob(["\ufeff"+text], {type});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
async function renderPersonal(){
  if(isDailyWorker()) return content().innerHTML = `<div class="state error">รายวันไม่มีสิทธิ์ดูหน้าแข่งขัน</div>`;
  const monthKey = currentMonthKey();
  content().innerHTML = `
    ${pageTitle("สรุปยอดขายรายบุคคล / กราฟแข่งขัน", "คิดจากยอดขายเฉลี่ยต่อคนของวันที่คนนั้นทำงาน")}
    <div class="panel">
      <div class="grid three">
        <div class="field"><label>เดือน</label><input id="personalMonth" type="month" value="${monthKey}"></div>
        <div class="field"><label>สาขา</label><select id="personalBranch">${personalBranchOptions("ALL")}</select></div>
        <div class="field"><label>&nbsp;</label><button id="reloadPersonal" class="btn secondary">โหลดกราฟ</button></div>
      </div>
    </div>
    <div id="personalResult"></div>`;
  $("#reloadPersonal").onclick = loadPersonalResult;
  $("#personalMonth").onchange = loadPersonalResult;
  $("#personalBranch").onchange = loadPersonalResult;
  await loadPersonalResult();
}
async function computePersonalSales(monthKey, branchId="ALL"){
  const rows = await getSalesForMonth(monthKey, branchId, {allBranches: branchId === "ALL"});
  const totals = {};
  const bySelectedBonusBranch = {};
  rows.filter(r=>!r.closed).forEach(r=>{
    (r.workerIds || []).forEach(id=>{
      totals[id] = (totals[id] || 0) + numberValue(r.avgPerPerson);
      const selected = appState.settings.monthlyBonus?.selectedBranchIds || [];
      if(selected.includes(r.branchId)) bySelectedBonusBranch[id] = (bySelectedBonusBranch[id] || 0) + numberValue(r.avgPerPerson);
    });
  });
  return {rows, totals, bySelectedBonusBranch};
}
async function loadPersonalResult(){
  const monthKey = $("#personalMonth").value;
  const branchId = $("#personalBranch").value;
  $("#personalResult").innerHTML = `<div class="loading">กำลังคำนวณ...</div>`;
  const {totals} = await computePersonalSales(monthKey, branchId);
  const people = Object.entries(totals).map(([id,total])=>({id, name:userName(id), total})).sort((a,b)=>b.total-a.total);
  $("#personalResult").innerHTML = `
    <div class="panel">
      <h3>กราฟแข่งขันยอดขาย ${thaiMonth(monthKey)}</h3>
      <div class="canvas-box"><canvas id="personalChart"></canvas></div>
    </div>
    <div class="panel">
      <h3>อันดับยอดขาย</h3>
      ${people.length ? `<div class="table-wrap"><table><thead><tr><th>อันดับ</th><th>ชื่อ</th><th class="money">ยอดขายรายบุคคล</th></tr></thead><tbody>${people.map((p,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(p.name)}</td><td class="money">${money(p.total)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มีข้อมูล</div>`}
    </div>`;
  drawBar("personalChart", people.map(p=>p.name), people.map(p=>p.total), "ยอดขายรายบุคคล");
}
function dailyTimeOptions(selected=""){
  const out=[];
  for(let minutes=8*60+30; minutes<=18*60; minutes+=30){
    const h = Math.floor(minutes/60), m = minutes%60;
    const v = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    out.push(`<option value="${v}" ${selected===v?"selected":""}>${v}</option>`);
  }
  return out.join("");
}
function minutesFromTime(t){ const [h,m]=String(t||"0:0").split(":").map(Number); return (h||0)*60+(m||0); }
function calcDailyAttendancePay(r){
  if(r.status !== "ทำงาน") return 0;
  const pay = dailyPaySettings();
  if((r.workType || "full") === "full") return pay.fullDayAmount;
  const minutes = Math.max(0, minutesFromTime(r.endTime)-minutesFromTime(r.startTime));
  return Math.min(pay.fullDayAmount, (minutes / 60) * pay.hourAmount);
}
async function renderAttendance(){
  const monthKey = currentMonthKey();
  const canViewAll = isOwnerOrManager();
  const staffUsers = appState.users.filter(u=>u.active!==false && ["supervisor","staff","daily"].includes(u.role));
  content().innerHTML = `
    ${pageTitle("เช็คชื่อ", canViewAll ? "เจ้าของ/ผู้จัดการดูข้อมูลเช็คชื่อทั้งหมด" : "เช็คชื่อของตัวเองเท่านั้น")}
    <div class="panel">
      <div class="grid three">
        <div class="field"><label>เดือน</label><input id="attMonth" type="month" value="${monthKey}"></div>
        <div class="field"><label>พนักงาน</label><select id="attUser" ${canViewAll?"":"disabled"}>
          ${canViewAll ? staffUsers.map(u=>`<option value="${u.id}">${escapeHtml(u.name)} - ${ROLE_LABELS[u.role]}</option>`).join("") : `<option value="${appState.currentUser.id}">${escapeHtml(appState.currentUser.name)}</option>`}
        </select></div>
        <div class="field"><label>&nbsp;</label><button id="reloadAtt" class="btn secondary">โหลด</button></div>
      </div>
    </div>
    ${!canViewAll ? attendanceFormHtml() : ""}
    <div id="attResult"></div>`;
  $("#reloadAtt").onclick = loadAttendanceResult;
  $("#attMonth").onchange = loadAttendanceResult;
  $("#attUser").onchange = loadAttendanceResult;
  if(!canViewAll){
    $("#attDate").value = todayISO();
    $("#attThaiDate").textContent = thaiDate(todayISO());
    $("#attDate").onchange = ()=>{ $("#attThaiDate").textContent = thaiDate($("#attDate").value); loadExistingAttendanceForDate(); };
    const updateAtt = ()=>{
      const status = $("#attStatus").value;
      $("#attReasonBox")?.classList.toggle("hidden", !["ลาป่วย","ลากิจ","อื่น ๆ"].includes(status));
      $("#dailyWorkBox")?.classList.toggle("hidden", !(isDailyWorker() && status === "ทำงาน"));
      $("#hourlyTimeBox")?.classList.toggle("hidden", !(isDailyWorker() && status === "ทำงาน" && $("#dailyWorkType")?.value === "hourly"));
      $("#rendoPartTimeBox")?.classList.toggle("hidden", !(isNongkhaiUser() && status === "ทำงาน"));
      $("#rendoTimeBox")?.classList.toggle("hidden", !$("#attRendoEnabled")?.checked);
    };
    $("#attStatus").onchange = updateAtt;
    $("#dailyWorkType") && ($("#dailyWorkType").onchange = updateAtt);
    $("#attRendoEnabled") && ($("#attRendoEnabled").onchange = updateAtt);
    updateAtt();
    $("#attForm").onsubmit = saveAttendance;
    await loadExistingAttendanceForDate();
  }
  await loadAttendanceResult();
}
function attendanceFormHtml(){
  const daily = isDailyWorker();
  const rendo = isNongkhaiUser();
  return `<form id="attForm" class="panel">
    <h3>เช็คชื่อวันนี้</h3>
    <div class="grid three">
      <div class="field"><label>วันที่</label><input id="attDate" type="date"><small id="attThaiDate"></small></div>
      <div class="field"><label>สถานะ</label><select id="attStatus">
        ${daily ? `<option>ทำงาน</option><option>หยุด</option>` : `<option>ทำงาน</option><option>หยุด</option><option>ลาพักผ่อน</option><option>ลาป่วย</option><option>ลากิจ</option><option>อื่น ๆ</option>`}
      </select></div>
      <div id="attReasonBox" class="field hidden"><label>เหตุผล</label><input id="attReason" placeholder="ระบุรายละเอียด"></div>
    </div>
    ${daily ? `<div id="dailyWorkBox" class="panel inner-panel">
      <h3>แบบการทำงานรายวัน</h3>
      <div class="grid three">
        <div class="field"><label>เลือกแบบ</label><select id="dailyWorkType"><option value="full">ทำงานทั้งวัน</option><option value="hourly">ทำรายชั่วโมง</option></select></div>
        <div id="hourlyTimeBox" class="grid two hidden">
          <div class="field"><label>เริ่มงาน</label><select id="dailyStartTime">${dailyTimeOptions("08:30")}</select></div>
          <div class="field"><label>เลิกงาน</label><select id="dailyEndTime">${dailyTimeOptions("18:00")}</select></div>
        </div>
      </div>
    </div>` : ""}
    ${rendo ? `<div id="rendoPartTimeBox" class="panel inner-panel rendo-panel">
      <h3>พาร์ทไทม์ Rendo</h3>
      <label class="check-item"><input id="attRendoEnabled" type="checkbox"> วันนี้ไปทำพาร์ทไทม์ Rendo</label>
      <div id="rendoTimeBox" class="grid two hidden" style="margin-top:8px">
        <div class="field"><label>เริ่มงาน Rendo</label><select id="rendoStartTime">${rendoTimeOptions("18:00")}</select></div>
        <div class="field"><label>เลิกงาน Rendo</label><select id="rendoEndTime">${rendoTimeOptions("22:00")}</select></div>
      </div>
    </div>` : ""}
    <div class="sticky-save"><button class="btn full write-action">บันทึกเช็คชื่อ</button></div>
  </form>`;
}
async function loadExistingAttendanceForDate(){
  const date = $("#attDate")?.value;
  if(!date || isOwnerOrManager()) return;
  const snap = await getDoc(doc(appState.db, "attendance", `${appState.currentUser.id}_${date}`));
  if(!snap.exists()) return;
  const d = snap.data();
  if($("#attStatus")) $("#attStatus").value = d.status || "ทำงาน";
  if($("#attReason")) $("#attReason").value = d.reason || "";
  if($("#dailyWorkType")) $("#dailyWorkType").value = d.workType || "full";
  if($("#dailyStartTime")) $("#dailyStartTime").value = d.startTime || "08:30";
  if($("#dailyEndTime")) $("#dailyEndTime").value = d.endTime || "18:00";
  if($("#attRendoEnabled")) $("#attRendoEnabled").checked = !!d.rendoPartTime;
  if($("#rendoStartTime")) $("#rendoStartTime").value = d.rendoStartTime || "18:00";
  if($("#rendoEndTime")) $("#rendoEndTime").value = d.rendoEndTime || "22:00";
  $("#attStatus")?.dispatchEvent(new Event("change"));
}
async function saveAttendance(e){
  e.preventDefault();
  if(!requireOnline()) return;
  const date = $("#attDate").value, status=$("#attStatus").value, reason=$("#attReason")?.value.trim() || "";
  if(!date) return showToast("กรุณาเลือกวันที่");
  if(["ลาป่วย","ลากิจ","อื่น ๆ"].includes(status) && !reason) return showToast("กรุณากรอกเหตุผล");
  const data = {userId:appState.currentUser.id, userName:appState.currentUser.name, role:appState.currentUser.role, branchIds:appState.currentUser.branchIds || [], date, monthKey:monthOf(date), status, reason, updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id};
  if(isDailyWorker()){
    data.workType = status === "ทำงาน" ? ($("#dailyWorkType")?.value || "full") : "";
    data.startTime = data.workType === "hourly" ? $("#dailyStartTime")?.value : "";
    data.endTime = data.workType === "hourly" ? $("#dailyEndTime")?.value : "";
    if(status === "ทำงาน" && data.workType === "hourly" && minutesFromTime(data.endTime) <= minutesFromTime(data.startTime)) return showToast("เวลาเลิกงานต้องมากกว่าเวลาเริ่มงาน");
    data.dailyCalculatedPay = calcDailyAttendancePay(data);
  }
  if(isNongkhaiUser()){
    data.rendoPartTime = status === "ทำงาน" && !!$("#attRendoEnabled")?.checked;
    data.rendoStartTime = data.rendoPartTime ? $("#rendoStartTime")?.value : "";
    data.rendoEndTime = data.rendoPartTime ? $("#rendoEndTime")?.value : "";
    if(data.rendoPartTime && minutesFromTime(data.rendoEndTime) <= minutesFromTime(data.rendoStartTime)) return showToast("เวลาเลิก Rendo ต้องมากกว่าเวลาเริ่ม");
    data.rendoHours = calcRendoPartTimeHours(data);
    data.rendoCalculatedPay = calcRendoPartTimePay(data);
  }
  const id = `${appState.currentUser.id}_${date}`;
  const before = await getDoc(doc(appState.db, "attendance", id));
  await setDoc(doc(appState.db, "attendance", id), data, {merge:true});
  await audit("เช็คชื่อ", {date, status, rendo:data.rendoPartTime || false}, before.exists()?before.data():null, data);
  showToast("บันทึกเช็คชื่อสำเร็จ");
  await afterWrite("attendance");
  await loadAttendanceResult();
}
function missingAttendanceDates(monthKey, rows){
  const today = todayISO();
  let lastDay = daysInMonth(monthKey);
  if(monthKey === today.slice(0,7)) lastDay = Math.max(0, Number(today.slice(8,10)) - 1);
  if(monthKey > today.slice(0,7)) return [];
  const done = new Set(rows.map(r=>String(r.date).slice(0,10)));
  const missing=[];
  for(let day=1; day<=lastDay; day++){
    const iso = `${monthKey}-${String(day).padStart(2,"0")}`;
    if(!done.has(iso)) missing.push(day);
  }
  return missing;
}
async function loadAttendanceResult(){
  const monthKey=$("#attMonth").value, userId=$("#attUser").value;
  const user = appState.users.find(u=>u.id===userId) || appState.currentUser;
  const snap = await getDocs(query(collection(appState.db, "attendance"), where("monthKey","==",monthKey)));
  const rows = snap.docs.map(d=>({id:d.id, ...d.data()})).filter(r=>r.userId===userId).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const count = status => rows.filter(r=>r.status===status).length;
  const isDailyUser = user.role === "daily";
  const isNongkhai = isNongkhaiUser(user);
  const missing = missingAttendanceDates(monthKey, rows);
  const missingHtml = missing.length ? `<div class="state warn"><b>ยังไม่ได้เช็คชื่อวันที่:</b> ${missing.join(", ")}<br>กรุณาย้อนกลับไปลง ทำงาน/หยุด/ลา/อื่น ๆ ให้ครบ เพื่อให้ค่าตอบแทนไม่ผิด</div>` : "";
  const rendoRows = rows.filter(r=>r.rendoPartTime);
  const tableHtml = rows.length ? `<div class="table-wrap"><table class="mobile-card-table"><thead><tr><th>วันที่</th><th>สถานะ</th>${isDailyUser?`<th>รูปแบบ</th><th>เวลา</th>`:`<th>เหตุผล</th>`}${isNongkhai?`<th>พาร์ทไทม์ Rendo</th>`:""}</tr></thead><tbody>${rows.map(r=>`<tr><td data-label="วันที่">${thaiDate(r.date)}</td><td data-label="สถานะ">${escapeHtml(r.status)}</td>${isDailyUser?`<td data-label="รูปแบบ">${r.workType==="hourly"?"รายชั่วโมง":(r.workType==="full"?"ทั้งวัน":"-")}</td><td data-label="เวลา">${r.workType==="hourly"?`${escapeHtml(r.startTime)}-${escapeHtml(r.endTime)}`:"-"}</td>`:`<td data-label="เหตุผล">${escapeHtml(r.reason||"")}</td>`}${isNongkhai?`<td data-label="พาร์ทไทม์ Rendo">${r.rendoPartTime?`${escapeHtml(r.rendoStartTime)}-${escapeHtml(r.rendoEndTime)} (${money(calcRendoPartTimeHours(r))} ชม.)`:"-"}</td>`:""}</tr>`).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มีข้อมูล</div>`;
  const rendoTable = isNongkhai && rendoRows.length ? `<div class="panel"><h3>ตารางลงเวลา พาร์ทไทม์ Rendo</h3><div class="table-wrap"><table class="mobile-card-table"><thead><tr><th>วันที่</th><th>เริ่ม</th><th>เลิก</th><th class="money">ชั่วโมง</th><th class="money">ค่าแรงตามตั้งค่า</th></tr></thead><tbody>${rendoRows.map(r=>`<tr><td data-label="วันที่">${thaiDate(r.date)}</td><td data-label="เริ่ม">${escapeHtml(r.rendoStartTime)}</td><td data-label="เลิก">${escapeHtml(r.rendoEndTime)}</td><td data-label="ชั่วโมง" class="money">${money(calcRendoPartTimeHours(r))}</td><td data-label="ค่าแรง" class="money">${money(calcRendoPartTimePay(r))}</td></tr>`).join("")}</tbody></table></div></div>` : "";
  $("#attResult").innerHTML = `
    ${missingHtml}
    ${kpis([
      {label:"ทำงาน", value:`${count("ทำงาน")} วัน`},
      {label:"หยุด", value:`${count("หยุด")} วัน`},
      ...(isDailyUser ? [] : [
        {label:"ลาพักผ่อน", value:`${count("ลาพักผ่อน")} วัน`},
        {label:"ลาป่วย/ลากิจ/อื่น ๆ", value:`${count("ลาป่วย")+count("ลากิจ")+count("อื่น ๆ")} วัน`}
      ]),
      ...(isNongkhai ? [{label:"OT พาร์ทไทม์ Rendo", value:`${money(rendoRows.reduce((s,r)=>s+calcRendoPartTimeHours(r),0))} ชม.`}] : [])
    ])}
    <div class="panel"><h3>${isDailyUser ? "ตารางเช็คชื่อรายวัน" : "ตารางเช็คชื่อพนักงานทั่วไป"}</h3>
      <div class="state ok">ตารางเรียงจากวันที่ 1 ไปปลายเดือน</div>
      ${tableHtml}
    </div>
    ${rendoTable}`;
}

async function renderOwnerExpenses(){
  if(!isOwnerOrManager()) return content().innerHTML = `<div class="state error">ไม่มีสิทธิ์เข้าหน้านี้</div>`;
  const monthKey = currentMonthKey();
  content().innerHTML = `
    ${pageTitle("ลงรายจ่าย", "รายจ่ายที่เจ้าของ/ผู้จัดการลงเอง และรายจ่ายประจำ")}
    <div class="panel compact-panel">
      <div class="grid three compact-grid">
        <div class="field"><label>เดือน</label><input id="ownerExpMonth" type="month" value="${monthKey}"></div>
        <div class="field"><label>&nbsp;</label><button id="reloadOwnerExpenses" type="button" class="btn secondary">โหลด/คำนวณใหม่</button></div>
      </div>
    </div>
    <div class="panel compact-panel">
      <div class="flex"><h3>เพิ่มรายจ่ายอื่น ๆ</h3><span class="pill muted">เลือกวันที่และสาขา/รวมทุกสาขา</span></div>
      <form id="ownerExpenseForm">
        <div class="grid three compact-grid">
          <div class="field"><label>วันที่</label><input id="ownerExpDate" type="date" value="${todayISO()}"></div>
          <div class="field"><label>รายการ</label><input id="ownerExpName" placeholder="เช่น ค่าเช่า / ค่าน้ำ / ค่าไฟ / ค่าเน็ต"></div>
          <div class="field"><label>จำนวนเงิน</label><input id="ownerExpAmount" inputmode="decimal" placeholder="0"></div>
          <div class="field"><label>เป็นของ</label><select id="ownerExpScope"><option value="ALL">รวมทุกสาขา (แบ่งตาม % ยอดขาย)</option>${activeBranches().map(b=>`<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("")}</select></div>
          <div class="field"><label>หมายเหตุ</label><input id="ownerExpNote" placeholder="-"></div>
          <div class="field"><label>&nbsp;</label><button class="btn write-action full">บันทึกรายจ่าย</button></div>
        </div>
      </form>
    </div>
    <div class="panel compact-panel">
      <div class="flex"><h3>รายจ่ายประจำเพิ่มเติม</h3><button id="addOwnerTemplate" type="button" class="btn secondary small write-action">+ เพิ่มรายจ่ายประจำ</button></div>
      <div class="state ok">เงินเดือน/ค่าตอบแทนรายวันจะดึงจากหน้าค่าตอบแทนอัตโนมัติ ส่วนรายจ่ายประจำที่เพิ่มเองจะจดจำไปเดือนถัด ๆ ไปจนกว่าจะลบหรือแก้ไข</div>
      <div id="ownerTemplateRows" class="grid"></div>
      <button id="saveOwnerTemplates" type="button" class="btn write-action">บันทึกรายจ่ายประจำ</button>
    </div>
    <div id="ownerExpenseResult"><div class="loading">กำลังคำนวณ...</div></div>`;
  $("#ownerExpMonth").onchange = loadOwnerExpensesResult;
  $("#reloadOwnerExpenses").onclick = loadOwnerExpensesResult;
  $("#ownerExpenseForm").onsubmit = saveOwnerExpenseItem;
  $("#addOwnerTemplate").onclick = ()=>addOwnerTemplateRow();
  $("#saveOwnerTemplates").onclick = saveOwnerExpenseTemplates;
  await loadOwnerTemplatesIntoForm();
  await loadOwnerExpensesResult();
  updateOnlineUi();
}
function ownerScopeOptions(selected="ALL"){
  return `<option value="ALL" ${selected==="ALL"?"selected":""}>รวมทุกสาขา (แบ่งตาม % ยอดขาย)</option>${activeBranches().map(b=>`<option value="${b.id}" ${selected===b.id?"selected":""}>${escapeHtml(b.name)}</option>`).join("")}`;
}
function addOwnerTemplateRow(row={}){
  const div=document.createElement("div");
  div.className="grid four owner-template-row";
  div.dataset.id = row.id || uid("tpl");
  div.innerHTML = `<div class="field"><label>รายการประจำ</label><input class="tpl-name" value="${escapeHtml(row.name||"")}" placeholder="เช่น ค่าเช่า / ค่าเน็ต"></div>
    <div class="field"><label>จำนวนเงิน/เดือน</label><input class="tpl-amount" inputmode="decimal" value="${row.amount ?? ""}" placeholder="0"></div>
    <div class="field"><label>เป็นของ</label><select class="tpl-scope">${ownerScopeOptions(row.scope || "ALL")}</select></div>
    <div class="field"><label>หมายเหตุ</label><div class="flex"><input class="tpl-note" value="${escapeHtml(row.note||"")}" placeholder="-"><button type="button" class="btn ghost small remove-template write-action">ลบ</button></div></div>`;
  $("#ownerTemplateRows").appendChild(div);
  $(".remove-template",div).onclick = ()=>div.remove();
  updateOnlineUi();
}
async function loadOwnerTemplatesIntoForm(){
  const box = $("#ownerTemplateRows");
  box.innerHTML = `<div class="loading">กำลังโหลดรายจ่ายประจำ...</div>`;
  const snap = await getDocs(collection(appState.db, "ownerExpenseTemplates"));
  const rows = snap.docs.map(d=>({id:d.id, ...d.data()})).filter(x=>x.active!==false).sort((a,b)=>String(a.name).localeCompare(String(b.name),"th"));
  box.innerHTML = "";
  rows.length ? rows.forEach(addOwnerTemplateRow) : addOwnerTemplateRow({name:"", amount:"", scope:"ALL"});
}
async function saveOwnerExpenseTemplates(){
  if(!requireOnline()) return;
  const beforeSnap = await getDocs(collection(appState.db, "ownerExpenseTemplates"));
  const before = beforeSnap.docs.map(d=>({id:d.id, ...d.data()}));
  const rows = $$(".owner-template-row").map(row=>({
    id:row.dataset.id || uid("tpl"), name:$(".tpl-name",row).value.trim(), amount:numberValue($(".tpl-amount",row).value), scope:$(".tpl-scope",row).value, note:$(".tpl-note",row).value.trim(), active:true
  })).filter(x=>x.name || x.amount || x.note);
  const batch = writeBatch(appState.db);
  before.forEach(old=>{ if(!rows.some(r=>r.id===old.id)) batch.set(doc(appState.db,"ownerExpenseTemplates",old.id), {...old, active:false, updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id}, {merge:true}); });
  rows.forEach(r=>batch.set(doc(appState.db,"ownerExpenseTemplates",r.id), {...r, updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id}, {merge:true}));
  await batch.commit();
  await audit("ตั้งค่ารายจ่ายประจำ", {}, before, rows);
  await afterWrite("owner_expense_templates");
  showToast("บันทึกรายจ่ายประจำแล้ว");
  await loadOwnerExpensesResult();
}
async function saveOwnerExpenseItem(e){
  e.preventDefault();
  if(!requireOnline()) return;
  const date=$("#ownerExpDate").value, name=$("#ownerExpName").value.trim(), amount=numberValue($("#ownerExpAmount").value), scope=$("#ownerExpScope").value, note=$("#ownerExpNote").value.trim();
  if(!date || !name || amount<=0) return showToast("กรุณากรอกวันที่ รายการ และจำนวนเงินให้ถูกต้อง");
  const data = {date, monthKey:monthOf(date), name, amount, scope, note, createdAt:serverTimestamp(), createdAtISO:new Date().toISOString(), createdBy:appState.currentUser.id, createdByName:appState.currentUser.name};
  const ref = await addDoc(collection(appState.db, "ownerExpenses"), data);
  await audit("ลงรายจ่ายเจ้าของ", {date, name, amount, scope:expenseScopeLabel(scope)}, null, {...data, id:ref.id});
  await afterWrite("owner_expense");
  $("#ownerExpName").value=""; $("#ownerExpAmount").value=""; $("#ownerExpNote").value="";
  showToast("บันทึกรายจ่ายแล้ว");
  await loadOwnerExpensesResult();
}
async function deleteOwnerExpense(id){
  if(!requireOnline()) return;
  if(!confirm("ลบรายจ่ายรายการนี้ใช่ไหม?")) return;
  const ref = doc(appState.db,"ownerExpenses",id);
  const before = await getDoc(ref);
  await deleteDoc(ref);
  await audit("ลบรายจ่ายเจ้าของ", {id}, before.exists()?before.data():null, null);
  await afterWrite("owner_expense_delete");
  showToast("ลบรายจ่ายแล้ว");
  await loadOwnerExpensesResult();
}
async function loadOwnerExpensesResult(){
  const monthKey = $("#ownerExpMonth")?.value || currentMonthKey();
  const box = $("#ownerExpenseResult");
  if(!box) return;
  box.innerHTML = `<div class="loading">กำลังคำนวณรายจ่ายเจ้าของ...</div>`;
  const res = await computeOwnerExpenseAllocationsForMonth(monthKey);
  const expSnap = await getDocs(query(collection(appState.db,"ownerExpenses"), where("monthKey","==",monthKey)));
  const manual = expSnap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const byBranchRows = activeBranches().map(b=>`<tr><td>${escapeHtml(b.name)}</td><td class="money">${money(res.salesByBranch[b.id])}</td><td class="money">${money(res.byBranch[b.id])}</td></tr>`).join("");
  const payrollRows = res.directItems.filter(x=>x.kind==="payroll").map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.note||"")}</td><td>${expenseScopeLabel(x.scope)}</td><td class="money">${money(x.amount)}</td></tr>`).join("");
  const recurringRows = res.directItems.filter(x=>x.kind==="recurring").map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.note||"")}</td><td>${expenseScopeLabel(x.scope)}</td><td class="money">${money(x.amount)}</td></tr>`).join("");
  box.innerHTML = `
    ${kpis([{label:"รายจ่ายเจ้าของลงเองรวม", value:`${money(res.total)} บาท`, sub:"รวมค่าตอบแทน + รายจ่ายประจำ + รายจ่ายอื่น"}])}
    <div class="panel"><h3>สรุปภาระรายจ่ายแยกสาขา ${thaiMonth(monthKey)}</h3>
      <div class="state ok">รายการ “รวมทุกสาขา” และคนที่อยู่หลายสาขา จะกระจายตามสัดส่วนยอดขายของสาขานั้นในเดือนนี้ หากเดือนนั้นยังไม่มียอดขาย ระบบจะแบ่งเท่ากันเพื่อไม่ให้ตกหล่น</div>
      <div class="table-wrap"><table><thead><tr><th>สาขา</th><th class="money">ยอดขายเดือนนี้</th><th class="money">ภาระรายจ่ายเจ้าของลง</th></tr></thead><tbody>${byBranchRows}</tbody></table></div>
    </div>
    <div class="panel"><h3>เงินเดือน/ค่าตอบแทนที่ดึงจากหน้าค่าตอบแทน</h3>${payrollRows?`<div class="table-wrap"><table><thead><tr><th>รายการ</th><th>ที่มา</th><th>สาขา/การกระจาย</th><th class="money">จำนวน</th></tr></thead><tbody>${payrollRows}</tbody></table></div>`:`<div class="empty">ยังไม่มีค่าตอบแทนที่คำนวณได้</div>`}</div>
    <div class="panel"><h3>รายจ่ายประจำเพิ่มเติม</h3>${recurringRows?`<div class="table-wrap"><table><thead><tr><th>รายการ</th><th>หมายเหตุ</th><th>สาขา/การกระจาย</th><th class="money">จำนวน</th></tr></thead><tbody>${recurringRows}</tbody></table></div>`:`<div class="empty">ยังไม่มีรายจ่ายประจำเพิ่มเติม</div>`}</div>
    <div class="panel"><h3>รายการรายจ่ายอื่น ๆ ที่ลงเอง</h3>${manual.length?`<div class="table-wrap"><table class="mobile-card-table"><thead><tr><th>วันที่</th><th>รายการ</th><th>สาขา/การกระจาย</th><th class="money">จำนวน</th><th>หมายเหตุ</th><th>จัดการ</th></tr></thead><tbody>${manual.map(r=>`<tr><td data-label="วันที่">${thaiDate(r.date)}</td><td data-label="รายการ">${escapeHtml(r.name)}</td><td data-label="สาขา/การกระจาย">${expenseScopeLabel(r.scope)}</td><td data-label="จำนวน" class="money">${money(r.amount)}</td><td data-label="หมายเหตุ">${escapeHtml(r.note||"")}</td><td data-label="จัดการ"><button class="btn danger small write-action delete-owner-exp" data-id="${r.id}">ลบ</button></td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">ยังไม่มีรายจ่ายอื่นในเดือนนี้</div>`}</div>`;
  $$(".delete-owner-exp").forEach(btn=>btn.onclick=()=>deleteOwnerExpense(btn.dataset.id));
  updateOnlineUi();
}

async function renderAdvances(){
  if(!canAccessAdvances()) return content().innerHTML = `<div class="state error">ไม่มีสิทธิ์เข้าหน้านี้</div>`;
  const monthKey = currentMonthKey();
  const adminMode = isOwnerOrManager();
  const payUsers = adminMode
    ? appState.users.filter(u=>u.active!==false && ["supervisor","staff","daily"].includes(u.role))
    : [appState.currentUser];
  content().innerHTML = `
    ${pageTitle("เงินเบิกล่วงหน้า", adminMode ? "เจ้าของ/ผู้จัดการลงแทนและดูรายการของทุกคนได้" : "บันทึกและดูรายการเบิกล่วงหน้าเฉพาะของตัวเอง")}
    <form id="advanceForm" class="panel">
      <h3>เพิ่มรายการเบิกล่วงหน้า</h3>
      <div class="grid three">
        <div class="field"><label>วันที่</label><input id="advanceDate" type="date" value="${todayISO()}"></div>
        <div class="field"><label>ชื่อพนักงาน</label><select id="advanceUser" ${adminMode?"":"disabled"}>${payUsers.map(u=>`<option value="${u.id}" ${u.id===appState.currentUser.id?"selected":""}>${escapeHtml(u.name)} - ${ROLE_LABELS[u.role]}</option>`).join("")}</select><small>${adminMode?"เลือกลงแทนพนักงานได้":"ระบบล็อกให้ลงเฉพาะชื่อของตัวเอง"}</small></div>
        <div class="field"><label>จำนวนเงิน</label><input id="advanceAmount" inputmode="decimal" placeholder="0"></div>
        <div class="field"><label>รายละเอียด</label><input id="advanceDetail" placeholder="เช่น เบิกเงินเดือน"></div>
        <div class="field"><label>หมายเหตุ</label><input id="advanceNote"></div>
        <div class="field"><label>&nbsp;</label><button class="btn write-action">บันทึก</button></div>
      </div>
    </form>
    <div class="panel">
      <div class="grid three">
        <div class="field"><label>เดือนที่แสดง</label><input id="advanceMonth" type="month" value="${monthKey}"></div>
        <div class="field"><label>&nbsp;</label><button id="reloadAdvances" class="btn secondary">โหลด</button></div>
      </div>
    </div>
    <div id="advanceResult"></div>`;
  $("#advanceForm").onsubmit = saveAdvance;
  $("#reloadAdvances").onclick = loadAdvances;
  $("#advanceMonth").onchange = loadAdvances;
  await loadAdvances();
}

async function saveAdvance(e){
  e.preventDefault();
  if(!requireOnline()) return;
  const adminMode = isOwnerOrManager();
  const userId = adminMode ? $("#advanceUser").value : appState.currentUser.id;
  const date=$("#advanceDate").value;
  if(!adminMode && userId !== appState.currentUser.id) return showToast("บันทึกเงินเบิกได้เฉพาะของตัวเอง");
  const data = {userId, userName:userName(userId), date, monthKey:monthOf(date), amount:numberValue($("#advanceAmount").value), detail:$("#advanceDetail").value.trim(), note:$("#advanceNote").value.trim(), createdAt:serverTimestamp(), createdBy:appState.currentUser.id, createdByName:appState.currentUser.name};
  if(!date) return showToast("กรุณาเลือกวันที่");
  if(!data.amount) return showToast("กรุณากรอกจำนวนเงิน");
  await addDoc(collection(appState.db, "salaryAdvances"), data);
  await audit("เพิ่มเงินเบิกล่วงหน้า", {user:data.userName, amount:data.amount}, null, data);
  await afterWrite("advance");
  showToast("บันทึกเงินเบิกล่วงหน้าสำเร็จ");
  $("#advanceAmount").value = ""; $("#advanceDetail").value = ""; $("#advanceNote").value = "";
  await loadAdvances();
}

function canDeleteAdvance(row){
  return isOwnerOrManager() || row.userId === appState.currentUser?.id || row.createdBy === appState.currentUser?.id;
}
async function deleteAdvance(id){
  if(!requireOnline()) return;
  const snap = await getDoc(doc(appState.db, "salaryAdvances", id));
  if(!snap.exists()) return showToast("ไม่พบรายการเบิกเงินนี้");
  const row = {id:snap.id, ...snap.data()};
  if(!canDeleteAdvance(row)) return showToast("ลบได้เฉพาะรายการของตัวเองเท่านั้น");
  if(!confirm(`ยืนยันลบรายการเบิกเงิน ${money(row.amount)} บาท ของ ${row.userName || userName(row.userId)} ใช่ไหม?`)) return;
  await deleteDoc(doc(appState.db, "salaryAdvances", id));
  await audit("ลบเงินเบิกล่วงหน้า", {user:row.userName || userName(row.userId), amount:row.amount, date:row.date}, row, null);
  await afterWrite("advance_delete");
  showToast("ลบรายการเบิกเงินแล้ว");
  await loadAdvances();
}
async function loadAdvances(){
  const monthKey=$("#advanceMonth").value;
  const adminMode = isOwnerOrManager();
  const snap = await getDocs(query(collection(appState.db, "salaryAdvances"), where("monthKey","==",monthKey)));
  let rows = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if(!adminMode) rows = rows.filter(r=>r.userId === appState.currentUser.id || r.createdBy === appState.currentUser.id);
  const totals = {};
  rows.forEach(r=>totals[r.userId]=(totals[r.userId]||0)+numberValue(r.amount));
  $("#advanceResult").innerHTML = `
    <div class="panel"><h3>ยอดเบิกรวมรายเดือน</h3>
      ${Object.keys(totals).length ? `<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th class="money">ยอดเบิกรวม</th></tr></thead><tbody>${Object.entries(totals).map(([id,total])=>`<tr><td>${escapeHtml(userName(id))}</td><td class="money">${money(total)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มีข้อมูล</div>`}
    </div>
    <div class="panel"><h3>${adminMode ? "รายการทั้งหมด" : "รายการของฉัน"}</h3>
      <div class="state ${adminMode?"ok":"warn"}">${adminMode ? "เจ้าของและผู้จัดการเห็นและลบรายการเบิกเงินของทุกคนได้" : "หน้านี้แสดงเฉพาะรายการเบิกเงินของคุณ และคุณลบรายการของตัวเองได้"}</div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ชื่อ</th><th class="money">จำนวน</th><th>รายละเอียด</th><th>หมายเหตุ</th><th>จัดการ</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${thaiDate(r.date)}</td><td>${escapeHtml(r.userName||userName(r.userId))}</td><td class="money">${money(r.amount)}</td><td>${escapeHtml(r.detail)}</td><td>${escapeHtml(r.note)}</td><td>${canDeleteAdvance(r)?`<button type="button" class="btn danger small write-action delete-advance" data-id="${r.id}">ลบ</button>`:"-"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มีรายการ</div>`}
    </div>`;
  $$(".delete-advance").forEach(btn=>btn.onclick = ()=>deleteAdvance(btn.dataset.id));
  updateOnlineUi();
}

async function renderCompensation(){
  if(!isOwnerOrManager()) return content().innerHTML = `<div class="state error">ไม่มีสิทธิ์เข้าหน้านี้</div>`;
  const monthKey = currentMonthKey();
  content().innerHTML = `
    ${pageTitle("ค่าตอบแทน")}
    <div class="panel comp-filter-panel">
      <div class="grid three compact-grid">
        <div class="field"><label>เดือน</label><input id="compMonth" type="month" value="${monthKey}"></div>
        <div class="field"><label>&nbsp;</label><button id="reloadComp" class="btn secondary">คำนวณใหม่</button></div>
      </div>
    </div>
    <div id="compResult"></div>
    <div class="panel daily-pay-settings-panel compact-panel">
      <h3>ค่าตอบแทนพนักงานรายวัน</h3>
      <div class="grid three compact-grid">
        <div class="field"><label>ทำงานทั้งวัน (บาท/วัน)</label><input id="dailyFullPay" inputmode="decimal" value="${numberValue(dailyPaySettings().fullDayAmount)}"></div>
        <div class="field"><label>รายชั่วโมง (บาท/ชั่วโมง)</label><input id="dailyHourPay" inputmode="decimal" value="${numberValue(dailyPaySettings().hourAmount)}"></div>
        <div class="field"><label>พาร์ทไทม์ Rendo (บาท/ชั่วโมง)</label><input id="rendoHourPay" inputmode="decimal" value="${numberValue(rendoPaySettings().hourAmount)}"></div>
        <div class="field"><label>&nbsp;</label><button id="saveDailyPaySettings" class="btn write-action">บันทึกค่าตอบแทนรายวัน/Rendo</button></div>
      </div>
    </div>
    <div class="panel compact-panel">
      <div class="flex"><h3>ชนิดขนม / ราคา / % OT</h3><button id="addDessertSettingComp" class="btn secondary small write-action">+ เพิ่มชนิดขนม</button></div>
      <div id="dessertSettingsRows" class="grid">${dessertSettingRows()}</div>
      <button id="saveDessertSettingsComp" class="btn write-action" style="margin-top:10px">บันทึกชนิดขนม</button>
    </div>`;
  $("#reloadComp").onclick = loadCompensation;
  $("#saveDailyPaySettings").onclick = saveDailyPaySettings;
  $("#compMonth").onchange = loadCompensation;
  bindDessertSettingsControls("#addDessertSettingComp", "#dessertSettingsRows");
  $("#saveDessertSettingsComp").onclick = saveDessertSettings;
  await loadCompensation();
}
async function loadCompensation(){
  const monthKey=$("#compMonth").value;
  $("#compResult").innerHTML = `<div class="loading">กำลังคำนวณค่าตอบแทน...</div>`;
  const payUsers = appState.users.filter(u=>u.active!==false && ["supervisor","staff","daily"].includes(u.role));
  const regularPayUsers = payUsers.filter(u=>u.role !== "daily");
  const dailyPayUsers = payUsers.filter(u=>u.role === "daily");
  const {rows, totals, bySelectedBonusBranch} = await computePersonalSales(monthKey, "ALL");
  const dailyBonus = {};
  rows.filter(r=>!r.closed).forEach(r=>{
    const rule = appState.settings.dailyBonus?.[r.branchId] || {};
    if(rule.enabled && numberValue(r.totalAll) > numberValue(rule.threshold)){
      (r.workerIds || []).forEach(id=> dailyBonus[id] = (dailyBonus[id] || 0) + numberValue(rule.amount));
    }
  });
  const monthlyBonus = {};
  payUsers.forEach(u=>{
    if(!["supervisor","staff"].includes(u.role)){ monthlyBonus[u.id] = 0; return; }
    const allTotal = totals[u.id] || 0;
    const selectedTotal = bySelectedBonusBranch[u.id] || 0;
    let b = 0;
    for(const t of appState.settings.monthlyBonus?.allTiers || []) if(allTotal > numberValue(t.min)) b = Math.max(b, numberValue(t.amount));
    if(!b){ for(const t of appState.settings.monthlyBonus?.selectedTiers || []) if(selectedTotal > numberValue(t.min)) b = Math.max(b, numberValue(t.amount)); }
    monthlyBonus[u.id] = b;
  });
  const dessertOT = {};
  rows.filter(r=>r.otEnabled).forEach(r=>{
    const workers = r.otWorkerIds || [];
    const per = workers.length ? calculateDessertPayTotalForSale(r) / workers.length : 0;
    workers.forEach(id => dessertOT[id] = (dessertOT[id] || 0) + per);
  });
  const attSnap = await getDocs(query(collection(appState.db, "attendance"), where("monthKey","==",monthKey)));
  const dailyWages = {}, rendoOT = {};
  attSnap.docs.map(d=>d.data()).forEach(r=>{
    const u = appState.users.find(x=>x.id===r.userId);
    if(u?.role === "daily"){
      if(!dailyWages[r.userId]) dailyWages[r.userId] = {full:0, hourly:0, total:0};
      const pay = calcDailyAttendancePay(r);
      if((r.workType || "full") === "hourly") dailyWages[r.userId].hourly += pay;
      else dailyWages[r.userId].full += pay;
      dailyWages[r.userId].total += pay;
    }
    if(r.rendoPartTime) rendoOT[r.userId] = (rendoOT[r.userId] || 0) + calcRendoPartTimePay(r);
  });
  const advSnap = await getDocs(query(collection(appState.db, "salaryAdvances"), where("monthKey","==",monthKey)));
  const advances = {};
  advSnap.docs.map(d=>d.data()).forEach(r=>advances[r.userId]=(advances[r.userId]||0)+numberValue(r.amount));
  const [compSnap, prevCompSnap] = await Promise.all([
    getDocs(query(collection(appState.db, "compensationRecords"), where("monthKey","==",monthKey))),
    getDocs(query(collection(appState.db, "compensationRecords"), where("monthKey","==",previousMonthKey(monthKey))))
  ]);
  const records = {};
  compSnap.docs.forEach(d=>records[d.data().userId]=({id:d.id, ...d.data()}));
  const prevRecords = {};
  prevCompSnap.docs.forEach(d=>prevRecords[d.data().userId]=({id:d.id, ...d.data()}));

  const regularTable = regularPayUsers.length ? `<div class="table-wrap"><table>
    <thead><tr>
      <th>ชื่อ</th><th>ระดับ</th><th class="money">เงินเดือน</th><th class="money">OT เพิ่มอื่น ๆ</th><th>OT จากอะไร</th><th class="money">OT ทำขนม</th>
      <th class="money">เงินเพิ่มออกบูธ</th><th class="money">OT พาร์ทไทม์ Rendo</th><th class="money">โบนัสรายวัน</th><th class="money">โบนัสรายเดือน</th>
      <th class="money">หักเงิน</th><th>รายละเอียดหัก</th><th class="money">เบิกล่วงหน้า</th><th class="money">ปกส.ลูกจ้าง</th>
      <th class="money">ยอดโอนปลายเดือน</th><th class="money">ต้นทุนรวม+ปกส.</th><th>บันทึก</th>
    </tr></thead>
    <tbody>${regularPayUsers.map(u=>{
      const r = records[u.id] || {};
      const prevSalary = prevRecords[u.id]?.salary;
      const salarySource = (r.salary !== undefined && r.salary !== null && r.salary !== "") ? r.salary : (prevSalary ?? "");
      const salary = numberValue(salarySource);
      const employeeSS = salary * 0.05, employerSS = salary * 0.05;
      const otOther = numberValue(r.otOther);
      const boothBonus = numberValue(r.boothBonus);
      const rendo = numberValue(rendoOT[u.id]);
      const daily = numberValue(dailyBonus[u.id]);
      const monthly = numberValue(monthlyBonus[u.id]);
      const dessert = numberValue(dessertOT[u.id]);
      const deduction = numberValue(r.deduction);
      const advance = numberValue(advances[u.id]);
      const transfer = salary + otOther + dessert + boothBonus + rendo + daily + monthly - deduction - advance - employeeSS;
      const totalCost = salary + otOther + dessert + boothBonus + rendo + daily + monthly - deduction + employerSS;
      return `<tr class="comp-row" data-user="${u.id}" data-daily-role="0" data-daily-wage="0" data-daily-full-wage="0" data-daily-hourly-wage="0">
        <td>${escapeHtml(u.name)}</td><td>${roleBadge(u.role)}</td>
        <td><input class="comp-salary wide-money" inputmode="decimal" value="${salarySource === "" ? "" : salary}">${(r.salary === undefined || r.salary === null || r.salary === "") && salarySource !== "" ? `<small class="salary-copy-note">ลอกจากเดือนก่อน</small>` : ""}</td>
        <td><input class="comp-ot wide-money" inputmode="decimal" value="${otOther || ""}"></td>
        <td><input class="comp-ot-note" value="${escapeHtml(r.otOtherNote || "")}" placeholder="OT จากอะไร"></td>
        <td class="money comp-dessert" data-value="${dessert}">${money(dessert)}</td>
        <td><input class="comp-booth" inputmode="decimal" value="${boothBonus || ""}"></td>
        <td class="money comp-rendo" data-value="${rendo}">${money(rendo)}</td>
        <td class="money comp-daily" data-value="${daily}">${money(daily)}</td>
        <td class="money comp-monthly" data-value="${monthly}">${money(monthly)}</td>
        <td><input class="comp-deduction wide-money" inputmode="decimal" value="${deduction || ""}"></td>
        <td><input class="comp-deduction-note" value="${escapeHtml(r.deductionNote || "")}"></td>
        <td class="money comp-advance" data-value="${advance}">${money(advance)}</td>
        <td class="money comp-employee-ss">${money(employeeSS)}</td>
        <td class="money comp-transfer"><b>${money(transfer)}</b></td>
        <td class="money comp-cost"><b>${money(totalCost)}</b></td>
        <td><div class="row-actions"><button class="btn small write-action save-comp">บันทึก</button><button type="button" class="btn secondary small share-comp">รายละเอียด/PDF</button></div></td>
      </tr>`;
    }).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มีหัวหน้างาน/พนักงาน</div>`;

  const dailyTable = dailyPayUsers.length ? `<div class="table-wrap"><table>
    <thead><tr>
      <th>ชื่อ</th><th>ระดับ</th>
      <th class="money">ค่าจ้างวันที่ทำงานทั้งวัน</th><th>ไม่นำทั้งวันมาคำนวณ</th>
      <th class="money">ค่าจ้างวันที่ทำงานรายชั่วโมง</th><th>ไม่นำรายชั่วโมงมาคำนวณ</th>
      <th class="money">ค่าจ้างที่นำมาคิด</th><th class="money">OT เพิ่มอื่น ๆ</th><th>OT จากอะไร</th><th class="money">OT ทำขนม</th><th class="money">เงินเพิ่มออกบูธ</th><th class="money">OT พาร์ทไทม์ Rendo</th>
      <th class="money">หักเงิน</th><th>รายละเอียดหัก</th><th class="money">เบิกล่วงหน้า</th><th class="money">ยอดโอนปลายเดือน</th><th class="money">ต้นทุนรวม</th><th>บันทึก</th>
    </tr></thead>
    <tbody>${dailyPayUsers.map(u=>{
      const r = records[u.id] || {};
      const wage = dailyWages[u.id] || {full:0, hourly:0, total:0};
      const fullPaid = !!(r.dailyFullPaidAlready ?? r.dailyPaidAlready);
      const hourlyPaid = !!(r.dailyHourlyPaidAlready ?? r.dailyPaidAlready);
      const salary = (fullPaid ? 0 : numberValue(wage.full)) + (hourlyPaid ? 0 : numberValue(wage.hourly));
      const otOther = numberValue(r.otOther);
      const boothBonus = numberValue(r.boothBonus);
      const rendo = numberValue(rendoOT[u.id]);
      const dessert = numberValue(dessertOT[u.id]);
      const deduction = numberValue(r.deduction);
      const advance = numberValue(advances[u.id]);
      const transfer = salary + otOther + dessert + boothBonus + rendo - deduction - advance;
      const totalCost = salary + otOther + dessert + boothBonus + rendo - deduction;
      return `<tr class="comp-row" data-user="${u.id}" data-daily-role="1" data-daily-wage="${numberValue(wage.total)}" data-daily-full-wage="${numberValue(wage.full)}" data-daily-hourly-wage="${numberValue(wage.hourly)}">
        <td>${escapeHtml(u.name)}</td><td>${roleBadge(u.role)}</td>
        <td class="money comp-daily-full-raw" data-value="${numberValue(wage.full)}">${money(wage.full)}</td>
        <td><label class="inline-check"><input class="comp-daily-full-paid" type="checkbox" ${fullPaid?"checked":""}> ไม่นำมาคำนวณเพราะได้รับแล้ว</label></td>
        <td class="money comp-daily-hourly-raw" data-value="${numberValue(wage.hourly)}">${money(wage.hourly)}</td>
        <td><label class="inline-check"><input class="comp-daily-hourly-paid" type="checkbox" ${hourlyPaid?"checked":""}> ไม่นำมาคำนวณเพราะได้รับแล้ว</label></td>
        <td><input class="comp-salary wide-money" inputmode="decimal" value="${salary || ""}" disabled></td>
        <td><input class="comp-ot wide-money" inputmode="decimal" value="${otOther || ""}"></td>
        <td><input class="comp-ot-note" value="${escapeHtml(r.otOtherNote || "")}" placeholder="OT จากอะไร"></td>
        <td class="money comp-dessert" data-value="${dessert}">${money(dessert)}</td>
        <td><input class="comp-booth" inputmode="decimal" value="${boothBonus || ""}"></td>
        <td class="money comp-rendo" data-value="${rendo}">${money(rendo)}</td>
        <td><input class="comp-deduction wide-money" inputmode="decimal" value="${deduction || ""}"></td>
        <td><input class="comp-deduction-note" value="${escapeHtml(r.deductionNote || "")}"></td>
        <td class="money comp-advance" data-value="${advance}">${money(advance)}</td>
        <td class="money comp-transfer"><b>${money(transfer)}</b></td>
        <td class="money comp-cost"><b>${money(totalCost)}</b></td>
        <td><div class="row-actions"><button class="btn small write-action save-comp">บันทึก</button><button type="button" class="btn secondary small share-comp">รายละเอียด/PDF</button></div></td>
      </tr>`;
    }).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มีพนักงานรายวัน</div>`;

  $("#compResult").innerHTML = `
    <div class="panel">
      <h3>ตารางค่าตอบแทนหัวหน้างาน/พนักงาน ${thaiMonth(monthKey)}</h3>
      <div class="state ok">ตารางนี้ตัดช่องค่าจ้างรายวันออกแล้ว เพื่อให้สั้นและอ่านง่ายขึ้น · เงินเดือนจะลอกจากเดือนก่อนหน้าให้อัตโนมัติเมื่อเดือนนี้ยังไม่เคยบันทึก · OT Rendo ดึงจากหน้าเช็คชื่อสาขาหนองคาย</div>
      ${regularTable}
    </div>
    <div class="panel">
      <h3>ตารางค่าตอบแทนรายวัน ${thaiMonth(monthKey)}</h3>
      <div class="state ok">แยกค่าจ้างวันที่ทำงานทั้งวันและรายชั่วโมง พร้อม OT Rendo และช่องติ๊กไม่นำมาคำนวณเมื่อได้รับเงินแล้ว</div>
      ${dailyTable}
    </div>`;
  $$(".comp-row").forEach(row=>{
    row.oninput = ()=>recalcCompRow(row);
    $(".comp-daily-full-paid", row)?.addEventListener("change", ()=>recalcCompRow(row));
    $(".comp-daily-hourly-paid", row)?.addEventListener("change", ()=>recalcCompRow(row));
    $(".save-comp", row).onclick = ()=>saveCompRow(row, monthKey);
    $(".share-comp", row).onclick = ()=>shareCompSummary(row, monthKey);
    recalcCompRow(row);
  });
  updateOnlineUi();
}

function recalcCompRow(row){
  const isDaily = row.dataset.dailyRole === "1";
  const dailyFullRaw = numberValue(row.dataset.dailyFullWage);
  const dailyHourlyRaw = numberValue(row.dataset.dailyHourlyWage);
  if(isDaily){
    const fullPaid = !!$(".comp-daily-full-paid", row)?.checked;
    const hourlyPaid = !!$(".comp-daily-hourly-paid", row)?.checked;
    $(".comp-salary", row).value = money((fullPaid ? 0 : dailyFullRaw) + (hourlyPaid ? 0 : dailyHourlyRaw));
  }
  const salary = numberValue($(".comp-salary", row).value);
  const ot = numberValue($(".comp-ot", row).value);
  const dessert = numberValue($(".comp-dessert", row).dataset.value);
  const booth = numberValue($(".comp-booth", row).value);
  const rendo = numberValue($(".comp-rendo", row)?.dataset.value);
  const daily = isDaily ? 0 : numberValue($(".comp-daily", row)?.dataset.value);
  const monthly = isDaily ? 0 : numberValue($(".comp-monthly", row)?.dataset.value);
  const deduction = numberValue($(".comp-deduction", row).value);
  const advance = numberValue($(".comp-advance", row).dataset.value);
  const empSS = isDaily ? 0 : salary * .05, employerSS = isDaily ? 0 : salary * .05;
  const transfer = salary + ot + dessert + booth + rendo + daily + monthly - deduction - advance - empSS;
  const cost = salary + ot + dessert + booth + rendo + daily + monthly - deduction + employerSS;
  if($(".comp-employee-ss", row)) $(".comp-employee-ss", row).textContent = money(empSS);
  $(".comp-transfer", row).innerHTML = `<b>${money(transfer)}</b>`;
  $(".comp-cost", row).innerHTML = `<b>${money(cost)}</b>`;
}

function getCompRowData(row, monthKey){
  recalcCompRow(row);
  const userId = row.dataset.user;
  const role = appState.users.find(u=>u.id===userId)?.role || "";
  const isDaily = role === "daily";
  const salary = numberValue($(".comp-salary", row).value);
  const otOther = numberValue($(".comp-ot", row).value);
  const dessertOT = numberValue($(".comp-dessert", row).dataset.value);
  const boothBonus = numberValue($(".comp-booth", row).value);
  const rendoOT = numberValue($(".comp-rendo", row)?.dataset.value);
  const dailyBonus = isDaily ? 0 : numberValue($(".comp-daily", row)?.dataset.value);
  const monthlyBonus = isDaily ? 0 : numberValue($(".comp-monthly", row)?.dataset.value);
  const deduction = numberValue($(".comp-deduction", row).value);
  const advances = numberValue($(".comp-advance", row).dataset.value);
  const employeeSS = isDaily ? 0 : salary * .05;
  const employerSS = isDaily ? 0 : salary * .05;
  const netTransfer = salary + otOther + dessertOT + boothBonus + rendoOT + dailyBonus + monthlyBonus - deduction - advances - employeeSS;
  const totalIncome = salary + otOther + dessertOT + boothBonus + rendoOT + dailyBonus + monthlyBonus;
  const dailyFullWageBeforeExclude = numberValue(row.dataset.dailyFullWage);
  const dailyHourlyWageBeforeExclude = numberValue(row.dataset.dailyHourlyWage);
  const dailyFullPaidAlready = !!$(".comp-daily-full-paid", row)?.checked;
  const dailyHourlyPaidAlready = !!$(".comp-daily-hourly-paid", row)?.checked;
  return {
    monthKey, userId, userName:userName(userId), role, isDaily,
    salary, dailyWageBeforeExclude:numberValue(row.dataset.dailyWage),
    dailyFullWageBeforeExclude, dailyHourlyWageBeforeExclude, dailyFullPaidAlready, dailyHourlyPaidAlready,
    dailyPaidAlready:isDaily && dailyFullPaidAlready && dailyHourlyPaidAlready,
    otOther, otOtherNote:$(".comp-ot-note", row)?.value.trim() || "", dessertOT,
    boothBonus, rendoOT, dailyBonus, monthlyBonus, deduction, deductionNote:$(".comp-deduction-note", row)?.value.trim() || "",
    advances, employeeSS, employerSS, totalIncome, netTransfer, totalCost:salary + otOther + dessertOT + boothBonus + rendoOT + dailyBonus + monthlyBonus - deduction + employerSS,
    createdBy:appState.currentUser?.name || "-", createdAt:new Date()
  };
}

function buildCompSummaryFromData(d){
  const wageLines = d.isDaily ? [
    `ค่าจ้างวันที่ทำงานทั้งวัน: ${money(d.dailyFullPaidAlready ? 0 : d.dailyFullWageBeforeExclude)} บาท${d.dailyFullPaidAlready ? ` (ได้รับแล้ว ไม่นำยอดเดิม ${money(d.dailyFullWageBeforeExclude)} บาทมาคำนวณ)` : ""}`,
    `ค่าจ้างวันที่ทำงานรายชั่วโมง: ${money(d.dailyHourlyPaidAlready ? 0 : d.dailyHourlyWageBeforeExclude)} บาท${d.dailyHourlyPaidAlready ? ` (ได้รับแล้ว ไม่นำยอดเดิม ${money(d.dailyHourlyWageBeforeExclude)} บาทมาคำนวณ)` : ""}`,
    `ค่าจ้างรายวันที่นำมาคำนวณ: ${money(d.salary)} บาท`
  ] : [`เงินเดือน: ${money(d.salary)} บาท`];
  const lines = [
    `สรุปค่าตอบแทน Love Matcha`,
    `เดือน: ${thaiMonth(d.monthKey)}`,
    `ชื่อ: ${d.userName}`,
    ...wageLines,
    `OT เพิ่มอื่น ๆ: ${money(d.otOther)} บาท${d.otOtherNote ? ` (${d.otOtherNote})` : ""}`,
    `OT ทำขนม: ${money(d.dessertOT)} บาท`,
    `เงินเพิ่มออกบูธ: ${money(d.boothBonus)} บาท`,
    `OT พาร์ทไทม์ Rendo: ${money(d.rendoOT)} บาท`,
    ...(!d.isDaily ? [`โบนัสรายวัน: ${money(d.dailyBonus)} บาท`, `โบนัสรายเดือน: ${money(d.monthlyBonus)} บาท`] : []),
    `รวมรายรับก่อนหัก: ${money(d.totalIncome)} บาท`,
    `หักเงิน: ${money(d.deduction)} บาท${d.deductionNote ? ` (${d.deductionNote})` : ""}`,
    `เบิกล่วงหน้า: ${money(d.advances)} บาท`,
    ...(!d.isDaily ? [`ประกันสังคมฝ่ายลูกจ้าง: ${money(d.employeeSS)} บาท`] : []),
    `ยอดที่ต้องโอนปลายเดือน: ${money(d.netTransfer)} บาท`
  ];
  return lines.join("\n");
}

function buildCompPdfHtml(d){
  const role = ROLE_LABELS[d.role] || d.role || "-";
  const madeAt = `${thaiDate(d.createdAt.toISOString().slice(0,10))} ${String(d.createdAt.getHours()).padStart(2,"0")}:${String(d.createdAt.getMinutes()).padStart(2,"0")}`;
  const item = (name, amount, note="") => `<tr><td>${escapeHtml(name)}${note?`<div class="pdf-note">${escapeHtml(note)}</div>`:""}</td><td class="pdf-money">${money(amount)}</td></tr>`;
  const dailyWageRows = d.isDaily ? `
      ${item("ค่าจ้างวันที่ทำงานทั้งวัน", d.dailyFullPaidAlready ? 0 : d.dailyFullWageBeforeExclude, d.dailyFullPaidAlready ? `ได้รับแล้ว จึงไม่นำยอดเดิม ${money(d.dailyFullWageBeforeExclude)} บาทมาคำนวณ` : "")}
      ${item("ค่าจ้างวันที่ทำงานรายชั่วโมง", d.dailyHourlyPaidAlready ? 0 : d.dailyHourlyWageBeforeExclude, d.dailyHourlyPaidAlready ? `ได้รับแล้ว จึงไม่นำยอดเดิม ${money(d.dailyHourlyWageBeforeExclude)} บาทมาคำนวณ` : "")}
      ${item("ค่าจ้างรายวันที่นำมาคำนวณ", d.salary)}` : item("เงินเดือน", d.salary);
  return `<div class="pdf-document">
    <div class="pdf-header"><img src="${escapeHtml(appState.settings.logoUrl || "./icons/logo.png")}" alt="logo"><div><h1>สรุปค่าตอบแทน</h1><p>${escapeHtml(appState.settings.storeName || "Love Matcha")} · ${thaiMonth(d.monthKey)}</p></div></div>
    <div class="pdf-info-grid"><div><small>ชื่อพนักงาน</small><b>${escapeHtml(d.userName)}</b></div><div><small>ตำแหน่ง</small><b>${escapeHtml(role)}</b></div><div><small>จัดทำโดย</small><b>${escapeHtml(d.createdBy)}</b></div><div><small>วันที่จัดทำ</small><b>${madeAt}</b></div></div>
    <table class="pdf-table"><thead><tr><th>รายการ</th><th>จำนวนเงิน (บาท)</th></tr></thead><tbody>
      ${dailyWageRows}
      ${item("OT เพิ่มอื่น ๆ", d.otOther, d.otOtherNote)}${item("OT ทำขนม", d.dessertOT)}${item("เงินเพิ่มออกบูธ", d.boothBonus)}${item("OT พาร์ทไทม์ Rendo", d.rendoOT)}
      ${!d.isDaily ? `${item("โบนัสรายวัน", d.dailyBonus)}${item("โบนัสรายเดือน", d.monthlyBonus)}` : ""}
      <tr class="pdf-subtotal"><td>รวมรายรับก่อนหัก</td><td class="pdf-money">${money(d.totalIncome)}</td></tr>
      ${item("หักเงิน", -Math.abs(d.deduction), d.deductionNote)}${item("เบิกล่วงหน้า", -Math.abs(d.advances))}
      ${!d.isDaily ? item("ประกันสังคมฝ่ายลูกจ้าง", -Math.abs(d.employeeSS)) : ""}
      <tr class="pdf-total"><td>ยอดที่ต้องโอนปลายเดือน</td><td class="pdf-money">${money(d.netTransfer)}</td></tr>
    </tbody></table>
    <div class="pdf-note-box"><b>หมายเหตุ</b><br>${d.isDaily ? "รายวันแยกค่าจ้างทั้งวันและรายชั่วโมง หากติ๊กว่าได้รับแล้ว ระบบจะไม่นำยอดส่วนนั้นมาคำนวณซ้ำ" : "ยอดเงินนี้เป็นสรุปสำหรับตรวจสอบก่อนโอนปลายเดือน"}</div>
  </div>`;
}

function closeCompPdfModal(){ const modal = $("#compPdfModal"); if(modal) modal.remove(); }
function openCompPdfDetail(row, monthKey){
  const d = getCompRowData(row, monthKey);
  closeCompPdfModal();
  const modal = document.createElement("div");
  modal.id = "compPdfModal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `<div class="modal-card compensation-modal" role="dialog" aria-modal="true" aria-label="รายละเอียดค่าตอบแทน"><div class="modal-head"><div><h3>รายละเอียดเงิน / PDF</h3><p>${escapeHtml(d.userName)} · ${thaiMonth(monthKey)}</p></div><button type="button" class="btn ghost small close-comp-pdf">ปิดกลับหน้าเดิม</button></div><div id="compPdfSheet" class="pdf-sheet">${buildCompPdfHtml(d)}</div><div class="modal-actions"><button type="button" class="btn secondary copy-comp-text">คัดลอกข้อความ</button><button type="button" class="btn secondary download-comp-pdf">สร้าง/ดาวน์โหลด PDF</button><button type="button" class="btn share-comp-pdf">แชร์ PDF ไป LINE</button></div></div>`;
  document.body.appendChild(modal);
  $(".close-comp-pdf", modal).onclick = closeCompPdfModal;
  modal.addEventListener("click", e=>{ if(e.target === modal) closeCompPdfModal(); });
  $(".copy-comp-text", modal).onclick = async()=>{ const text = buildCompSummaryFromData(d); try{ await navigator.clipboard.writeText(text); showToast("คัดลอกสรุปแล้ว นำไปวางส่งใน LINE ได้เลย"); } catch(_){ alert(text); } };
  $(".download-comp-pdf", modal).onclick = ()=>downloadCompPdf(d);
  $(".share-comp-pdf", modal).onclick = ()=>shareCompPdf(d);
}
async function makeCompPdfFile(d){
  const el = $("#compPdfSheet");
  const filename = `LoveMatcha_ค่าตอบแทน_${safeFileName(d.userName)}_${d.monthKey}.pdf`;
  if(!el) throw new Error("ไม่พบหน้ารายละเอียด PDF");
  if(!window.html2pdf) throw new Error("ยังโหลดตัวสร้าง PDF ไม่สำเร็จ กรุณาเช็กอินเทอร์เน็ตแล้วลองใหม่");
  const worker = window.html2pdf().set({margin:[8,8,8,8], filename, image:{type:"jpeg", quality:0.98}, html2canvas:{scale:2, useCORS:true, backgroundColor:"#ffffff"}, jsPDF:{unit:"mm", format:"a4", orientation:"portrait"}}).from(el);
  const blob = await worker.outputPdf("blob");
  return new File([blob], filename, {type:"application/pdf"});
}
async function downloadCompPdf(d){ try{ const file = await makeCompPdfFile(d); const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1500); showToast("สร้างไฟล์ PDF แล้ว สามารถส่งต่อใน LINE ได้"); }catch(e){ showToast(e.message || "สร้าง PDF ไม่สำเร็จ"); } }
async function shareCompPdf(d){
  try{ const file = await makeCompPdfFile(d); const shareData = {files:[file], title:`สรุปค่าตอบแทน ${d.userName}`, text:`สรุปค่าตอบแทน ${thaiMonth(d.monthKey)} ของ ${d.userName}`}; if(navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share(shareData); }else{ await downloadCompPdf(d); try{ await navigator.clipboard.writeText(buildCompSummaryFromData(d)); }catch(_){ } showToast("เครื่องนี้แชร์ไฟล์ตรงไม่ได้ จึงดาวน์โหลด PDF และคัดลอกข้อความให้แล้ว"); }}catch(e){ showToast(e.message || "แชร์ PDF ไม่สำเร็จ"); }
}
async function shareCompSummary(row, monthKey){ openCompPdfDetail(row, monthKey); }
async function saveCompRow(row, monthKey){
  if(!requireOnline()) return;
  const d = getCompRowData(row, monthKey);
  const data = {
    userId:d.userId, userName:d.userName, role:d.role, monthKey:d.monthKey, isDaily:d.isDaily,
    salary:d.salary, dailyWageBeforeExclude:d.dailyWageBeforeExclude,
    dailyFullWageBeforeExclude:d.dailyFullWageBeforeExclude, dailyHourlyWageBeforeExclude:d.dailyHourlyWageBeforeExclude,
    dailyFullPaidAlready:d.dailyFullPaidAlready, dailyHourlyPaidAlready:d.dailyHourlyPaidAlready, dailyPaidAlready:d.dailyPaidAlready,
    otOther:d.otOther, otOtherNote:d.otOtherNote, dessertOT:d.dessertOT, boothBonus:d.boothBonus, rendoOT:d.rendoOT,
    dailyBonus:d.dailyBonus, monthlyBonus:d.monthlyBonus, dailyBonusOverride:null, monthlyBonusOverride:null,
    deduction:d.deduction, deductionNote:d.deductionNote, advances:d.advances,
    employeeSocialSecurity:d.employeeSS, employerSocialSecurity:d.employerSS, netTransfer:d.netTransfer, totalCost:d.totalCost,
    updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id, updatedByName:appState.currentUser.name
  };
  const id = `${monthKey}_${d.userId}`;
  const ref = doc(appState.db, "compensationRecords", id);
  const before = await getDoc(ref);
  await setDoc(ref, data, {merge:true});
  await audit("แก้ค่าตอบแทน", {monthKey, user:d.userName}, before.exists()?before.data():null, data);
  await afterWrite("compensation");
  showToast(`บันทึกค่าตอบแทนของ ${d.userName} แล้ว`);
}

async function saveDailyPaySettings(){
  if(!requireOnline()) return;
  const hourAmount = numberValue($("#dailyHourPay").value);
  const rendoHourAmount = numberValue($("#rendoHourPay").value);
  const dailyWorkerPay = {fullDayAmount:numberValue($("#dailyFullPay").value), hourAmount, halfHourAmount:hourAmount / 2};
  const rendoPartTimePay = {hourAmount:rendoHourAmount};
  if(dailyWorkerPay.fullDayAmount <= 0 || dailyWorkerPay.hourAmount <= 0 || rendoPartTimePay.hourAmount <= 0) return showToast("กรุณากรอกค่าตอบแทนรายวัน/Rendo ให้ถูกต้อง");
  await updateSettings({...appState.settings, dailyWorkerPay, rendoPartTimePay}, "ตั้งค่าค่าตอบแทนพนักงานรายวัน/Rendo");
  showToast("บันทึกค่าตอบแทนพนักงานรายวัน/Rendo แล้ว");
  await loadCompensation();
}
async function renderHistory(){
  if(!isOwnerOrManager()) return content().innerHTML = `<div class="state error">ไม่มีสิทธิ์เข้าหน้านี้</div>`;
  content().innerHTML = `${pageTitle("ประวัติ", "แสดงเฉพาะประวัติการแก้ไขหน้ายอดขายและเช็คชื่อ")}<div id="historyResult" class="panel"><div class="loading">กำลังโหลดประวัติ...</div></div>`;
  await loadHistory("primary");
}
async function renderSystemHistory(){
  if(!isOwner()) return content().innerHTML = `<div class="state error">เฉพาะเจ้าของเท่านั้น</div>`;
  content().innerHTML = `${pageTitle("ประวัติระบบ", "ข้อมูล Login / ค่าตอบแทน / ตั้งค่า และรายการระบบอื่น ๆ เห็นเฉพาะเจ้าของ")}<div id="historyResult" class="panel"><div class="loading">กำลังโหลดประวัติระบบ...</div></div>`;
  await loadHistory("system");
}
function formatAuditDetails(row){
  const d = row.details || {};
  const parts = [];
  if(d.date) parts.push(`วันที่ ${thaiDate(d.date)}`);
  if(d.monthKey) parts.push(`เดือน ${thaiMonth(d.monthKey)}`);
  if(d.branch) parts.push(`สาขา ${d.branch}`);
  if(d.user) parts.push(`ผู้เกี่ยวข้อง ${d.user}`);
  if(d.status) parts.push(`สถานะ ${d.status}`);
  if(d.name) parts.push(`ชื่อ ${d.name}`);
  if(d.role) parts.push(`ระดับ ${d.role}`);
  if(d.selectedUser) parts.push(`เลือกชื่อ ${d.selectedUser}`);
  if(d.backupType) parts.push(`ชนิด ${d.backupType}`);
  const before = row.before || {};
  const after = row.after || {};
  if(row.action.includes("ยอดขาย") && after.date){
    parts.push(`รายได้รวมทั้งหมด ${money(after.totalAll)} บาท`);
    if(after.closed) parts.push("บันทึกเป็นวันหยุด");
  }
  if(row.action.includes("ค่าตอบแทน") && after.netTransfer !== undefined){
    parts.push(`ยอดโอนปลายเดือน ${money(after.netTransfer)} บาท`);
  }
  if(row.action.includes("เปลี่ยน PIN")) parts.push("มีการเปลี่ยน PIN สำเร็จ");
  if(row.action === "login_success") parts.push("เข้าสู่ระบบสำเร็จ");
  if(row.action === "login_failed") parts.push("เข้าสู่ระบบไม่สำเร็จ");
  if(!parts.length && Object.keys(d).length) parts.push(Object.entries(d).map(([k,v])=>`${k}: ${v}`).join(" / "));
  if(!parts.length && (before.id || after.id)) parts.push("มีการแก้ไขข้อมูลในระบบ");
  return parts.join("<br>") || "-";
}
async function loadHistory(mode="primary"){
  const snap = await getDocs(query(collection(appState.db, "auditLogs"), orderBy("createdAtISO","desc"), limit(250)));
  let rows = snap.docs.map(d=>({id:d.id, ...d.data()})).filter(r=>!HIDDEN_HISTORY_ACTIONS.has(r.action));
  rows = rows.filter(r=> mode === "system" ? (!isPrimaryHistoryAction(r.action) && !String(r.action||"").toLowerCase().includes("backup") && !String(r.action||"").includes("สำรอง")) : isPrimaryHistoryAction(r.action));
  if(!isOwner()) rows = rows.filter(r=>!r.hidden);
  const title = mode === "system" ? "รายการระบบล่าสุด" : "รายการยอดขายและเช็คชื่อล่าสุด";
  $("#historyResult").innerHTML = `
    <div class="flex"><h3>${title}</h3><button id="reloadHistory" class="btn secondary small">โหลดใหม่</button></div>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>รายการ</th><th>รายละเอียดที่เข้าใจง่าย</th><th>ซ่อน</th></tr></thead>
      <tbody>${rows.map(r=>`<tr class="${r.hidden?"hidden-log":""}">
        <td>${formatTs(r.createdAt || r.createdAtISO)}</td>
        <td>${escapeHtml(r.actorName || "-")}<br><small>${ROLE_LABELS[r.role] || ""}</small></td>
        <td><b>${escapeHtml(r.action)}</b></td>
        <td>${formatAuditDetails(r)}</td>
        <td>${isOwner()?`<button class="btn small ${r.hidden?"secondary":"ghost"} write-action toggle-log" data-id="${r.id}" data-hidden="${r.hidden?"1":"0"}">${r.hidden?"แสดงกลับ":"ซ่อน"}</button>`:"-"}</td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มีประวัติ</div>`}`;
  $("#reloadHistory").onclick = ()=>loadHistory(mode);
  $$(".toggle-log").forEach(btn=>btn.onclick=async ()=>{
    if(!requireOnline()) return;
    await updateDoc(doc(appState.db, "auditLogs", btn.dataset.id), {hidden:btn.dataset.hidden!=="1", updatedAt:serverTimestamp()});
    await loadHistory(mode);
  });
  updateOnlineUi();
}
async function renderBackup(){
  if(!isOwner()) return content().innerHTML = `<div class="state error">เฉพาะเจ้าของเท่านั้น</div>`;
  const auto = appState.settings.autoBackup || DEFAULT_SETTINGS.autoBackup;
  content().innerHTML = `
    ${pageTitle("สำรองข้อมูล", "Export / Backup ไป Google Drive / Restore เฉพาะไฟล์ JSON")}
    <div class="panel">
      <h3>Google Apps Script Web App URL</h3>
      <div class="field"><label>URL</label><input id="backupUrl" value="${escapeHtml(auto.url || "")}" placeholder="https://script.google.com/macros/s/.../exec"></div>
      <div class="grid three" style="margin-top:10px">
        <div class="field"><label>Auto Backup</label><select id="backupMode">
          ${["off","interval","onAction","both"].map(x=>`<option value="${x}" ${auto.mode===x?"selected":""}>${({off:"ปิด",interval:"สำรองทุกกี่นาที",onAction:"สำรองเมื่อมีการทำรายการ",both:"ทั้งสองแบบ"}[x])}</option>`).join("")}
        </select></div>
        <div class="field"><label>ทุกกี่นาที</label><input id="backupInterval" inputmode="numeric" value="${auto.intervalMinutes || 60}"></div>
        <div class="field"><label>&nbsp;</label><button id="saveBackupSetting" class="btn write-action">บันทึกตั้งค่า</button></div>
      </div>
      <div class="flex" style="margin-top:10px">
        <button id="testBackupUrl" class="btn secondary write-action">ทดสอบสร้างไฟล์ใน Drive</button>
        <button id="manualBackup" class="btn write-action">Backup ไป Drive ตอนนี้</button>
        <button id="exportFullJson" class="btn secondary">Export JSON</button>
      </div>
      <div id="backupState"></div>
    </div>
    <div class="panel">
      <h3>Restore Backup</h3>
      <div class="state warn">ก่อน Restore ระบบจะสร้าง Backup ปัจจุบันให้อีกชุด และต้องกรอก PIN เจ้าของยืนยัน</div>
      <div class="field"><label>เลือกไฟล์ JSON Backup</label><input id="restoreFile" type="file" accept=".json,application/json"></div>
      <div id="restorePreview"></div>
      <div class="grid two">
        <div class="field"><label>PIN เจ้าของ</label><input id="restorePin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
        <div class="field"><label>&nbsp;</label><button id="restoreBtn" class="btn danger write-action" disabled>Restore ข้อมูล</button></div>
      </div>
    </div>`;
  $("#saveBackupSetting").onclick = saveBackupSettings;
  $("#testBackupUrl").onclick = testBackupUrl;
  $("#manualBackup").onclick = ()=>performBackup("manual", false);
  $("#exportFullJson").onclick = async ()=>downloadText(`LoveMatcha_FullBackup_${new Date().toISOString().slice(0,19).replaceAll(":","-")}.json`, JSON.stringify(await buildFullBackup(), null, 2), "application/json");
  $("#restoreFile").onchange = handleRestoreFile;
  $("#restoreBtn").onclick = restoreData;
  updateOnlineUi();
}
async function saveBackupSettings(){
  if(!requireOnline()) return;
  appState.settings.autoBackup = {url:$("#backupUrl").value.trim(), mode:$("#backupMode").value, intervalMinutes:Math.max(1, numberValue($("#backupInterval").value))};
  await updateSettings(appState.settings, "ตั้งค่าสำรองข้อมูล");
  setupAutoBackupTimer();
  showToast("บันทึกตั้งค่าสำรองข้อมูลแล้ว");
}
async function buildFullBackup(){
  const collections = {};
  for(const name of COLLECTIONS){
    const snap = await getDocs(collection(appState.db, name));
    collections[name] = snap.docs.map(d=>({id:d.id, data:safeClone(d.data())}));
  }
  return {app:"Love Matcha Sales", version:VERSION, exportedAt:new Date().toISOString(), collections};
}
async function submitBackupViaForm(url, payload){
  // Google Apps Script Web App ไม่ส่ง CORS header ให้ browser อ่านผลได้แน่นอน
  // จึงใช้ hidden form POST ซึ่งส่งข้ามโดเมนได้เสถียรกว่า fetch no-cors และ Apps Script รับค่า payload ได้โดยตรง
  return new Promise((resolve, reject)=>{
    try{
      const frameName = `backup_frame_${Date.now()}`;
      const iframe = document.createElement("iframe");
      iframe.name = frameName;
      iframe.style.display = "none";
      document.body.appendChild(iframe);

      const form = document.createElement("form");
      form.method = "POST";
      form.action = url;
      form.target = frameName;
      form.enctype = "application/x-www-form-urlencoded";
      form.style.display = "none";

      const action = document.createElement("input");
      action.type = "hidden";
      action.name = "action";
      action.value = "backup";
      form.appendChild(action);

      const field = document.createElement("textarea");
      field.name = "payload";
      field.value = payload;
      form.appendChild(field);

      document.body.appendChild(form);
      form.submit();
      setTimeout(()=>{
        form.remove();
        iframe.remove();
        resolve(true);
      }, 3000);
    }catch(e){
      reject(e);
    }
  });
}
async function performBackup(reason="manual", quiet=false){
  if(!requireOnline()) return;
  const backup = await buildFullBackup();
  const url = (appState.settings.autoBackup?.url || $("#backupUrl")?.value || "").trim();
  if(!url) {
    if(!quiet) showToast("ยังไม่ได้กรอก Google Apps Script Web App URL");
    return;
  }
  const counts = Object.fromEntries(Object.entries(backup.collections).map(([k,v])=>[k,v.length]));
  const payload = JSON.stringify(backup);
  if(!quiet) $("#backupState").innerHTML = `<div class="state warn">กำลังส่ง Backup ไป Google Drive... ห้ามปิดหน้านี้จนกว่าจะขึ้นข้อความถัดไป</div>`;

  await submitBackupViaForm(url, payload);
  await addDoc(collection(appState.db, "backupsMetadata"), {reason, exportedAt:serverTimestamp(), exportedAtISO:new Date().toISOString(), url, collections:counts, createdBy:appState.currentUser?.id || null});
  if(reason !== "pre_restore") await audit("สำรองข้อมูล", {reason, collections:counts});
  if(!quiet) $("#backupState").innerHTML = `<div class="state ok">ส่งคำขอ Backup ไป Google Apps Script แล้ว รอสักครู่แล้วตรวจใน Google Drive โฟลเดอร์ LoveMatcha_Backups ถ้ายังไม่เห็นไฟล์ ให้กด “ทดสอบสร้างไฟล์ใน Drive” เพื่อตรวจสิทธิ์ Apps Script</div>`;
}
async function testBackupUrl(){
  if(!requireOnline()) return;
  const url = $("#backupUrl").value.trim();
  if(!url) return showToast("กรุณากรอก URL ก่อน");
  const testUrl = `${url}${url.includes("?") ? "&" : "?"}action=test&source=love_matcha_sales_app&ts=${Date.now()}`;
  window.open(testUrl, "_blank", "noopener,noreferrer");
  $("#backupState").innerHTML = `<div class="state warn">เปิดหน้าทดสอบ Apps Script แล้ว หน้าใหม่ต้องขึ้น Love Matcha Sales Backup v1.3.8 และมี jsonFileName / folderUrl ถ้ายังขึ้น v1.2 หรือยังมี sheetName แปลว่ายัง Deploy โค้ด Apps Script ใหม่ไม่สำเร็จ</div>`;
}
async function exportAllSalesCsv(){
  const snap = await getDocs(collection(appState.db, "dailySales"));
  const rows = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  downloadText(`LoveMatcha_AllDailySales.csv`, dailyRowsToCsv(rows), "text/csv");
}
async function handleRestoreFile(){
  const file = $("#restoreFile").files[0];
  if(!file) return;
  const lower = file.name.toLowerCase();
  if(!lower.endsWith(".json")){
    appState.restorePreview = null;
    $("#restorePreview").innerHTML = `<div class="state error">v1.3.8 รองรับ Restore เฉพาะไฟล์ .json เท่านั้น</div>`;
    $("#restoreBtn").disabled = true;
    return;
  }
  const text = await file.text();
  const obj = JSON.parse(text);
  if(!obj.collections) throw new Error("ไฟล์ JSON ไม่ใช่รูปแบบ Backup ของระบบ");
  const preview = {type:"json", data:obj, counts:Object.fromEntries(Object.entries(obj.collections).map(([k,v])=>[k, Array.isArray(v)?v.length:0]))};
  appState.restorePreview = preview;
  $("#restorePreview").innerHTML = `<div class="state ok"><b>Preview JSON:</b><pre class="preview">${escapeHtml(JSON.stringify(preview.counts, null, 2))}</pre></div>`;
  $("#restoreBtn").disabled = !appState.online;
}
function parseCsv(text){
  const rows=[]; let row=[], cell="", quote=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c === '"' && quote && n === '"'){ cell+='"'; i++; }
    else if(c === '"'){ quote = !quote; }
    else if(c === "," && !quote){ row.push(cell); cell=""; }
    else if((c === "\n" || c === "\r") && !quote){ if(cell || row.length){ row.push(cell); rows.push(row); row=[]; cell=""; } if(c === "\r" && n === "\n") i++; }
    else cell += c;
  }
  if(cell || row.length){ row.push(cell); rows.push(row); }
  return rows;
}
async function restoreData(){
  if(!requireOnline()) return;
  if(!isOwner()) return showToast("เฉพาะเจ้าของเท่านั้น");
  if($("#restorePin").value !== String(appState.currentUser.pin)) return showToast("PIN เจ้าของไม่ถูกต้อง");
  if(!appState.restorePreview) return showToast("ยังไม่ได้เลือกไฟล์");
  if(!confirm("ยืนยัน Restore ข้อมูล? ข้อมูลเดิมบางส่วนอาจถูกเขียนทับ")) return;
  await performBackup("pre_restore", true);
  const batchLimit = 400;
  let ops = [];
  const commitOps = async ()=>{
    if(!ops.length) return;
    const batch = writeBatch(appState.db);
    ops.forEach(op=>{
      if(op.type==="set") batch.set(doc(appState.db, op.collection, op.id), op.data, {merge:true});
    });
    await batch.commit();
    ops = [];
  };
  if(appState.restorePreview.type === "json"){
    for(const [col, docs] of Object.entries(appState.restorePreview.data.collections)){
      if(!COLLECTIONS.includes(col)) continue;
      for(const item of docs){
        ops.push({type:"set", collection:col, id:item.id || uid(col), data:item.data || {}});
        if(ops.length >= batchLimit) await commitOps();
      }
    }
  }else{
    const [headers, ...rows] = appState.restorePreview.rows;
    const idx = Object.fromEntries(headers.map((h,i)=>[h.replace(/^\ufeff/,""), i]));
    for(const r of rows){
      const date = r[idx.date], branchId = r[idx.branchId];
      if(!date || !branchId) continue;
      const id = `${branchId}_${date}`;
      ops.push({type:"set", collection:"dailySales", id, data:{
        date, monthKey:monthOf(date), branchId, closed:String(r[idx.closed]).toLowerCase()==="true",
        workerNames:String(r[idx.workerNames]||"").split(/\s+/).filter(Boolean), grossSales:numberValue(r[idx.grossSales]), discount:numberValue(r[idx.discount]),
        netSales:numberValue(r[idx.netSales]), cashSales:numberValue(r[idx.cashSales]), transferSales:numberValue(r[idx.transferSales]),
        lineMan:numberValue(r[idx.lineMan]), grab:numberValue(r[idx.grab]), totalAll:numberValue(r[idx.totalAll]), avgPerPerson:numberValue(r[idx.avgPerPerson]),
        cashOpen:numberValue(r[idx.cashOpen]), cashClose:numberValue(r[idx.cashClose]),
        cowMilkCost:numberValue(r[idx.cowMilkCost] ?? r[idx.milkCost]), cowMilkPaidTransfer:String(r[idx.cowMilkPaidTransfer]).toLowerCase()==="true",
        oatMilkCost:numberValue(r[idx.oatMilkCost]), oatMilkPaidTransfer:String(r[idx.oatMilkPaidTransfer]).toLowerCase()==="true",
        milkCost:numberValue(r[idx.milkCost]), milkCashOut:numberValue(r[idx.milkCashOut] ?? r[idx.milkCost]),
        otherExpenseTotal:numberValue(r[idx.otherExpenseTotal]), otherExpenseCashOut:numberValue(r[idx.otherExpenseCashOut] ?? r[idx.otherExpenseTotal]),
        ownerCashOut:numberValue(r[idx.ownerCashOut]), cashShouldRemain:numberValue(r[idx.cashShouldRemain]), cashDiff:numberValue(r[idx.cashDiff]),
        cupsUsed:numberValue(r[idx.cupsUsed]), note:r[idx.note] || "", restoredAt:serverTimestamp(), restoredBy:appState.currentUser.id
      }});
      if(ops.length >= batchLimit) await commitOps();
    }
  }
  await commitOps();
  await audit("restore backup", {counts:appState.restorePreview.counts});
  await loadBaseData();
  showToast("Restore สำเร็จ");
  navigate("backup");
}
function setupAutoBackupTimer(){
  if(appState.backupTimer) clearInterval(appState.backupTimer);
  const auto = appState.settings.autoBackup || {};
  if(auto.mode === "interval" || auto.mode === "both"){
    const mins = Math.max(1, numberValue(auto.intervalMinutes || 60));
    appState.backupTimer = setInterval(()=>performBackup("auto_interval", true), mins * 60 * 1000);
  }
}

async function renderUsers(){
  if(!["owner","manager","supervisor"].includes(appState.currentUser.role)) return content().innerHTML = `<div class="state error">ไม่มีสิทธิ์เข้าหน้านี้</div>`;
  await loadBaseData();
  const canCreateRoles = appState.currentUser.role === "owner" ? ["owner","manager","supervisor","staff","daily"] : appState.currentUser.role === "manager" ? ["manager","supervisor","staff","daily"] : ["staff","daily"];
  content().innerHTML = `
    ${pageTitle("จัดการผู้ใช้", "สร้างไอดี แก้ระดับ แก้สาขา และเปลี่ยน PIN")}
    <div class="panel">
      <h3>เปลี่ยน PIN ของฉัน</h3>
      <div class="grid three">
        <div class="field"><label>PIN เดิม</label><input id="oldPin" type="password" inputmode="numeric" maxlength="4"></div>
        <div class="field"><label>PIN ใหม่</label><input id="newPin" type="password" inputmode="numeric" maxlength="4"></div>
        <div class="field"><label>&nbsp;</label><button id="changeOwnPin" class="btn write-action">เปลี่ยน PIN</button></div>
      </div>
    </div>
    <form id="createUserForm" class="panel">
      <h3>สร้างผู้ใช้ใหม่</h3>
      <div class="grid three">
        <div class="field"><label>ชื่อ</label><input id="newUserName" placeholder="ชื่อพนักงาน"></div>
        <div class="field"><label>ระดับ</label><select id="newUserRole">${canCreateRoles.map(r=>`<option value="${r}">${ROLE_LABELS[r]}</option>`).join("")}</select></div>
        <div class="field"><label>PIN 4 ตัว</label><input id="newUserPin" type="password" inputmode="numeric" maxlength="4"></div>
      </div>
      <div class="field" style="margin-top:10px"><label>สาขาที่ประจำ</label><div id="newUserBranches" class="check-list">${activeBranches().map(b=>`<label class="check-item"><input type="checkbox" value="${b.id}"> ${escapeHtml(b.name)}</label>`).join("")}</div><small>เจ้าของ/ผู้จัดการจะเห็นทุกสาขาอัตโนมัติ</small></div>
      <div class="sticky-save"><button class="btn full write-action">สร้างผู้ใช้</button></div>
    </form>
    <div class="panel">
      <h3>รายชื่อผู้ใช้</h3>
      ${usersTable()}
    </div>`;
  $("#changeOwnPin").onclick = changeOwnPin;
  $("#createUserForm").onsubmit = createUser;
  $$(".save-user").forEach(btn=>btn.onclick = ()=>saveUser(btn.closest("tr")));
  $$(".delete-user").forEach(btn=>btn.onclick = ()=>deleteUser(btn.closest("tr")));
  updateOnlineUi();
}
function usersTable(){
  const rolesAllowedForManager = ["manager","supervisor","staff","daily"];
  return `<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>ระดับ</th><th>สาขา</th><th>PIN</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>
    ${appState.users.map(u=>{
      const canEdit = canEditUser(u);
      const roleOptions = Object.keys(ROLE_LABELS).filter(r => isOwner() || rolesAllowedForManager.includes(r)).map(r=>`<option value="${r}" ${u.role===r?"selected":""}>${ROLE_LABELS[r]}</option>`).join("");
      return `<tr data-user="${u.id}">
        <td><input class="u-name" value="${escapeHtml(u.name)}" ${canEdit?"":"disabled"}></td>
        <td><select class="u-role" ${canEdit && u.id!==appState.currentUser.id && (isOwner() || isManager())?"":"disabled"}>${roleOptions}</select></td>
        <td>${branchChecksHtml(u, canEdit)}</td>
        <td>${isOwner()?`<input class="u-pin" value="${escapeHtml(u.pin || "")}" inputmode="numeric" maxlength="4" ${canEdit?"":"disabled"}>`:"••••"}</td>
        <td><select class="u-active" ${canEdit?"":"disabled"}><option value="true" ${u.active!==false?"selected":""}>ใช้งาน</option><option value="false" ${u.active===false?"selected":""}>ปิดใช้</option></select></td>
        <td class="row-actions">${canEdit?`<button class="btn small write-action save-user">บันทึก</button>`:""}${canDeleteUser(u)?`<button class="btn danger small write-action delete-user">ลบ</button>`:""}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}
function branchChecksHtml(u, canEdit){
  if(["owner","manager"].includes(u.role)) return `<span class="pill ok">ทุกสาขา</span>`;
  return `<div class="check-list">${activeBranches().map(b=>`<label class="check-item"><input class="u-branch" type="checkbox" value="${b.id}" ${(u.branchIds||[]).includes(b.id)?"checked":""} ${canEditBranch(u)&&canEdit?"":"disabled"}> ${escapeHtml(b.name)}</label>`).join("")}</div>`;
}
function canEditUser(u){
  if(u.id === appState.currentUser.id) return true;
  if(isOwner()) return true;
  if(isManager()) return u.role !== "owner";
  if(appState.currentUser.role === "supervisor") return ["staff","daily"].includes(u.role) && (u.branchIds||[]).some(id=>(appState.currentUser.branchIds||[]).includes(id));
  return false;
}
function canEditBranch(u){
  if(isOwner()) return u.id !== appState.currentUser.id;
  if(isManager()) return ["supervisor","staff","daily"].includes(u.role);
  return false;
}
function canDeleteUser(u){
  if(u.id === appState.currentUser.id) return false;
  if(isOwner()) return u.role !== "owner";
  if(isManager()) return ["supervisor","staff","daily"].includes(u.role);
  return false;
}
async function changeOwnPin(){
  const oldPin = $("#oldPin").value.trim(), newPin=$("#newPin").value.trim();
  await changeOwnPinByValues(oldPin, newPin);
  if($("#oldPin")) $("#oldPin").value = "";
  if($("#newPin")) $("#newPin").value = "";
}
async function createUser(e){
  e.preventDefault();
  if(!requireOnline()) return;
  const name=$("#newUserName").value.trim(), role=$("#newUserRole").value, pin=$("#newUserPin").value.trim();
  if(!name || !/^\d{4}$/.test(pin)) return showToast("กรุณากรอกชื่อและ PIN 4 ตัว");
  if(appState.currentUser.role==="supervisor" && !["staff","daily"].includes(role)) return showToast("หัวหน้างานสร้างได้เฉพาะพนักงานหรือรายวัน");
  const branchIds = ["owner","manager"].includes(role) ? ["ALL"] : $$("#newUserBranches input:checked").map(x=>x.value);
  if(!["owner","manager"].includes(role) && branchIds.length < 1) return showToast("กรุณาเลือกสาขาอย่างน้อย 1 สาขา");
  const data = {name, role, pin, branchIds, active:true, createdAt:serverTimestamp(), createdBy:appState.currentUser.id, createdByName:appState.currentUser.name, updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id};
  const ref = doc(appState.db, "users", uid("user"));
  await setDoc(ref, data);
  await audit("เพิ่ม user", {name, role:ROLE_LABELS[role]}, null, {...data, pin:isOwner()?pin:"****"});
  await afterWrite("user");
  showToast("สร้างผู้ใช้สำเร็จ");
  await renderUsers();
}
async function saveUser(row){
  if(!requireOnline()) return;
  const userId = row.dataset.user;
  const u = appState.users.find(x=>x.id===userId);
  if(!canEditUser(u)) return showToast("ไม่มีสิทธิ์แก้ไขผู้ใช้นี้");
  const role = $(".u-role", row).value;
  if(userId === appState.currentUser.id && role !== appState.currentUser.role) return showToast("ห้ามเปลี่ยนระดับตัวเอง");
  const branchIds = ["owner","manager"].includes(role) ? ["ALL"] : $$(".u-branch:checked", row).map(x=>x.value);
  const data = {
    name:$(".u-name", row).value.trim(), role, active:$(".u-active", row).value === "true",
    branchIds, updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id, updatedByName:appState.currentUser.name
  };
  const pinInput = $(".u-pin", row);
  if(isOwner() && pinInput){
    if(!/^\d{4}$/.test(pinInput.value.trim())) return showToast("PIN ต้องเป็นตัวเลข 4 ตัว");
    data.pin = pinInput.value.trim();
  }
  const before = safeClone(u);
  await updateDoc(doc(appState.db, "users", userId), data);
  await audit("แก้ไข user", {user:u.name}, isOwner()?before:{...before,pin:"****"}, isOwner()?data:{...data,pin:"****"});
  await afterWrite("user");
  showToast("บันทึกผู้ใช้แล้ว");
  await renderUsers();
}
async function deleteUser(row){
  if(!requireOnline()) return;
  const userId = row.dataset.user;
  const u = appState.users.find(x=>x.id===userId);
  if(!canDeleteUser(u)) return showToast("ไม่มีสิทธิ์ลบผู้ใช้นี้");
  const pin = prompt("กรอก PIN ของคุณเพื่อยืนยันการลบ");
  if(pin !== String(appState.currentUser.pin)) return showToast("PIN ไม่ถูกต้อง");
  if(!confirm(`ยืนยันลบไอดี ${u.name}?`)) return;
  await deleteDoc(doc(appState.db, "users", userId));
  await audit("ลบ user", {user:u.name}, isOwner()?u:{...u,pin:"****"}, null);
  await afterWrite("user");
  showToast("ลบผู้ใช้แล้ว");
  await renderUsers();
}
async function renderSettings(){
  if(!isOwnerOrManager()) return content().innerHTML = `<div class="state error">ไม่มีสิทธิ์เข้าหน้านี้</div>`;
  const s = appState.settings;
  content().innerHTML = `
    ${pageTitle("ตั้งค่า", "ปรับสี ชื่อร้าน สาขา และโบนัส")}
    <div class="panel">
      <h3>หน้าตาเว็บ</h3>
      ${!isOwner()?`<div class="state warn">ผู้จัดการปรับได้เฉพาะเกณฑ์โบนัสและสาขาตามสิทธิ์ ส่วนสี/โลโก้ให้เจ้าของปรับ</div>`:""}
      <div class="grid three">
        <div class="field"><label>ชื่อร้าน</label><input id="setStoreName" value="${escapeHtml(s.storeName)}" ${isOwner()?"":"disabled"}></div>
        <div class="field"><label>สีหลัก</label><input id="setPrimary" type="color" value="${escapeHtml(s.primaryColor)}" ${isOwner()?"":"disabled"}></div>
        <div class="field"><label>สีรอง</label><input id="setSecondary" type="color" value="${escapeHtml(s.secondaryColor)}" ${isOwner()?"":"disabled"}></div>
        <div class="field"><label>ขนาดตัวอักษร</label><select id="setFontScale" ${isOwner()?"":"disabled"}>
          ${[[0.95,"เล็ก"],[1,"ปกติ"],[1.1,"ใหญ่"],[1.2,"ใหญ่มาก"]].map(([v,t])=>`<option value="${v}" ${Number(s.fontScale)===v?"selected":""}>${t}</option>`).join("")}
        </select></div>
        <div class="field"><label>โลโก้ (URL หรือ Base64)</label><input id="setLogoUrl" value="${escapeHtml(s.logoUrl || "")}" ${isOwner()?"":"disabled"}></div>
        <div class="field"><label>อัปโหลดโลโก้ใหม่</label><input id="setLogoFile" type="file" accept="image/*" ${isOwner()?"":"disabled"}></div>
      </div>
      <button id="saveVisualSettings" class="btn write-action" style="margin-top:10px" ${isOwner()?"":"disabled"}>บันทึกหน้าตาเว็บ</button>
    </div>

    <div class="panel">
      <div class="flex"><h3>สาขา</h3><button id="addBranch" class="btn secondary small write-action">+ เพิ่มสาขา</button></div>
      <div id="branchesSettings" class="grid">${branchSettingRows()}</div>
      <button id="saveBranches" class="btn write-action" style="margin-top:10px">บันทึกสาขา</button>
    </div>

    <div class="panel">
      <h3>เกณฑ์โบนัสรายวัน</h3>
      <div id="dailyBonusRows" class="grid">${activeBranches().map(b=>{
        const r = s.dailyBonus?.[b.id] || {enabled:false, threshold:0, amount:0};
        return `<div class="grid three bonus-row" data-branch="${b.id}">
          <label class="check-item"><input class="bonus-enabled" type="checkbox" ${r.enabled?"checked":""}> ${escapeHtml(b.name)} เปิดโบนัส</label>
          <div class="field"><label>ยอดเกิน (บาท)</label><input class="bonus-threshold" inputmode="decimal" value="${numberValue(r.threshold)}"></div>
          <div class="field"><label>เงิน/คน/วัน</label><input class="bonus-amount" inputmode="decimal" value="${numberValue(r.amount)}"></div>
        </div>`;
      }).join("")}</div>
      <button id="saveBonus" class="btn write-action" style="margin-top:10px">บันทึกเกณฑ์โบนัส</button>
    </div>

    <div class="panel">
      <h3>เกณฑ์โบนัสรายเดือน</h3>
      <div class="state warn">กฎหลัก: เกิน 100,000 ได้สูงสุด 1,000 บาท / ถ้าไม่ถึง 100,000 ให้คิดเฉพาะสาขาอุดรธานีและศรีราชาตามขั้นบันได</div>
      <div class="grid two">
        <div class="field"><label>เกณฑ์รวมทุกสาขา (รูปแบบ min:amount คั่นด้วยบรรทัด)</label><textarea id="monthlyAllTiers">${(s.monthlyBonus?.allTiers||[]).map(t=>`${t.min}:${t.amount}`).join("\n")}</textarea></div>
        <div class="field"><label>เกณฑ์เฉพาะสาขาที่กำหนด (min:amount)</label><textarea id="monthlySelectedTiers">${(s.monthlyBonus?.selectedTiers||[]).map(t=>`${t.min}:${t.amount}`).join("\n")}</textarea></div>
      </div>
      <div class="field"><label>สาขาที่ใช้เกณฑ์เฉพาะ</label><div class="check-list">${activeBranches().map(b=>`<label class="check-item"><input class="monthly-branch" type="checkbox" value="${b.id}" ${(s.monthlyBonus?.selectedBranchIds||[]).includes(b.id)?"checked":""}> ${escapeHtml(b.name)}</label>`).join("")}</div></div>
      <button id="saveMonthlyBonus" class="btn write-action" style="margin-top:10px">บันทึกโบนัสรายเดือน</button>
    </div>

    <div class="panel">
      <h3>สิทธิ์เห็นหน้าเบิกเงิน</h3>
      <div class="state ok">เจ้าของและผู้จัดการเห็นหน้าเบิกเงินแน่นอน ส่วนหัวหน้างาน/พนักงาน/รายวัน ให้เจ้าของเลือกอนุญาตเป็นรายคน</div>
      <div class="check-list">${advanceAccessRows()}</div>
      <button id="saveAdvanceAccess" class="btn write-action" style="margin-top:10px" ${isOwner()?"":"disabled"}>บันทึกสิทธิ์หน้าเบิกเงิน</button>
    </div>`;
  $("#setLogoFile")?.addEventListener("change", readLogoFile);
  $("#saveVisualSettings").onclick = saveVisualSettings;
  $("#addBranch").onclick = ()=>{ appState.branches.push({id:uid("branch"), name:"สาขาใหม่", active:true, order:appState.branches.length+1}); $("#branchesSettings").innerHTML = branchSettingRows(); };
  $("#saveBranches").onclick = saveBranchesSettings;
  $("#saveBonus").onclick = saveDailyBonusSettings;
  $("#saveMonthlyBonus").onclick = saveMonthlyBonusSettings;
  $("#saveAdvanceAccess").onclick = saveAdvanceAccessSettings;
  updateOnlineUi();
}
function advanceAccessRows(){
  const allowed = appState.settings.advanceAccessUserIds || [];
  return appState.users.filter(u=>u.active!==false && !["owner","manager"].includes(u.role)).map(u=>`<label class="check-item"><input class="advance-access-user" type="checkbox" value="${u.id}" ${allowed.includes(u.id)?"checked":""} ${isOwner()?"":"disabled"}> ${escapeHtml(u.name)} ${roleBadge(u.role)}</label>`).join("") || `<div class="empty compact">ยังไม่มีผู้ใช้ที่ต้องเลือกสิทธิ์</div>`;
}
async function saveAdvanceAccessSettings(){
  if(!requireOnline()) return;
  if(!isOwner()) return showToast("เฉพาะเจ้าของเท่านั้น");
  const advanceAccessUserIds = $$(".advance-access-user:checked").map(x=>x.value);
  await updateSettings({...appState.settings, advanceAccessUserIds}, "ตั้งค่าสิทธิ์หน้าเบิกเงิน");
  buildNav();
  showToast("บันทึกสิทธิ์หน้าเบิกเงินแล้ว");
}
function branchSettingRows(){
  return appState.branches.sort((a,b)=>(a.order||0)-(b.order||0)).map((b,i)=>`<div class="grid three branch-setting" data-id="${b.id}">
    <div class="field"><label>ชื่อสาขา</label><input class="branch-name" value="${escapeHtml(b.name)}"></div>
    <div class="field"><label>ลำดับ</label><input class="branch-order" inputmode="numeric" value="${b.order || i+1}"></div>
    <label class="check-item"><input class="branch-active" type="checkbox" ${b.active!==false?"checked":""}> เปิดใช้งาน</label>
  </div>`).join("");
}
function dessertSettingRows(){
  return (appState.settings.dessertItems || []).map(x=>`<div class="grid three dessert-setting" data-id="${escapeHtml(x.id || uid("dessert_item"))}">
    <div class="field"><label>ชื่อขนม</label><input class="ds-name" value="${escapeHtml(x.name)}"></div>
    <div class="field"><label>ราคาขาย/ชิ้น</label><input class="ds-price" inputmode="decimal" value="${numberValue(x.price)}"></div>
    <div class="field"><label>เปอร์เซ็นต์ OT</label><input class="ds-percent" inputmode="decimal" value="${numberValue(x.percent)}"></div>
    <div class="field"><label>&nbsp;</label><button class="btn ghost small remove-dessert-setting">ลบ</button></div>
  </div>`).join("");
}
function bindDessertSettingsControls(addBtnSelector="#addDessertSetting", rowsSelector="#dessertSettingsRows"){
  const addBtn = $(addBtnSelector);
  const rowsBox = $(rowsSelector);
  if(addBtn && rowsBox){
    addBtn.onclick = ()=>{
      const div=document.createElement("div");
      div.className="grid three dessert-setting";
      div.dataset.id = uid("dessert_item");
      div.innerHTML=`<div class="field"><label>ชื่อขนม</label><input class="ds-name"></div><div class="field"><label>ราคาขาย/ชิ้น</label><input class="ds-price" inputmode="decimal" value="0"></div><div class="field"><label>เปอร์เซ็นต์ OT</label><input class="ds-percent" inputmode="decimal" value="10"></div><div class="field"><label>&nbsp;</label><button class="btn ghost small remove-dessert-setting">ลบ</button></div>`;
      rowsBox.appendChild(div);
      $(".remove-dessert-setting",div).onclick=()=>div.remove();
      updateOnlineUi();
    };
  }
  $$(".remove-dessert-setting").forEach(btn=>btn.onclick=()=>btn.closest(".dessert-setting").remove());
}
async function readLogoFile(e){
  const file = e.target.files[0];
  if(!file) return;
  if(file.size > 600000) return showToast("ไฟล์โลโก้ใหญ่เกินไป แนะนำไม่เกิน 600KB");
  const reader = new FileReader();
  reader.onload = ()=> $("#setLogoUrl").value = reader.result;
  reader.readAsDataURL(file);
}
async function updateSettings(settings, action="ตั้งค่าระบบ"){
  const before = safeClone(appState.settings);
  appState.settings = mergeDeep(clone(DEFAULT_SETTINGS), settings);
  await setDoc(doc(appState.db, "appSettings", "main"), {...appState.settings, updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id}, {merge:true});
  await audit(action, {}, before, safeClone(appState.settings));
  applyTheme();
  await afterWrite("settings");
}
async function saveVisualSettings(){
  if(!requireOnline()) return;
  if(!isOwner()) return showToast("เฉพาะเจ้าของเท่านั้น");
  const s = {...appState.settings, storeName:$("#setStoreName").value.trim() || "Love Matcha", primaryColor:$("#setPrimary").value, secondaryColor:$("#setSecondary").value, fontScale:numberValue($("#setFontScale").value) || 1, logoUrl:$("#setLogoUrl").value.trim() || "./icons/logo.png"};
  await updateSettings(s, "ตั้งค่าหน้าตาเว็บ");
  showToast("บันทึกหน้าตาเว็บแล้ว");
}
async function saveBranchesSettings(){
  if(!requireOnline()) return;
  if(!isOwnerOrManager()) return showToast("ไม่มีสิทธิ์");
  const batch = writeBatch(appState.db);
  const before = safeClone(appState.branches);
  const updated = $$(".branch-setting").map(row=>({id:row.dataset.id, name:$(".branch-name",row).value.trim(), order:numberValue($(".branch-order",row).value), active:$(".branch-active",row).checked}));
  updated.forEach(b=>batch.set(doc(appState.db, "branches", b.id), {...b, updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id}, {merge:true}));
  await batch.commit();
  await audit("ตั้งค่าสาขา", {}, before, updated);
  await loadBaseData();
  await afterWrite("branches");
  showToast("บันทึกสาขาแล้ว");
  renderSettings();
}
async function saveDailyBonusSettings(){
  if(!requireOnline()) return;
  const dailyBonus = {};
  $$(".bonus-row").forEach(row=>{
    dailyBonus[row.dataset.branch] = {enabled:$(".bonus-enabled",row).checked, threshold:numberValue($(".bonus-threshold",row).value), amount:numberValue($(".bonus-amount",row).value)};
  });
  await updateSettings({...appState.settings, dailyBonus}, "ตั้งค่าโบนัสรายวัน");
  showToast("บันทึกโบนัสรายวันแล้ว");
}
function parseTiers(text){
  return String(text).split(/\n+/).map(line=>line.trim()).filter(Boolean).map(line=>{
    const [min, amount] = line.split(":").map(numberValue);
    return {min, amount};
  }).filter(x=>x.min && x.amount).sort((a,b)=>b.min-a.min);
}
async function saveMonthlyBonusSettings(){
  if(!requireOnline()) return;
  const monthlyBonus = {
    allTiers:parseTiers($("#monthlyAllTiers").value),
    selectedTiers:parseTiers($("#monthlySelectedTiers").value),
    selectedBranchIds:$$(".monthly-branch:checked").map(x=>x.value)
  };
  await updateSettings({...appState.settings, monthlyBonus}, "ตั้งค่าโบนัสรายเดือน");
  showToast("บันทึกโบนัสรายเดือนแล้ว");
}
async function saveDessertSettings(){
  if(!requireOnline()) return;
  const dessertItems = $$(".dessert-setting").map(row=>({id:row.dataset.id || uid("dessert_item"), name:$(".ds-name",row).value.trim(), price:numberValue($(".ds-price",row).value), percent:numberValue($(".ds-percent",row).value)})).filter(x=>x.name);
  await updateSettings({...appState.settings, dessertItems}, "ตั้งค่า OT ทำขนม");
  normalizeSettings();
  showToast("บันทึก OT ทำขนมแล้ว");
}

// Defensive: expose a tiny diagnostic for support
window.LoveMatchaApp = {
  version:VERSION,
  state:()=>({user:appState.currentUser?.name, role:appState.currentUser?.role, online:appState.online, branches:appState.branches.length, users:appState.users.length})
};
