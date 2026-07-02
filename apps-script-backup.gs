/*
  Love Matcha Sales Backup Web App v1.4.1 — JSON only

  ใช้แทน Code.gs ใน Google Apps Script ทั้งไฟล์
  หน้าที่:
  - GET ?action=test  = บังคับสร้างไฟล์ TEST แบบ JSON ใน Google Drive
  - POST payload      = รับ Backup จากแอป แล้วสร้างไฟล์ JSON ใน Google Drive
  - ไม่สร้าง Google Sheet / Excel แล้ว เพื่อลดความช้าและลดความสับสน

  สำคัญ:
  1) หลังวางโค้ด ต้อง Deploy > Manage deployments > Edit > Version: New version > Deploy
  2) Execute as: Me
  3) Who has access: Anyone
*/

const BACKUP_APP_VERSION = 'Love Matcha Sales Backup v1.4.1';
const BACKUP_FOLDER_NAME = 'LoveMatcha_Backups';

// ถ้ามีโฟลเดอร์ LoveMatcha_Backups ซ้ำหลายอัน ให้ใส่ Folder ID ของโฟลเดอร์ที่ต้องการไว้ตรงนี้
// วิธีหา Folder ID: เปิดโฟลเดอร์ใน Drive แล้วดู URL เช่น /folders/1AbCxxx => เอา 1AbCxxx มาใส่
const BACKUP_FOLDER_ID = '';

function doGet(e) {
  try {
    const action = getParam_(e, 'action');
    if (action === 'test' || action === 'force-test' || action === 'create-test') {
      const testObj = makeTestPayload_('GET_TEST');
      const result = saveBackup_(testObj, 'TEST');
      result.message = 'สร้างไฟล์ TEST JSON ใน Google Drive แล้ว ถ้าไม่เห็นในโฟลเดอร์ที่เปิดอยู่ ให้กด folderUrl ในผลลัพธ์นี้';
      result.method = 'GET';
      return json_(result);
    }

    const folder = getBackupFolder_();
    return json_({
      ok: true,
      app: BACKUP_APP_VERSION,
      message: 'Web App พร้อมใช้งาน ถ้าต้องการทดสอบสร้างไฟล์ JSON ให้เติม ?action=test ต่อท้าย URL',
      folderName: folder.getName(),
      folderId: folder.getId(),
      folderUrl: folder.getUrl(),
      time: new Date().toISOString()
    });
  } catch (err) {
    return json_(errorObject_(err, 'doGet'));
  }
}

function doPost(e) {
  try {
    const action = getParam_(e, 'action');
    let obj;

    if (action === 'test' || action === 'force-test' || action === 'create-test') {
      obj = makeTestPayload_('POST_TEST');
      const result = saveBackup_(obj, 'TEST');
      result.message = 'สร้างไฟล์ TEST JSON จาก POST ใน Google Drive แล้ว';
      result.method = 'POST_TEST';
      return json_(result);
    }

    const raw = readPayload_(e);
    obj = JSON.parse(raw);
    const result = saveBackup_(obj, '');
    result.method = 'POST_BACKUP';
    return json_(result);
  } catch (err) {
    return json_(errorObject_(err, 'doPost'));
  }
}

function readPayload_(e) {
  if (e && e.parameter && e.parameter.payload) return String(e.parameter.payload);
  if (e && e.postData && e.postData.contents) return String(e.postData.contents);
  throw new Error('ไม่พบ payload ที่ส่งมา');
}

function getParam_(e, name) {
  return e && e.parameter && e.parameter[name] ? String(e.parameter[name]) : '';
}

function makeTestPayload_(source) {
  return {
    app: 'Love Matcha Sales',
    version: 'TEST_BY_APPS_SCRIPT_' + source,
    exportedAt: new Date().toISOString(),
    note: 'ไฟล์นี้สร้างจากปุ่มทดสอบ Google Apps Script Web App URL แบบ JSON only',
    collections: {
      test: [
        {id: 'test_' + Date.now(), data: {ok: true, source: source, createdAtISO: new Date().toISOString()}}
      ]
    }
  };
}

function saveBackup_(obj, prefix) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folder = getBackupFolder_();
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd_HH-mm-ss');
    const tag = prefix ? prefix + '_' : '';

    const jsonName = 'LoveMatcha_' + tag + 'Backup_' + stamp + '.json';
    const pretty = JSON.stringify(obj || {}, null, 2);
    const jsonFile = folder.createFile(jsonName, pretty, 'application/json');

    return {
      ok: true,
      app: BACKUP_APP_VERSION,
      folderName: folder.getName(),
      folderId: folder.getId(),
      folderUrl: folder.getUrl(),
      jsonFileName: jsonName,
      jsonFileId: jsonFile.getId(),
      jsonUrl: jsonFile.getUrl(),
      collections: countCollections_(obj || {}),
      time: new Date().toISOString()
    };
  } finally {
    lock.releaseLock();
  }
}

function getBackupFolder_() {
  if (BACKUP_FOLDER_ID && BACKUP_FOLDER_ID.trim()) {
    return DriveApp.getFolderById(BACKUP_FOLDER_ID.trim());
  }
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

function countCollections_(obj) {
  const out = {};
  const collections = obj.collections || {};
  Object.keys(collections).forEach(k => out[k] = Array.isArray(collections[k]) ? collections[k].length : 0);
  return out;
}

function errorObject_(err, at) {
  return {
    ok: false,
    app: BACKUP_APP_VERSION,
    at: at,
    error: String(err && err.message ? err.message : err),
    stack: String(err && err.stack ? err.stack : ''),
    time: new Date().toISOString()
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj, null, 2)).setMimeType(ContentService.MimeType.JSON);
}
