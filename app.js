import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, enableIndexedDbPersistence, collection, doc, getDoc, getDocs,
  addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const VERSION = "v1.0";
const COLLECTIONS = [
  "users","branches","dailySales","dailyExpenses","cupCounts","dessertOT",
  "attendance","salaryAdvances","compensationSettings","compensationRecords",
  "appSettings","auditLogs","backupsMetadata"
];
const ROLE_LABELS = {
  owner:"เจ้าของ",
  manager:"ผู้จัดการ",
  supervisor:"หัวหน้างาน",
  staff:"พนักงาน"
};
const ROLE_ORDER = {owner:1, manager:2, supervisor:3, staff:4};
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
  logoUrl:"./icons/icon-192.png",
  autoBackup:{mode:"off", intervalMinutes:60, url:""},
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
    {name:"บราวนี่", price:0, percent:10},
    {name:"คุกกี้", price:0, percent:10},
    {name:"เค้ก", price:0, percent:10}
  ]
};

const clone = (obj) => (typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));

let appState = {
  firebase:null, auth:null, db:null, authUid:null,
  users:[], branches:[], settings:clone(DEFAULT_SETTINGS),
  currentUser:null, currentPage:"dashboard",
  online:navigator.onLine, charts:{}, backupTimer:null,
  dailyExisting:null, restorePreview:null
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
function applyTheme(){
  const s = appState.settings || DEFAULT_SETTINGS;
  document.documentElement.style.setProperty("--primary", s.primaryColor || DEFAULT_SETTINGS.primaryColor);
  document.documentElement.style.setProperty("--primary-dark", s.primaryColor || DEFAULT_SETTINGS.primaryColor);
  document.documentElement.style.setProperty("--secondary", s.secondaryColor || DEFAULT_SETTINGS.secondaryColor);
  document.documentElement.style.setProperty("--fontScale", String(s.fontScale || 1));
  $("#loginStoreName").textContent = s.storeName || "Love Matcha";
  $("#appTitle").textContent = s.storeName || "Love Matcha";
  $("#appLogo").src = s.logoUrl || "./icons/icon-192.png";
}
function updateOnlineUi(){
  const pill = $("#onlinePill");
  if(!pill) return;
  appState.online = navigator.onLine;
  pill.textContent = appState.online ? "ออนไลน์" : "ออฟไลน์";
  pill.className = `pill ${appState.online ? "ok" : "danger"}`;
  $("#offlineBanner").classList.toggle("hidden", appState.online);
  $$(".write-action").forEach(el => el.disabled = !appState.online);
}
window.addEventListener("online", updateOnlineUi);
window.addEventListener("offline", updateOnlineUi);

async function start(){
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
      <div class="state warn"><b>หมายเหตุ:</b> ระบบนี้ใช้ PIN ภายในร้าน ควรให้เฉพาะพนักงานที่ไว้ใจใช้งานเท่านั้น</div>
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
  navigate("dashboard");
}
$("#logoutBtn").onclick = ()=>{
  appState.currentUser = null;
  $("#mainApp").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
  renderLogin();
};

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
const HIDDEN_HISTORY_ACTIONS = new Set(["ซ่อนประวัติ", "แสดงประวัติกลับ"]);
async function afterWrite(actionName){
  if(!appState.settings?.autoBackup) return;
  const mode = appState.settings.autoBackup.mode || "off";
  if(mode === "onAction" || mode === "both"){
    try { await performBackup(`auto_${actionName}`, true); } catch(e){ console.warn("auto backup", e); }
  }
}

const NAV = [
  {id:"dashboard", label:"แดชบอร์ด", icon:"🏠", roles:["owner","manager","supervisor","staff"]},
  {id:"daily", label:"ยอดขาย", icon:"🧾", roles:["owner","manager","supervisor","staff"]},
  {id:"monthly", label:"รายเดือน", icon:"📅", roles:["owner","manager","supervisor","staff"]},
  {id:"personal", label:"แข่งขัน", icon:"📊", roles:["owner","manager","supervisor","staff"]},
  {id:"attendance", label:"เช็คชื่อ", icon:"✅", roles:["owner","manager","supervisor","staff"]},
  {id:"advances", label:"เบิกเงิน", icon:"💸", roles:["owner","manager"]},
  {id:"compensation", label:"ค่าตอบแทน", icon:"💰", roles:["owner","manager"]},
  {id:"history", label:"ประวัติ", icon:"🕘", roles:["owner","manager"]},
  {id:"backup", label:"สำรอง", icon:"☁️", roles:["owner"]},
  {id:"users", label:"ผู้ใช้", icon:"👥", roles:["owner","manager","supervisor"]},
  {id:"settings", label:"ตั้งค่า", icon:"⚙️", roles:["owner","manager"]}
];
function buildNav(){
  const nav = $("#bottomNav");
  const items = NAV.filter(n=>n.roles.includes(appState.currentUser.role));
  nav.innerHTML = items.map(n=>`<button class="nav-item" data-page="${n.id}"><span>${n.icon}</span><b>${n.label}</b></button>`).join("");
  $$(".nav-item", nav).forEach(btn=>btn.onclick=()=>navigate(btn.dataset.page));
}
function navigate(page){
  appState.currentPage = page;
  $$(".nav-item").forEach(b=>b.classList.toggle("active", b.dataset.page===page));
  const renderers = {
    dashboard:renderDashboard, daily:renderDaily, monthly:renderMonthly,
    personal:renderPersonal, attendance:renderAttendance, advances:renderAdvances,
    compensation:renderCompensation, history:renderHistory, backup:renderBackup, users:renderUsers, settings:renderSettings
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
function usersForBranch(branchId){
  return appState.users.filter(u => u.active !== false && ["manager","supervisor","staff"].includes(u.role) && (
    u.role === "manager" || (u.branchIds || []).includes(branchId) || (u.branchIds || []).includes("ALL")
  )).sort((a,b)=>(ROLE_ORDER[a.role]||9)-(ROLE_ORDER[b.role]||9) || String(a.name).localeCompare(String(b.name),"th"));
}
async function getSalesForMonth(monthKey, branchId="ALL"){
  const snap = await getDocs(query(collection(appState.db, "dailySales"), where("monthKey", "==", monthKey)));
  let rows = snap.docs.map(d=>({id:d.id, ...d.data()}));
  if(branchId !== "ALL") rows = rows.filter(r=>r.branchId === branchId);
  else rows = rows.filter(r=>isOwnerOrManager() || canSeeBranch(r.branchId));
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
    expense: open.reduce((s,r)=>s+numberValue(r.otherExpenseTotal),0),
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

async function renderDashboard(){
  setLoading();
  const monthKey = currentMonthKey();
  const rows = await getSalesForMonth(monthKey, "ALL");
  const visible = isOwnerOrManager() ? rows : rows.filter(r=>canSeeBranch(r.branchId));
  const ag = aggregateSales(visible);
  content().innerHTML = `
    ${pageTitle("Dashboard", `สรุปเดือน ${thaiMonth(monthKey)}`)}
    ${kpis([
      {label:"รายได้รวมทั้งหมด", value:`${money(ag.totalAll)} บาท`},
      {label:"จำนวนวันที่เปิดร้าน", value:`${ag.openDays} วัน`},
      {label:"เงินสดขาด/เกินรวม", value:`${money(ag.cashDiff)} บาท`},
      {label:"แก้วที่ใช้รวม", value:`${money(ag.cupsUsed)} ใบ`}
    ])}
    <div class="panel">
      <div class="flex"><h3>กราฟเปรียบเทียบสาขา</h3><span class="pill muted">${isOwnerOrManager()?"รวมทุกสาขา":"เฉพาะสาขาที่มีสิทธิ์"}</span></div>
      <div id="branchChartBox" class="canvas-box"><canvas id="branchChart"></canvas></div>
    </div>
    <div class="panel">
      <h3>รายการล่าสุด</h3>
      ${salesTable(visible.slice(-10).reverse())}
    </div>`;
  const labels = activeBranches().filter(b=>isOwnerOrManager() || canSeeBranch(b.id)).map(b=>b.name);
  const values = activeBranches().filter(b=>isOwnerOrManager() || canSeeBranch(b.id)).map(b=>aggregateSales(visible.filter(r=>r.branchId===b.id)).totalAll);
  drawBar("branchChart", labels, values, "รายได้รวมทั้งหมด");
}
function salesTable(rows){
  if(!rows.length) return `<div class="empty">ยังไม่มีข้อมูล</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>วันที่</th><th>สาขา</th><th>สถานะ</th><th class="money">รายได้รวมทั้งหมด</th><th class="money">ค่านม</th><th class="money">รายจ่ายอื่น</th><th class="money">เงินสดขาด/เกิน</th><th>หมายเหตุ</th></tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td>${thaiDate(r.date)}</td><td>${escapeHtml(branchName(r.branchId))}</td>
      <td>${r.closed?`<span class="pill warn">หยุด</span>`:`<span class="pill ok">เปิดร้าน</span>`}</td>
      <td class="money">${money(r.totalAll)}</td><td class="money">${money(r.milkCost)}</td><td class="money">${money(r.otherExpenseTotal)}</td><td class="money">${money(r.cashDiff)}</td><td>${escapeHtml(r.note||"")}</td>
    </tr>`).join("")}</tbody></table></div>`;
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
    ${pageTitle("บันทึกยอดขายรายวัน", "เลือกวันและสาขา แล้วบันทึกข้อมูลการขาย")}
    <form id="dailyForm">
      <div class="panel">
        <h3>วันที่ / สาขา</h3>
        <div class="grid three">
          <div class="field"><label>เดือน</label><input id="dailyMonth" type="month" value="${date.slice(0,7)}"></div>
          <div class="field"><label>วันที่</label><input id="dailyDate" type="date" value="${date}"><small id="dailyThaiDate">${thaiDate(date)}</small></div>
          <div class="field"><label>สาขา</label><select id="dailyBranch">${branchOptions({selected:b?.id})}</select></div>
        </div>
        <label class="check-item" style="margin-top:10px"><input id="dailyClosed" type="checkbox"> วันนี้หยุด / ไม่เปิดร้าน</label>
      </div>

      <div id="openShopFields">
        <div class="panel">
          <h3>พนักงานในกะ</h3>
          <small>เลือกคนที่ทำงานจริง 1-4 คน</small>
          <div id="workersBox" class="check-list" style="margin-top:8px"></div>
        </div>

        <div class="panel">
          <h3>ข้อมูลยอดขาย</h3>
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

        <div class="panel">
          <h3>ข้อมูลเงินสด</h3>
          <div class="grid three">
            <div class="field"><label>เงินสดเปิดกะ</label><input id="cashOpen" inputmode="decimal" class="calc-money" placeholder="0"></div>
            <div class="field"><label>เงินสดปิดกะ</label><input id="cashClose" inputmode="decimal" class="calc-money" placeholder="0"></div>
            <div class="field"><label>ค่านม</label><input id="milkCost" inputmode="decimal" class="calc-money" placeholder="0"></div>
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

        <div class="panel">
          <h3>ข้อมูลแก้ว</h3>
          <div class="grid three">
            <div class="field"><label>แก้วคงเหลือวันก่อน</label><input id="prevCupRemain" inputmode="numeric" class="calc-money" placeholder="0"><small>ระบบพยายามดึงให้อัตโนมัติ แต่แก้ได้</small></div>
            <div class="field"><label>แก้วเพิ่มวันนี้</label><input id="cupsAdded" inputmode="numeric" class="calc-money" placeholder="0"></div>
            <div class="field"><label>แก้วคงเหลือวันนี้</label><input id="cupsRemain" inputmode="numeric" class="calc-money" placeholder="0"></div>
            <div class="field"><label>แก้วที่ใช้จริง</label><input id="cupsUsed" disabled></div>
            <div class="field"><label>หมายเหตุแก้ว</label><input id="cupNote" placeholder="กรอกถ้าคำนวณติดลบ"></div>
          </div>
          <div id="cupWarn"></div>
        </div>

        <div class="panel">
          <h3>OT ทำขนม</h3>
          <label class="check-item"><input id="otEnabled" type="checkbox"> เปิดช่อง OT ทำขนมวันนี้</label>
          <div id="otFields" class="hidden">
            <div class="field" style="margin-top:10px"><label>คนที่ทำ OT</label><div id="otWorkersBox" class="check-list"></div></div>
            <div class="flex" style="margin-top:10px"><b>รายการขนม</b><button id="addDessertBtn" type="button" class="btn secondary small write-action">+ เพิ่มรายการขนม</button></div>
            <div id="dessertsBox" class="grid" style="margin-top:8px"></div>
            <div id="otSummary" class="state ok"></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3>หมายเหตุ</h3>
        <textarea id="dailyNote" placeholder="บันทึกเพิ่มเติมของวันนั้น"></textarea>
      </div>
      <div id="existingWarn"></div>
      <div class="sticky-save"><button id="saveDailyBtn" type="submit" class="btn full write-action">บันทึกยอดขาย</button></div>
    </form>`;
  bindDaily();
}
function bindDaily(){
  $("#dailyDate").onchange = ()=>{ $("#dailyThaiDate").textContent = thaiDate($("#dailyDate").value); $("#dailyMonth").value = $("#dailyDate").value.slice(0,7); loadExistingDaily(); };
  $("#dailyMonth").onchange = ()=>{ const m=$("#dailyMonth").value; if(m) $("#dailyDate").value = `${m}-01`; $("#dailyThaiDate").textContent = thaiDate($("#dailyDate").value); loadExistingDaily(); };
  $("#dailyBranch").onchange = ()=>{ loadExistingDaily(); };
  $("#dailyClosed").onchange = ()=>{ $("#openShopFields").classList.toggle("hidden", $("#dailyClosed").checked); recalcDaily(); };
  $("#addExpenseBtn").onclick = ()=>addExpenseRow();
  $("#addDessertBtn").onclick = ()=>addDessertRow();
  $("#otEnabled").onchange = ()=>{ $("#otFields").classList.toggle("hidden", !$("#otEnabled").checked); recalcDaily(); };
  $("#dailyForm").oninput = (e)=>{ if(e.target.matches(".calc-money") || e.target.type==="checkbox") recalcDaily(); };
  $("#dailyForm").onsubmit = saveDaily;
  refreshDailyWorkers();
  addExpenseRow();
  addDessertRow();
  loadPreviousCup();
  loadExistingDaily();
  updateOnlineUi();
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
function dessertConfigByName(name){
  return (appState.settings.dessertItems || []).find(x => String(x.name || "") === String(name || ""));
}
function resetDailyForm(){
  if(!$("#dailyForm")) return;
  appState.dailyExisting = null;
  $("#existingWarn").innerHTML = "";
  $("#dailyClosed").checked = false;
  $("#openShopFields").classList.remove("hidden");
  refreshDailyWorkers();
  ["grossSales","discount","cashSales","transferSales","paymentMismatchReason","lineMan","grab",
   "cashOpen","cashClose","milkCost","ownerCashOut","cashDiffReason",
   "prevCupRemain","cupsAdded","cupsRemain","cupNote","dailyNote"].forEach(id=>{ const el=$("#"+id); if(el) el.value=""; });
  $("#expensesBox").innerHTML = "";
  addExpenseRow();
  $("#dessertsBox").innerHTML = "";
  addDessertRow();
  $("#otEnabled").checked = false;
  $("#otFields").classList.add("hidden");
  $$(".otWorkerCheck").forEach(x=>x.checked=false);
  recalcDaily();
}
function addExpenseRow(row={}){
  const id = uid("exp");
  const div = document.createElement("div");
  div.className = "grid three expense-row";
  div.dataset.id = id;
  div.innerHTML = `
    <div class="field"><label>ชื่อรายการ</label><input class="exp-name" value="${escapeHtml(row.name||"")}" placeholder="เช่น ซื้อของ / ค่าขนส่ง"></div>
    <div class="field"><label>จำนวนเงิน</label><input class="exp-amount calc-money" inputmode="decimal" value="${row.amount ?? ""}" placeholder="0"></div>
    <div class="field"><label>หมายเหตุ</label><div class="flex"><input class="exp-note" value="${escapeHtml(row.note||"")}" placeholder="-"><button type="button" class="btn ghost small write-action remove-row">ลบ</button></div></div>`;
  $("#expensesBox").appendChild(div);
  $(".remove-row", div).onclick = ()=>{ div.remove(); recalcDaily(); };
  div.oninput = recalcDaily;
  updateOnlineUi();
}
function addDessertRow(row={}){
  const div = document.createElement("div");
  div.className = "grid three dessert-row";
  div.dataset.id = row.id || uid("dessert");
  div.dataset.price = numberValue(row.price);
  div.dataset.percent = numberValue(row.percent);
  const items = appState.settings.dessertItems || [];
  const currentName = row.name || "";
  const hasCurrent = items.some(x => x.name === currentName);
  const options = [`<option value="">เลือกชนิดขนม</option>`]
    .concat(items.map(x=>`<option value="${escapeHtml(x.name)}" ${x.name===currentName?"selected":""}>${escapeHtml(x.name)}</option>`))
    .concat(currentName && !hasCurrent ? [`<option value="${escapeHtml(currentName)}" selected>${escapeHtml(currentName)} (รายการเดิม)</option>`] : [])
    .join("");
  div.innerHTML = `
    <div class="field"><label>ทำขนมอะไร</label><select class="dessert-name calc-money">${options}</select></div>
    <div class="field"><label>กี่ชิ้น / กี่หน่วย</label><input class="dessert-qty calc-money" inputmode="decimal" value="${row.qty ?? ""}" placeholder="0"></div>
    <div class="field"><label>หมายเหตุ</label><div class="flex"><input class="dessert-note" value="${escapeHtml(row.note||"")}" placeholder="-"><button type="button" class="btn ghost small write-action remove-row">ลบ</button></div></div>`;
  $("#dessertsBox").appendChild(div);
  $(".remove-row", div).onclick = ()=>{ div.remove(); recalcDaily(); };
  div.oninput = recalcDaily;
  div.onchange = recalcDaily;
  updateOnlineUi();
}
function collectDailyForm(){
  const closed = $("#dailyClosed").checked;
  const workerIds = $$(".workerCheck:checked").map(x=>x.value).slice(0,4);
  const expenses = $$(".expense-row").map(r=>({
    id:r.dataset.id, name:$(".exp-name",r).value.trim(), amount:numberValue($(".exp-amount",r).value), note:$(".exp-note",r).value.trim()
  })).filter(x=>x.name || x.amount || x.note);
  const desserts = $$(".dessert-row").map(r=>{
    const name = $(".dessert-name",r).value.trim();
    const cfg = dessertConfigByName(name);
    return {
      id:r.dataset.id || uid("dessert"), name,
      price:numberValue(cfg ? cfg.price : r.dataset.price),
      qty:numberValue($(".dessert-qty",r).value),
      percent:numberValue(cfg ? cfg.percent : r.dataset.percent),
      note:$(".dessert-note",r).value.trim()
    };
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
  const cashOpen = numberValue($("#cashOpen").value);
  const cashClose = numberValue($("#cashClose").value);
  const milkCost = numberValue($("#milkCost").value);
  const ownerCashOut = numberValue($("#ownerCashOut").value);
  const cashShouldRemain = cashOpen + cashSales - milkCost - otherExpenseTotal - ownerCashOut;
  const cashDiff = cashClose - cashShouldRemain;
  const prevCupRemain = numberValue($("#prevCupRemain").value);
  const cupsAdded = numberValue($("#cupsAdded").value);
  const cupsRemain = numberValue($("#cupsRemain").value);
  const cupsUsed = prevCupRemain + cupsAdded - cupsRemain;
  const dessertPayTotal = $("#otEnabled").checked ? desserts.reduce((s,x)=>s+(x.price*x.qty*x.percent/100),0) : 0;
  const dessertPayPerPerson = otWorkerIds.length ? dessertPayTotal / otWorkerIds.length : 0;
  return {
    date:$("#dailyDate").value, monthKey:monthOf($("#dailyDate").value), branchId:$("#dailyBranch").value, closed,
    workerIds, workerNames:workerIds.map(userName), workerCount:workerIds.length,
    grossSales, discount, netSales, cashSales, transferSales,
    paymentMismatch: Math.round((cashSales+transferSales-netSales)*100)/100,
    paymentMismatchReason:$("#paymentMismatchReason").value.trim(),
    lineMan, grab, totalAll, avgPerPerson: workerIds.length ? totalAll/workerIds.length : 0,
    cashOpen, cashClose, milkCost, ownerCashOut, expenses, otherExpenseTotal, cashShouldRemain, cashDiff,
    cashDiffReason:$("#cashDiffReason").value.trim(),
    prevCupRemain, cupsAdded, cupsRemain, cupsUsed, cupNote:$("#cupNote").value.trim(),
    otEnabled:$("#otEnabled").checked, otWorkerIds, otWorkerNames:otWorkerIds.map(userName), desserts, dessertPayTotal, dessertPayPerPerson,
    note:$("#dailyNote").value.trim()
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
  $("#otSummary").innerHTML = `ค่าตอบแทน OT ทำขนมรวม ${money(d.dessertPayTotal)} บาท / เฉลี่ยคนละ ${money(d.dessertPayPerPerson)} บาท`;
}
async function loadPreviousCup(){
  const branchId = $("#dailyBranch").value;
  const date = $("#dailyDate").value;
  if(!branchId || !date) return;
  try{
    const snap = await getDocs(query(collection(appState.db, "dailySales"), where("branchId", "==", branchId)));
    const prev = snap.docs.map(d=>d.data()).filter(r=>r.date < date && !r.closed).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
    if(prev && !$("#prevCupRemain").value) $("#prevCupRemain").value = numberValue(prev.cupsRemain);
    recalcDaily();
  }catch(e){ console.warn(e); }
}
async function loadExistingDaily(){
  const branchId = $("#dailyBranch").value, date=$("#dailyDate").value;
  if(!branchId || !date) return;
  resetDailyForm();
  await loadPreviousCup();
  const id = `${branchId}_${date}`;
  const snap = await getDoc(doc(appState.db, "dailySales", id));
  appState.dailyExisting = snap.exists() ? {id:snap.id, ...snap.data()} : null;
  $("#existingWarn").innerHTML = appState.dailyExisting ? `<div class="state warn">วันนี้/สาขานี้มีข้อมูลแล้ว ถ้าบันทึกจะเป็นการแก้ไขข้อมูลเดิม ระบบจะถามยืนยันก่อน</div>` : "";
  if(snap.exists()) fillDailyForm(appState.dailyExisting);
  recalcDaily();
}
function fillDailyForm(r){
  $("#dailyClosed").checked = !!r.closed;
  $("#openShopFields").classList.toggle("hidden", !!r.closed);
  refreshDailyWorkers(r.workerIds || []);
  (r.workerIds||[]).forEach(id=>{ const el = $(`.workerCheck[value="${CSS.escape(id)}"]`); if(el) el.checked = true; });
  $("#grossSales").value = r.grossSales ?? "";
  $("#discount").value = r.discount ?? "";
  $("#cashSales").value = r.cashSales ?? "";
  $("#transferSales").value = r.transferSales ?? "";
  $("#paymentMismatchReason").value = r.paymentMismatchReason || "";
  $("#lineMan").value = r.lineMan ?? "";
  $("#grab").value = r.grab ?? "";
  $("#cashOpen").value = r.cashOpen ?? "";
  $("#cashClose").value = r.cashClose ?? "";
  $("#milkCost").value = r.milkCost ?? "";
  $("#ownerCashOut").value = r.ownerCashOut ?? "";
  $("#cashDiffReason").value = r.cashDiffReason || "";
  $("#prevCupRemain").value = r.prevCupRemain ?? "";
  $("#cupsAdded").value = r.cupsAdded ?? "";
  $("#cupsRemain").value = r.cupsRemain ?? "";
  $("#cupNote").value = r.cupNote || "";
  $("#dailyNote").value = r.note || "";
  $("#expensesBox").innerHTML = "";
  (r.expenses || []).forEach(addExpenseRow);
  if(!(r.expenses || []).length) addExpenseRow();
  $("#dessertsBox").innerHTML = "";
  (r.desserts || []).forEach(addDessertRow);
  if(!(r.desserts || []).length) addDessertRow();
  $("#otEnabled").checked = !!r.otEnabled;
  $("#otFields").classList.toggle("hidden", !r.otEnabled);
  (r.otWorkerIds||[]).forEach(id=>{ const el = $(`.otWorkerCheck[value="${CSS.escape(id)}"]`); if(el) el.checked = true; });
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
  if(d.otEnabled && d.desserts.length < 1) return "เปิด OT ทำขนมแล้ว กรุณาเลือกชนิดขนมและจำนวน";
  if(d.otEnabled && d.desserts.some(x=>!x.name || x.qty <= 0)) return "รายการ OT ทำขนมต้องเลือกชนิดขนมและกรอกจำนวนมากกว่า 0";
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
  const nowFields = before ? {updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id, updatedByName:appState.currentUser.name} : {createdAt:serverTimestamp(), createdBy:appState.currentUser.id, createdByName:appState.currentUser.name, updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id, updatedByName:appState.currentUser.name};
  const batch = writeBatch(appState.db);
  batch.set(ref, {...data, ...nowFields}, {merge:true});
  // mirror collections for easier backup/export
  batch.set(doc(appState.db, "cupCounts", id), {dailySalesId:id, branchId:data.branchId, date:data.date, monthKey:data.monthKey, prevCupRemain:data.prevCupRemain, cupsAdded:data.cupsAdded, cupsRemain:data.cupsRemain, cupsUsed:data.cupsUsed, updatedAt:serverTimestamp()}, {merge:true});
  for(const old of (before?.expenses || [])){ if(old.id) batch.delete(doc(appState.db, "dailyExpenses", `${id}_${old.id}`)); }
  for(const exp of data.expenses){ batch.set(doc(appState.db, "dailyExpenses", `${id}_${exp.id}`), {...exp, dailySalesId:id, branchId:data.branchId, date:data.date, monthKey:data.monthKey, updatedAt:serverTimestamp()}); }
  for(const old of (before?.desserts || [])){ if(old.id) batch.delete(doc(appState.db, "dessertOT", `${id}_${old.id}`)); }
  for(const dessert of data.desserts){ batch.set(doc(appState.db, "dessertOT", `${id}_${dessert.id}`), {...dessert, dailySalesId:id, branchId:data.branchId, date:data.date, monthKey:data.monthKey, otWorkerIds:data.otWorkerIds, dessertPayTotal:(dessert.price*dessert.qty*dessert.percent/100), updatedAt:serverTimestamp()}); }
  await batch.commit();
  await audit(before ? "แก้ไขยอดขาย" : "เพิ่มยอดขาย", {date:data.date, branch:branchName(data.branchId)}, before, data);
  await afterWrite("daily_sales");
  showToast("บันทึกยอดขายสำเร็จ");
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
      {label:"หยุด", value:`${ag.closedDays} วัน`}
    ])}
    <div class="panel">
      <div class="flex">
        <h3>ตารางรายวัน</h3>
        <button id="exportMonthlyCsv" class="btn secondary small">Export CSV</button>
        <button id="exportMonthlyJson" class="btn secondary small">Export JSON</button>
      </div>
      ${salesTable(rows)}
    </div>`;
  $("#exportMonthlyCsv").onclick = ()=>downloadText(`LoveMatcha_${monthKey}_${branchId}.csv`, dailyRowsToCsv(rows), "text/csv");
  $("#exportMonthlyJson").onclick = ()=>downloadText(`LoveMatcha_${monthKey}_${branchId}.json`, JSON.stringify(rows, null, 2), "application/json");
}
function dailyRowsToCsv(rows){
  const headers = ["date","thaiDate","branchId","branchName","closed","workerNames","grossSales","discount","netSales","cashSales","transferSales","lineMan","grab","totalAll","avgPerPerson","cashOpen","cashClose","milkCost","otherExpenseTotal","ownerCashOut","cashShouldRemain","cashDiff","cupsUsed","note"];
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
  const monthKey = currentMonthKey();
  content().innerHTML = `
    ${pageTitle("สรุปยอดขายรายบุคคล / กราฟแข่งขัน", "คิดจากยอดขายเฉลี่ยต่อคนของวันที่คนนั้นทำงาน")}
    <div class="panel">
      <div class="grid three">
        <div class="field"><label>เดือน</label><input id="personalMonth" type="month" value="${monthKey}"></div>
        <div class="field"><label>สาขา</label><select id="personalBranch">${branchOptions({includeAll:true, selected:isOwnerOrManager()?"ALL":visibleBranches()[0]?.id})}</select></div>
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
  const rows = await getSalesForMonth(monthKey, branchId);
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
async function renderAttendance(){
  const monthKey = currentMonthKey();
  const canViewAll = isOwnerOrManager();
  const staffUsers = appState.users.filter(u=>u.active!==false && ["supervisor","staff"].includes(u.role));
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
    $("#attDate").onchange = ()=>$("#attThaiDate").textContent = thaiDate($("#attDate").value);
    $("#attStatus").onchange = ()=>$("#attReasonBox").classList.toggle("hidden", !["ลาป่วย","ลากิจ","อื่น ๆ"].includes($("#attStatus").value));
    $("#attForm").onsubmit = saveAttendance;
  }
  await loadAttendanceResult();
}
function attendanceFormHtml(){
  return `<form id="attForm" class="panel">
    <h3>เช็คชื่อวันนี้</h3>
    <div class="grid three">
      <div class="field"><label>วันที่</label><input id="attDate" type="date"><small id="attThaiDate"></small></div>
      <div class="field"><label>สถานะ</label><select id="attStatus">
        <option>ทำงาน</option><option>หยุด</option><option>ลาพักผ่อน</option><option>ลาป่วย</option><option>ลากิจ</option><option>อื่น ๆ</option>
      </select></div>
      <div id="attReasonBox" class="field hidden"><label>เหตุผล</label><input id="attReason" placeholder="ระบุรายละเอียด"></div>
    </div>
    <div class="sticky-save"><button class="btn full write-action">บันทึกเช็คชื่อ</button></div>
  </form>`;
}
async function saveAttendance(e){
  e.preventDefault();
  if(!requireOnline()) return;
  const date = $("#attDate").value, status=$("#attStatus").value, reason=$("#attReason").value.trim();
  if(["ลาป่วย","ลากิจ","อื่น ๆ"].includes(status) && !reason) return showToast("กรุณากรอกเหตุผล");
  const id = `${appState.currentUser.id}_${date}`;
  const before = await getDoc(doc(appState.db, "attendance", id));
  const data = {userId:appState.currentUser.id, userName:appState.currentUser.name, date, monthKey:monthOf(date), status, reason, updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id};
  await setDoc(doc(appState.db, "attendance", id), data, {merge:true});
  await audit("เช็คชื่อ", {date, status}, before.exists()?before.data():null, data);
  showToast("บันทึกเช็คชื่อสำเร็จ");
  await afterWrite("attendance");
  await loadAttendanceResult();
}
async function loadAttendanceResult(){
  const monthKey=$("#attMonth").value, userId=$("#attUser").value;
  const snap = await getDocs(query(collection(appState.db, "attendance"), where("monthKey","==",monthKey)));
  const rows = snap.docs.map(d=>({id:d.id, ...d.data()})).filter(r=>r.userId===userId).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const count = status => rows.filter(r=>r.status===status).length;
  $("#attResult").innerHTML = `
    ${kpis([
      {label:"ทำงาน", value:`${count("ทำงาน")} วัน`},
      {label:"หยุด", value:`${count("หยุด")} วัน`},
      {label:"ลาพักผ่อน", value:`${count("ลาพักผ่อน")} วัน`},
      {label:"ลาป่วย/ลากิจ/อื่น ๆ", value:`${count("ลาป่วย")+count("ลากิจ")+count("อื่น ๆ")} วัน`}
    ])}
    <div class="panel"><h3>รายการเช็คชื่อ</h3>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>สถานะ</th><th>เหตุผล</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${thaiDate(r.date)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.reason||"")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มีข้อมูล</div>`}
    </div>`;
}
async function renderAdvances(){
  if(!isOwnerOrManager()) return content().innerHTML = `<div class="state error">ไม่มีสิทธิ์เข้าหน้านี้</div>`;
  const monthKey = currentMonthKey();
  const payUsers = appState.users.filter(u=>u.active!==false && ["manager","supervisor","staff"].includes(u.role));
  content().innerHTML = `
    ${pageTitle("เงินเบิกล่วงหน้า", "บันทึกเงินเดือนที่เบิกล่วงหน้าเพื่อนำไปคำนวณค่าตอบแทน")}
    <form id="advanceForm" class="panel">
      <h3>เพิ่มรายการเบิกล่วงหน้า</h3>
      <div class="grid three">
        <div class="field"><label>วันที่</label><input id="advanceDate" type="date" value="${todayISO()}"></div>
        <div class="field"><label>ชื่อพนักงาน</label><select id="advanceUser">${payUsers.map(u=>`<option value="${u.id}">${escapeHtml(u.name)} - ${ROLE_LABELS[u.role]}</option>`).join("")}</select></div>
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
  const userId=$("#advanceUser").value, date=$("#advanceDate").value;
  const data = {userId, userName:userName(userId), date, monthKey:monthOf(date), amount:numberValue($("#advanceAmount").value), detail:$("#advanceDetail").value.trim(), note:$("#advanceNote").value.trim(), createdAt:serverTimestamp(), createdBy:appState.currentUser.id, createdByName:appState.currentUser.name};
  if(!data.amount) return showToast("กรุณากรอกจำนวนเงิน");
  await addDoc(collection(appState.db, "salaryAdvances"), data);
  await audit("เพิ่มเงินเบิกล่วงหน้า", {user:data.userName, amount:data.amount}, null, data);
  await afterWrite("advance");
  showToast("บันทึกเงินเบิกล่วงหน้าสำเร็จ");
  $("#advanceAmount").value = ""; $("#advanceDetail").value = ""; $("#advanceNote").value = "";
  await loadAdvances();
}
async function loadAdvances(){
  const monthKey=$("#advanceMonth").value;
  const snap = await getDocs(query(collection(appState.db, "salaryAdvances"), where("monthKey","==",monthKey)));
  const rows = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const totals = {};
  rows.forEach(r=>totals[r.userId]=(totals[r.userId]||0)+numberValue(r.amount));
  $("#advanceResult").innerHTML = `
    <div class="panel"><h3>ยอดเบิกรวมรายเดือน</h3>
      ${Object.keys(totals).length ? `<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th class="money">ยอดเบิกรวม</th></tr></thead><tbody>${Object.entries(totals).map(([id,total])=>`<tr><td>${escapeHtml(userName(id))}</td><td class="money">${money(total)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มีข้อมูล</div>`}
    </div>
    <div class="panel"><h3>รายการทั้งหมด</h3>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ชื่อ</th><th class="money">จำนวน</th><th>รายละเอียด</th><th>หมายเหตุ</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${thaiDate(r.date)}</td><td>${escapeHtml(r.userName||userName(r.userId))}</td><td class="money">${money(r.amount)}</td><td>${escapeHtml(r.detail)}</td><td>${escapeHtml(r.note)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มีรายการ</div>`}
    </div>`;
}

async function renderCompensation(){
  if(!isOwnerOrManager()) return content().innerHTML = `<div class="state error">ไม่มีสิทธิ์เข้าหน้านี้</div>`;
  const monthKey = currentMonthKey();
  content().innerHTML = `
    ${pageTitle("ค่าตอบแทน", "คำนวณเงินเดือน โบนัส OT ทำขนม เบิกล่วงหน้า และประกันสังคม")}
    <div class="panel">
      <div class="grid three">
        <div class="field"><label>เดือน</label><input id="compMonth" type="month" value="${monthKey}"></div>
        <div class="field"><label>&nbsp;</label><button id="reloadComp" class="btn secondary">คำนวณใหม่</button></div>
      </div>
    </div>
    <div class="panel">
      <div class="flex"><h3>ตั้งค่าชนิดขนม / ราคา / % OT</h3><button id="addDessertSetting" class="btn secondary small write-action">+ เพิ่มชนิดขนม</button></div>
      <div class="state warn">พนักงานจะเห็นในหน้ายอดขายแค่ “ทำขนมอะไร” และ “กี่ชิ้น” ส่วนราคาและเปอร์เซ็นต์แก้ได้เฉพาะเจ้าของ/ผู้จัดการตรงนี้</div>
      <div id="dessertSettingsRows" class="grid">${dessertSettingRows()}</div>
      <button id="saveDessertSettings" class="btn write-action" style="margin-top:10px">บันทึกตั้งค่าขนม</button>
    </div>
    <div id="compResult"></div>`;
  $("#reloadComp").onclick = loadCompensation;
  $("#compMonth").onchange = loadCompensation;
  bindDessertSettingsControls();
  await loadCompensation();
}
async function loadCompensation(){
  const monthKey=$("#compMonth").value;
  $("#compResult").innerHTML = `<div class="loading">กำลังคำนวณค่าตอบแทน...</div>`;
  const payUsers = appState.users.filter(u=>u.active!==false && ["manager","supervisor","staff"].includes(u.role));
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
    const allTotal = totals[u.id] || 0;
    const selectedTotal = bySelectedBonusBranch[u.id] || 0;
    let b = 0;
    for(const t of appState.settings.monthlyBonus?.allTiers || []) if(allTotal > numberValue(t.min)) b = Math.max(b, numberValue(t.amount));
    if(!b){
      for(const t of appState.settings.monthlyBonus?.selectedTiers || []) if(selectedTotal > numberValue(t.min)) b = Math.max(b, numberValue(t.amount));
    }
    monthlyBonus[u.id] = b;
  });
  const dessertOT = {};
  rows.filter(r=>r.otEnabled).forEach(r=>{
    const workers = r.otWorkerIds || [];
    const per = workers.length ? numberValue(r.dessertPayTotal) / workers.length : 0;
    workers.forEach(id => dessertOT[id] = (dessertOT[id] || 0) + per);
  });
  const advSnap = await getDocs(query(collection(appState.db, "salaryAdvances"), where("monthKey","==",monthKey)));
  const advances = {};
  advSnap.docs.map(d=>d.data()).forEach(r=>advances[r.userId]=(advances[r.userId]||0)+numberValue(r.amount));
  const compSnap = await getDocs(query(collection(appState.db, "compensationRecords"), where("monthKey","==",monthKey)));
  const records = {};
  compSnap.docs.forEach(d=>records[d.data().userId]=({id:d.id, ...d.data()}));
  $("#compResult").innerHTML = `
    <div class="panel">
      <h3>ตารางค่าตอบแทน ${thaiMonth(monthKey)}</h3>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>ชื่อ</th><th>ระดับ</th><th class="money">เงินเดือน</th><th class="money">OT เพิ่มอื่น ๆ</th><th class="money">OT ทำขนม</th>
          <th class="money">เงินเพิ่มออกบูธ</th><th class="money">โบนัสรายวัน</th><th class="money">โบนัสรายเดือน</th>
          <th class="money">หักเงิน</th><th>รายละเอียดหัก</th><th class="money">เบิกล่วงหน้า</th><th class="money">ปกส.ลูกจ้าง</th>
          <th class="money">ยอดโอนปลายเดือน</th><th class="money">ต้นทุนรวม+ปกส.</th><th>บันทึก</th>
        </tr></thead>
        <tbody>${payUsers.map(u=>{
          const r = records[u.id] || {};
          const salary = numberValue(r.salary);
          const employeeSS = salary * 0.05, employerSS = salary * 0.05;
          const otOther = numberValue(r.otOther);
          const boothBonus = numberValue(r.boothBonus);
          const daily = numberValue(dailyBonus[u.id]);
          const monthly = ["supervisor","staff"].includes(u.role) ? numberValue(monthlyBonus[u.id]) : 0;
          const dessert = numberValue(dessertOT[u.id]);
          const deduction = numberValue(r.deduction);
          const advance = numberValue(advances[u.id]);
          const transfer = salary + otOther + dessert + boothBonus + daily + monthly - deduction - advance - employeeSS;
          const totalCost = salary + otOther + dessert + boothBonus + daily + monthly - deduction + employerSS;
          return `<tr class="comp-row" data-user="${u.id}">
            <td>${escapeHtml(u.name)}</td><td>${roleBadge(u.role)}</td>
            <td><input class="comp-salary" inputmode="decimal" value="${salary || ""}"></td>
            <td><input class="comp-ot" inputmode="decimal" value="${otOther || ""}"></td>
            <td class="money comp-dessert" data-value="${dessert}">${money(dessert)}</td>
            <td><input class="comp-booth" inputmode="decimal" value="${boothBonus || ""}"></td>
            <td class="money comp-daily" data-value="${daily}">${money(daily)}</td>
            <td class="money comp-monthly" data-value="${monthly}">${money(monthly)}</td>
            <td><input class="comp-deduction" inputmode="decimal" value="${deduction || ""}"></td>
            <td><input class="comp-deduction-note" value="${escapeHtml(r.deductionNote || "")}"></td>
            <td class="money comp-advance" data-value="${advance}">${money(advance)}</td>
            <td class="money comp-employee-ss">${money(employeeSS)}</td>
            <td class="money comp-transfer"><b>${money(transfer)}</b></td>
            <td class="money comp-cost"><b>${money(totalCost)}</b></td>
            <td class="row-actions"><button class="btn small write-action save-comp">บันทึก</button><button class="btn secondary small share-comp" type="button">แชร์สรุป</button></td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
    </div>`;
  $$(".comp-row").forEach(row=>{
    row.oninput = ()=>recalcCompRow(row);
    $(".save-comp", row).onclick = ()=>saveCompRow(row, monthKey);
    $(".share-comp", row).onclick = ()=>shareCompSummary(row, monthKey);
    recalcCompRow(row);
  });
  updateOnlineUi();
}
function recalcCompRow(row){
  const salary = numberValue($(".comp-salary", row).value);
  const ot = numberValue($(".comp-ot", row).value);
  const dessert = numberValue($(".comp-dessert", row).dataset.value);
  const booth = numberValue($(".comp-booth", row).value);
  const daily = numberValue($(".comp-daily", row).dataset.value);
  const monthly = numberValue($(".comp-monthly", row).dataset.value);
  const deduction = numberValue($(".comp-deduction", row).value);
  const advance = numberValue($(".comp-advance", row).dataset.value);
  const empSS = salary * .05, employerSS = salary * .05;
  const transfer = salary + ot + dessert + booth + daily + monthly - deduction - advance - empSS;
  const cost = salary + ot + dessert + booth + daily + monthly - deduction + employerSS;
  $(".comp-employee-ss", row).textContent = money(empSS);
  $(".comp-transfer", row).innerHTML = `<b>${money(transfer)}</b>`;
  $(".comp-cost", row).innerHTML = `<b>${money(cost)}</b>`;
}
function compRowSummaryText(row, monthKey){
  recalcCompRow(row);
  const userId = row.dataset.user;
  const name = userName(userId);
  const salary = numberValue($(".comp-salary", row).value);
  const ot = numberValue($(".comp-ot", row).value);
  const dessert = numberValue($(".comp-dessert", row).dataset.value);
  const booth = numberValue($(".comp-booth", row).value);
  const daily = numberValue($(".comp-daily", row).dataset.value);
  const monthly = numberValue($(".comp-monthly", row).dataset.value);
  const deduction = numberValue($(".comp-deduction", row).value);
  const deductionNote = $(".comp-deduction-note", row).value.trim();
  const advance = numberValue($(".comp-advance", row).dataset.value);
  const empSS = salary * .05;
  const transfer = numberValue($(".comp-transfer", row).textContent);
  return [
    `สรุปค่าตอบแทน ${thaiMonth(monthKey)}`,
    `ชื่อ: ${name}`,
    `เงินเดือน: ${money(salary)} บาท`,
    `OT เพิ่มอื่น ๆ: ${money(ot)} บาท`,
    `OT ทำขนม: ${money(dessert)} บาท`,
    `เงินเพิ่มออกบูธ: ${money(booth)} บาท`,
    `โบนัสรายวัน: ${money(daily)} บาท`,
    `โบนัสรายเดือน: ${money(monthly)} บาท`,
    `หักเงิน: ${money(deduction)} บาท${deductionNote ? ` (${deductionNote})` : ""}`,
    `เบิกล่วงหน้า: ${money(advance)} บาท`,
    `ประกันสังคมลูกจ้าง 5%: ${money(empSS)} บาท`,
    `ยอดที่ต้องโอนปลายเดือน: ${money(transfer)} บาท`
  ].join("\n");
}
async function shareCompSummary(row, monthKey){
  const text = compRowSummaryText(row, monthKey);
  const title = `สรุปค่าตอบแทน ${thaiMonth(monthKey)} - ${userName(row.dataset.user)}`;
  try{
    if(navigator.share){
      await navigator.share({title, text});
      return;
    }
    if(navigator.clipboard){
      await navigator.clipboard.writeText(text);
      showToast("คัดลอกสรุปแล้ว นำไปวางใน LINE ได้เลย");
      return;
    }
  }catch(e){ console.warn(e); }
  prompt("คัดลอกข้อความนี้ไปส่ง LINE", text);
}
async function saveCompRow(row, monthKey){
  if(!requireOnline()) return;
  const userId = row.dataset.user;
  const salary = numberValue($(".comp-salary", row).value);
  const data = {
    userId, userName:userName(userId), monthKey,
    salary, otOther:numberValue($(".comp-ot", row).value), dessertOT:numberValue($(".comp-dessert", row).dataset.value),
    boothBonus:numberValue($(".comp-booth", row).value), dailyBonus:numberValue($(".comp-daily", row).dataset.value),
    monthlyBonus:numberValue($(".comp-monthly", row).dataset.value), deduction:numberValue($(".comp-deduction", row).value),
    deductionNote:$(".comp-deduction-note", row).value.trim(), advances:numberValue($(".comp-advance", row).dataset.value),
    employeeSocialSecurity:salary*.05, employerSocialSecurity:salary*.05,
    netTransfer:numberValue($(".comp-transfer", row).textContent), totalCost:numberValue($(".comp-cost", row).textContent),
    updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id, updatedByName:appState.currentUser.name
  };
  const id = `${monthKey}_${userId}`;
  const ref = doc(appState.db, "compensationRecords", id);
  const before = await getDoc(ref);
  await setDoc(ref, data, {merge:true});
  await audit("แก้ค่าตอบแทน", {monthKey, user:userName(userId)}, before.exists()?before.data():null, data);
  await afterWrite("compensation");
  showToast(`บันทึกค่าตอบแทนของ ${userName(userId)} แล้ว`);
}
async function renderHistory(){
  if(!isOwnerOrManager()) return content().innerHTML = `<div class="state error">ไม่มีสิทธิ์เข้าหน้านี้</div>`;
  content().innerHTML = `${pageTitle("ประวัติ", "บันทึกการใช้งานและการแก้ไขทั้งหมด")}<div id="historyResult" class="panel"><div class="loading">กำลังโหลดประวัติ...</div></div>`;
  await loadHistory();
}
async function loadHistory(){
  const snap = await getDocs(query(collection(appState.db, "auditLogs"), orderBy("createdAtISO","desc"), limit(200)));
  let rows = snap.docs.map(d=>({id:d.id, ...d.data()}));
  rows = rows.filter(r=>!HIDDEN_HISTORY_ACTIONS.has(r.action));
  if(!isOwner()) rows = rows.filter(r=>!r.hidden);
  $("#historyResult").innerHTML = `
    <div class="flex"><h3>รายการล่าสุด</h3><button id="reloadHistory" class="btn secondary small">โหลดใหม่</button></div>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>รายการ</th><th>รายละเอียด</th><th>ซ่อน</th></tr></thead>
      <tbody>${rows.map(r=>`<tr class="${r.hidden?"hidden-log":""}">
        <td>${formatTs(r.createdAt || r.createdAtISO)}</td>
        <td>${escapeHtml(r.actorName || "-")}<br><small>${ROLE_LABELS[r.role] || ""}</small></td>
        <td><b>${escapeHtml(r.action)}</b></td>
        <td>${historyDetailHtml(r)}</td>
        <td>${isOwner()?`<button class="btn small ${r.hidden?"secondary":"ghost"} write-action toggle-log" data-id="${r.id}" data-hidden="${r.hidden?"1":"0"}">${r.hidden?"แสดงกลับ":"ซ่อน"}</button>`:"-"}</td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มีประวัติ</div>`}`;
  $("#reloadHistory").onclick = loadHistory;
  $$(".toggle-log").forEach(btn=>btn.onclick=async ()=>{
    if(!requireOnline()) return;
    await updateDoc(doc(appState.db, "auditLogs", btn.dataset.id), {hidden:btn.dataset.hidden!=="1", updatedAt:serverTimestamp()});
    await loadHistory();
  });
  updateOnlineUi();
}
const HISTORY_FIELD_LABELS = {
  date:"วันที่", branchId:"สาขา", closed:"สถานะร้าน", workerNames:"พนักงานในกะ",
  grossSales:"ยอดขายก่อนส่วนลด", discount:"ส่วนลด", netSales:"รายได้รวม", cashSales:"เงินสด", transferSales:"เงินโอน",
  lineMan:"Line Man", grab:"Grab", totalAll:"รายได้รวมทั้งหมด", avgPerPerson:"ยอดเฉลี่ยต่อคน",
  cashOpen:"เงินสดเปิดกะ", cashClose:"เงินสดปิดกะ", milkCost:"ค่านม", otherExpenseTotal:"รายจ่ายอื่น ๆ",
  ownerCashOut:"เอาเงินสดให้เจ้าของ", cashDiff:"เงินสดขาด/เกิน", cupsUsed:"แก้วที่ใช้จริง", note:"หมายเหตุ",
  salary:"เงินเดือน", otOther:"OT เพิ่มอื่น ๆ", dessertOT:"OT ทำขนม", boothBonus:"เงินเพิ่มออกบูธ",
  dailyBonus:"โบนัสรายวัน", monthlyBonus:"โบนัสรายเดือน", deduction:"หักเงิน", deductionNote:"รายละเอียดหัก",
  advances:"เบิกล่วงหน้า", netTransfer:"ยอดโอน", totalCost:"ต้นทุนรวม"
};
function displayValue(key, value){
  if(value === undefined || value === null || value === "") return "-";
  if(key === "date") return thaiDate(value);
  if(key === "branchId") return branchName(value);
  if(key === "closed") return value ? "หยุด" : "เปิดร้าน";
  if(Array.isArray(value)) return value.join(", ") || "-";
  if(typeof value === "number" || ["grossSales","discount","netSales","cashSales","transferSales","lineMan","grab","totalAll","avgPerPerson","cashOpen","cashClose","milkCost","otherExpenseTotal","ownerCashOut","cashDiff","cupsUsed","salary","otOther","dessertOT","boothBonus","dailyBonus","monthlyBonus","deduction","advances","netTransfer","totalCost"].includes(key)) return money(value);
  const text = String(value);
  return text.length > 80 ? text.slice(0,80) + "..." : text;
}
function historyDetailHtml(r){
  const d = r.details || {};
  const parts = [];
  if(d.date) parts.push(`วันที่ ${thaiDate(d.date)}`);
  if(d.monthKey) parts.push(`เดือน ${thaiMonth(d.monthKey)}`);
  if(d.branch) parts.push(`สาขา ${escapeHtml(d.branch)}`);
  if(d.user) parts.push(`ผู้เกี่ยวข้อง ${escapeHtml(d.user)}`);
  if(d.name) parts.push(`ชื่อ ${escapeHtml(d.name)}`);
  if(d.role) parts.push(`ระดับ ${escapeHtml(d.role)}`);
  if(d.amount) parts.push(`จำนวน ${money(d.amount)} บาท`);
  if(d.reason) parts.push(`เหตุผล ${escapeHtml(d.reason)}`);
  if(d.message) parts.push(escapeHtml(d.message));
  if(!parts.length && Object.keys(d).length){
    for(const [k,v] of Object.entries(d).slice(0,4)) parts.push(`${escapeHtml(k)}: ${escapeHtml(displayValue(k,v))}`);
  }
  const changes = [];
  const before = r.before || {}, after = r.after || {};
  for(const [key,label] of Object.entries(HISTORY_FIELD_LABELS)){
    const b = before[key], a = after[key];
    if(JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) changes.push(`<div><b>${label}</b>: ${escapeHtml(displayValue(key,b))} → ${escapeHtml(displayValue(key,a))}</div>`);
  }
  return `<div>${parts.join("<br>") || "-"}</div>${changes.length ? `<details><summary>ดูสิ่งที่เปลี่ยน</summary><div class="history-changes">${changes.slice(0,12).join("")}</div></details>` : ""}`;
}
async function renderBackup(){
  if(!isOwner()) return content().innerHTML = `<div class="state error">เฉพาะเจ้าของเท่านั้น</div>`;
  const auto = appState.settings.autoBackup || DEFAULT_SETTINGS.autoBackup;
  content().innerHTML = `
    ${pageTitle("สำรองข้อมูล", "Export / Backup ไป Google Drive / Restore JSON หรือ CSV")}
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
        <button id="testBackupUrl" class="btn secondary write-action">ทดสอบเชื่อมต่อ</button>
        <button id="manualBackup" class="btn write-action">Backup ไป Drive ตอนนี้</button>
        <button id="exportFullJson" class="btn secondary">Export JSON</button>
        <button id="exportSalesCsv" class="btn secondary">Export CSV ยอดขาย</button>
      </div>
      <div id="backupState"></div>
    </div>
    <div class="panel">
      <h3>Restore Backup</h3>
      <div class="state warn">ก่อน Restore ระบบจะสร้าง Backup ปัจจุบันให้อีกชุด และต้องกรอก PIN เจ้าของยืนยัน</div>
      <div class="field"><label>เลือกไฟล์ JSON หรือ CSV</label><input id="restoreFile" type="file" accept=".json,.csv,application/json,text/csv"></div>
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
  $("#exportSalesCsv").onclick = exportAllSalesCsv;
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
async function performBackup(reason="manual", quiet=false){
  if(!requireOnline()) return;
  const backup = await buildFullBackup();
  const url = appState.settings.autoBackup?.url || $("#backupUrl")?.value?.trim();
  if(!url) {
    if(!quiet) showToast("ยังไม่ได้กรอก Google Apps Script Web App URL");
    return;
  }
  await fetch(url, {method:"POST", mode:"no-cors", headers:{"Content-Type":"text/plain;charset=utf-8"}, body:JSON.stringify(backup)});
  await addDoc(collection(appState.db, "backupsMetadata"), {reason, exportedAt:serverTimestamp(), exportedAtISO:new Date().toISOString(), url, collections:Object.fromEntries(Object.entries(backup.collections).map(([k,v])=>[k,v.length])), createdBy:appState.currentUser?.id || null});
  if(reason !== "pre_restore") await audit("สำรองข้อมูล", {reason, collections:Object.fromEntries(Object.entries(backup.collections).map(([k,v])=>[k,v.length]))});
  if(!quiet) $("#backupState").innerHTML = `<div class="state ok">ส่ง Backup ไป Google Apps Script แล้ว กรุณาตรวจสอบไฟล์ใน Google Drive</div>`;
}
async function testBackupUrl(){
  if(!requireOnline()) return;
  const url = $("#backupUrl").value.trim();
  if(!url) return showToast("กรุณากรอก URL ก่อน");
  try{
    await fetch(url, {mode:"no-cors"});
    $("#backupState").innerHTML = `<div class="state ok">ส่งคำขอทดสอบแล้ว ถ้า Apps Script ตั้งค่าถูกต้องจะเปิดใช้งานได้</div>`;
  }catch(e){
    $("#backupState").innerHTML = `<div class="state error">ทดสอบไม่สำเร็จ: ${escapeHtml(e.message)}</div>`;
  }
}
async function exportAllSalesCsv(){
  const snap = await getDocs(collection(appState.db, "dailySales"));
  const rows = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  downloadText(`LoveMatcha_AllDailySales.csv`, dailyRowsToCsv(rows), "text/csv");
}
async function handleRestoreFile(){
  const file = $("#restoreFile").files[0];
  if(!file) return;
  const text = await file.text();
  let preview;
  if(file.name.toLowerCase().endsWith(".json")){
    const obj = JSON.parse(text);
    if(!obj.collections) throw new Error("ไฟล์ JSON ไม่ใช่รูปแบบ Backup ของระบบ");
    preview = {type:"json", data:obj, counts:Object.fromEntries(Object.entries(obj.collections).map(([k,v])=>[k, Array.isArray(v)?v.length:0]))};
  }else{
    const rows = parseCsv(text);
    preview = {type:"csv", rows, counts:{dailySales:Math.max(0, rows.length-1)}};
  }
  appState.restorePreview = preview;
  $("#restorePreview").innerHTML = `<div class="state ok"><b>Preview:</b><pre class="preview">${escapeHtml(JSON.stringify(preview.counts, null, 2))}</pre></div>`;
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
        cashOpen:numberValue(r[idx.cashOpen]), cashClose:numberValue(r[idx.cashClose]), milkCost:numberValue(r[idx.milkCost]), otherExpenseTotal:numberValue(r[idx.otherExpenseTotal]),
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
  const canCreateRoles = appState.currentUser.role === "owner" ? ["owner","manager","supervisor","staff"] : appState.currentUser.role === "manager" ? ["manager","supervisor","staff"] : ["staff"];
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
  const rolesAllowedForManager = ["manager","supervisor","staff"];
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
  if(appState.currentUser.role === "supervisor") return u.role === "staff" && (u.branchIds||[]).some(id=>(appState.currentUser.branchIds||[]).includes(id));
  return false;
}
function canEditBranch(u){
  if(isOwner()) return u.id !== appState.currentUser.id;
  if(isManager()) return ["supervisor","staff"].includes(u.role);
  return false;
}
function canDeleteUser(u){
  if(u.id === appState.currentUser.id) return false;
  if(isOwner()) return u.role !== "owner";
  if(isManager()) return ["supervisor","staff"].includes(u.role);
  return false;
}
async function changeOwnPin(){
  if(!requireOnline()) return;
  const oldPin = $("#oldPin").value.trim(), newPin=$("#newPin").value.trim();
  if(String(appState.currentUser.pin) !== oldPin) return showToast("PIN เดิมไม่ถูกต้อง");
  if(!/^\d{4}$/.test(newPin)) return showToast("PIN ใหม่ต้องเป็นตัวเลข 4 ตัว");
  const before = safeClone(appState.currentUser);
  await updateDoc(doc(appState.db, "users", appState.currentUser.id), {pin:newPin, updatedAt:serverTimestamp(), updatedBy:appState.currentUser.id});
  appState.currentUser.pin = newPin;
  await audit("เปลี่ยน PIN", {user:appState.currentUser.name}, {...before, pin:"****"}, {...appState.currentUser, pin:"****"});
  showToast("เปลี่ยน PIN สำเร็จ");
  await loadBaseData();
}
async function createUser(e){
  e.preventDefault();
  if(!requireOnline()) return;
  const name=$("#newUserName").value.trim(), role=$("#newUserRole").value, pin=$("#newUserPin").value.trim();
  if(!name || !/^\d{4}$/.test(pin)) return showToast("กรุณากรอกชื่อและ PIN 4 ตัว");
  if(appState.currentUser.role==="supervisor" && role !== "staff") return showToast("หัวหน้างานสร้างได้เฉพาะพนักงาน");
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
    ${pageTitle("ตั้งค่า", "ปรับสี ชื่อร้าน สาขา โบนัส และ OT ทำขนม")}
    <div class="panel">
      <h3>หน้าตาเว็บ</h3>
      ${!isOwner()?`<div class="state warn">ผู้จัดการปรับได้เฉพาะเกณฑ์โบนัส/OT และสาขาตามสิทธิ์ ส่วนสี/โลโก้ให้เจ้าของปรับ</div>`:""}
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
      <div class="flex"><h3>เปอร์เซ็นต์ OT ทำขนม</h3><button id="addDessertSetting" class="btn secondary small write-action">+ เพิ่มชนิดขนม</button></div>
      <div id="dessertSettingsRows" class="grid">${dessertSettingRows()}</div>
      <button id="saveDessertSettings" class="btn write-action" style="margin-top:10px">บันทึก OT ทำขนม</button>
    </div>`;
  $("#setLogoFile")?.addEventListener("change", readLogoFile);
  $("#saveVisualSettings").onclick = saveVisualSettings;
  $("#addBranch").onclick = ()=>{ appState.branches.push({id:uid("branch"), name:"สาขาใหม่", active:true, order:appState.branches.length+1}); $("#branchesSettings").innerHTML = branchSettingRows(); };
  $("#saveBranches").onclick = saveBranchesSettings;
  $("#saveBonus").onclick = saveDailyBonusSettings;
  $("#saveMonthlyBonus").onclick = saveMonthlyBonusSettings;
  bindDessertSettingsControls();
  updateOnlineUi();
}
function branchSettingRows(){
  return appState.branches.sort((a,b)=>(a.order||0)-(b.order||0)).map((b,i)=>`<div class="grid three branch-setting" data-id="${b.id}">
    <div class="field"><label>ชื่อสาขา</label><input class="branch-name" value="${escapeHtml(b.name)}"></div>
    <div class="field"><label>ลำดับ</label><input class="branch-order" inputmode="numeric" value="${b.order || i+1}"></div>
    <label class="check-item"><input class="branch-active" type="checkbox" ${b.active!==false?"checked":""}> เปิดใช้งาน</label>
  </div>`).join("");
}
function dessertSettingRows(){
  return (appState.settings.dessertItems || []).map(x=>`<div class="grid four dessert-setting">
    <div class="field"><label>ชื่อขนม</label><input class="ds-name" value="${escapeHtml(x.name)}"></div>
    <div class="field"><label>ราคาขาย/ชิ้น</label><input class="ds-price" inputmode="decimal" value="${numberValue(x.price)}"></div>
    <div class="field"><label>เปอร์เซ็นต์ OT</label><input class="ds-percent" inputmode="decimal" value="${numberValue(x.percent)}"></div>
    <div class="field"><label>&nbsp;</label><button class="btn ghost small remove-dessert-setting" type="button">ลบ</button></div>
  </div>`).join("");
}
function bindDessertSettingsControls(){
  const addBtn = $("#addDessertSetting");
  const saveBtn = $("#saveDessertSettings");
  if(addBtn) addBtn.onclick = ()=>{
    const div=document.createElement("div");
    div.className="grid four dessert-setting";
    div.innerHTML=`<div class="field"><label>ชื่อขนม</label><input class="ds-name"></div><div class="field"><label>ราคาขาย/ชิ้น</label><input class="ds-price" inputmode="decimal" value="0"></div><div class="field"><label>เปอร์เซ็นต์ OT</label><input class="ds-percent" inputmode="decimal" value="10"></div><div class="field"><label>&nbsp;</label><button class="btn ghost small remove-dessert-setting" type="button">ลบ</button></div>`;
    $("#dessertSettingsRows").appendChild(div);
    $(".remove-dessert-setting",div).onclick=()=>div.remove();
    updateOnlineUi();
  };
  if(saveBtn) saveBtn.onclick = saveDessertSettings;
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
  const s = {...appState.settings, storeName:$("#setStoreName").value.trim() || "Love Matcha", primaryColor:$("#setPrimary").value, secondaryColor:$("#setSecondary").value, fontScale:numberValue($("#setFontScale").value) || 1, logoUrl:$("#setLogoUrl").value.trim() || "./icons/icon-192.png"};
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
  const dessertItems = $$(".dessert-setting").map(row=>({name:$(".ds-name",row).value.trim(), price:numberValue($(".ds-price",row).value), percent:numberValue($(".ds-percent",row).value)})).filter(x=>x.name);
  await updateSettings({...appState.settings, dessertItems}, "ตั้งค่า OT ทำขนม");
  showToast("บันทึก OT ทำขนมแล้ว");
  if(appState.currentPage === "compensation") await loadCompensation();
}

// Defensive: expose a tiny diagnostic for support
window.LoveMatchaApp = {
  version:VERSION,
  state:()=>({user:appState.currentUser?.name, role:appState.currentUser?.role, online:appState.online, branches:appState.branches.length, users:appState.users.length})
};
