/*
  Love Matcha Sales Backup Web App v1.3.2

  โค้ดนี้ใช้แทน Code.gs ใน Google Apps Script ทั้งไฟล์
  หน้าที่:
  - GET ?action=test  = บังคับสร้างไฟล์ TEST ทั้ง JSON และ Google Sheet ใน Drive
  - POST payload      = รับ Backup จากแอป แล้วสร้างไฟล์ JSON และ Google Sheet ใน Drive
  - ตอบกลับพร้อม folderUrl / jsonUrl / sheetUrl เพื่อเช็กได้ชัดเจนว่าไฟล์ถูกสร้างที่ไหน

  สำคัญ:
  1) หลังวางโค้ด ต้อง Deploy > Manage deployments > Edit > Version: New version > Deploy
  2) Execute as: Me
  3) Who has access: Anyone
*/

const BACKUP_APP_VERSION = 'Love Matcha Sales Backup v1.3.2';
const BACKUP_FOLDER_NAME = 'LoveMatcha_Backups';

// ถ้ามีโฟลเดอร์ LoveMatcha_Backups ซ้ำหลายอัน ให้ใส่ Folder ID ของโฟลเดอร์ที่ต้องการไว้ตรงนี้
// วิธีหา Folder ID: เปิดโฟลเดอร์ใน Drive แล้วดู URL เช่น /folders/1AbCxxx => เอา 1AbCxxx มาใส่
const BACKUP_FOLDER_ID = '';

const MAX_CELL_CHARS = 45000;

function doGet(e) {
  try {
    const action = getParam_(e, 'action');
    if (action === 'test' || action === 'force-test' || action === 'create-test') {
      const testObj = makeTestPayload_('GET_TEST');
      const result = saveBackup_(testObj, 'TEST');
      result.message = 'สร้างไฟล์ TEST ใน Google Drive แล้ว ถ้าไม่เห็นในโฟลเดอร์ที่เปิดอยู่ ให้กด folderUrl ในผลลัพธ์นี้';
      result.method = 'GET';
      return json_(result);
    }

    const folder = getBackupFolder_();
    return json_({
      ok: true,
      app: BACKUP_APP_VERSION,
      message: 'Web App พร้อมใช้งาน ถ้าต้องการทดสอบสร้างไฟล์ให้เติม ?action=test ต่อท้าย URL',
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
      result.message = 'สร้างไฟล์ TEST จาก POST ใน Google Drive แล้ว';
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
    note: 'ไฟล์นี้สร้างจากปุ่มทดสอบ Google Apps Script Web App URL',
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

    const ssName = 'LoveMatcha_' + tag + 'Backup_' + stamp;
    const ss = SpreadsheetApp.create(ssName);
    const ssFile = DriveApp.getFileById(ss.getId());
    moveFileToFolder_(ssFile, folder);
    writeBackupToSpreadsheet_(ss, obj || {});

    return {
      ok: true,
      app: BACKUP_APP_VERSION,
      folderName: folder.getName(),
      folderId: folder.getId(),
      folderUrl: folder.getUrl(),
      jsonFileName: jsonName,
      jsonFileId: jsonFile.getId(),
      jsonUrl: jsonFile.getUrl(),
      sheetName: ssName,
      sheetId: ss.getId(),
      sheetUrl: ss.getUrl(),
      collections: countCollections_(obj || {}),
      time: new Date().toISOString()
    };
  } finally {
    lock.releaseLock();
  }
}

function moveFileToFolder_(file, folder) {
  try {
    file.moveTo(folder);
  } catch (err) {
    folder.addFile(file);
    try { DriveApp.getRootFolder().removeFile(file); } catch (ignore) {}
  }
}

function writeBackupToSpreadsheet_(ss, obj) {
  const first = ss.getSheets()[0];
  first.setName('_README');
  first.clear();
  first.getRange(1, 1, 11, 2).setValues([
    ['app', obj.app || 'Love Matcha Sales'],
    ['backupWebAppVersion', BACKUP_APP_VERSION],
    ['version', obj.version || ''],
    ['exportedAt', obj.exportedAt || new Date().toISOString()],
    ['folderName', BACKUP_FOLDER_NAME],
    ['folderId', getBackupFolder_().getId()],
    ['restoreHow', 'ดาวน์โหลดไฟล์นี้เป็น Microsoft Excel (.xlsx) แล้วเลือกไฟล์ในหน้า Restore ของแอป'],
    ['format', 'แต่ละ sheet ใช้คอลัมน์ id และ json เพื่อเก็บเอกสาร Firestore'],
    ['warning', 'อย่าแก้ไขคอลัมน์ id/json ถ้าต้องการ Restore กลับเข้าระบบ'],
    ['createdBy', 'Google Apps Script Web App'],
    ['createdAt', new Date().toISOString()]
  ]);
  first.autoResizeColumns(1, 2);

  const collections = obj.collections || {};
  Object.keys(collections).forEach(name => {
    const sheet = ss.insertSheet(safeSheetName_(name));
    sheet.getRange(1, 1, 1, 3).setValues([['id', 'json', 'updatedAtISO']]);
    const docs = Array.isArray(collections[name]) ? collections[name] : [];
    if (docs.length) {
      const values = docs.map(item => {
        const data = item && item.data ? item.data : {};
        let json = JSON.stringify(data);
        if (json.length > MAX_CELL_CHARS) json = json.substring(0, MAX_CELL_CHARS) + '...TRUNCATED_TOO_LARGE_FOR_SHEET';
        return [String(item.id || ''), json, String(data.updatedAtISO || data.createdAtISO || '')];
      });
      sheet.getRange(2, 1, values.length, 3).setValues(values);
    }
    sheet.autoResizeColumns(1, 3);
  });
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

function safeSheetName_(name) {
  return String(name || 'sheet').replace(/[\\\/\?\*\[\]\:]/g, '_').slice(0, 90);
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
