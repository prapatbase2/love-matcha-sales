/*
  Love Matcha Sales v1.3 Backup Web App

  ทำหน้าที่รับข้อมูล backup จากเว็บ แล้วบันทึกใน Google Drive 2 แบบพร้อมกัน:
  1) ไฟล์ .json สำหรับ Restore ตรงในแอป
  2) Google Sheet สำหรับเปิดตรวจ / ดาวน์โหลดเป็น Excel แล้ว Restore ในแอปได้

  วิธี Deploy แบบย่อ:
  - เปิด https://script.google.com > New project
  - วางโค้ดนี้ใน Code.gs
  - กด Save
  - Deploy > New deployment > Web app
  - Execute as: Me
  - Who has access: Anyone
  - Copy Web app URL ไปวางในหน้า “สำรอง” ของแอป Love Matcha
*/

const BACKUP_FOLDER_NAME = 'LoveMatcha_Backups';
const MAX_CELL_CHARS = 45000; // กันข้อมูลต่อช่องใหญ่เกิน limit ของ Google Sheet

function doGet(e) {
  const folder = getOrCreateFolder_();
  return json_({
    ok: true,
    app: 'Love Matcha Sales Backup v1.3',
    message: 'Web App พร้อมใช้งาน: รับ POST แล้วสร้างทั้ง JSON และ Google Sheet ใน Drive',
    folderName: folder.getName(),
    time: new Date().toISOString()
  });
}

function doPost(e) {
  try {
    const folder = getOrCreateFolder_();
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const obj = JSON.parse(raw);
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd_HH-mm-ss');

    // 1) JSON backup
    const jsonName = `LoveMatcha_Backup_${stamp}.json`;
    const pretty = JSON.stringify(obj, null, 2);
    const jsonFile = folder.createFile(jsonName, pretty, MimeType.JSON);

    // 2) Google Sheet backup
    const ssName = `LoveMatcha_Backup_${stamp}`;
    const ss = SpreadsheetApp.create(ssName);
    const ssFile = DriveApp.getFileById(ss.getId());
    try { ssFile.moveTo(folder); }
    catch (moveErr) {
      // fallback สำหรับบัญชีที่ยังใช้เมธอดเดิมได้
      folder.addFile(ssFile);
      try { DriveApp.getRootFolder().removeFile(ssFile); } catch (ignore) {}
    }
    writeBackupToSpreadsheet_(ss, obj);

    return json_({
      ok: true,
      jsonFileName: jsonName,
      jsonFileId: jsonFile.getId(),
      jsonUrl: jsonFile.getUrl(),
      sheetName: ssName,
      sheetId: ss.getId(),
      sheetUrl: ss.getUrl(),
      collections: countCollections_(obj),
      time: new Date().toISOString()
    });
  } catch (err) {
    return json_({ok:false, error:String(err && err.message ? err.message : err), time:new Date().toISOString()});
  }
}

function writeBackupToSpreadsheet_(ss, obj) {
  const old = ss.getSheets();
  const first = old[0];
  first.setName('_README');
  first.clear();
  first.getRange(1, 1, 8, 2).setValues([
    ['app', obj.app || 'Love Matcha Sales'],
    ['version', obj.version || ''],
    ['exportedAt', obj.exportedAt || new Date().toISOString()],
    ['restoreHow', 'ดาวน์โหลดไฟล์นี้เป็น Microsoft Excel (.xlsx) แล้วเลือกไฟล์ในหน้า Restore ของแอป'],
    ['format', 'แต่ละ sheet ใช้คอลัมน์ id และ json เพื่อเก็บเอกสาร Firestore'],
    ['warning', 'อย่าแก้ไขคอลัมน์ id/json ถ้าต้องการ Restore กลับเข้าระบบ'],
    ['createdBy', 'Google Apps Script Web App'],
    ['folder', BACKUP_FOLDER_NAME]
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

function countCollections_(obj) {
  const out = {};
  const collections = obj.collections || {};
  Object.keys(collections).forEach(k => out[k] = Array.isArray(collections[k]) ? collections[k].length : 0);
  return out;
}

function safeSheetName_(name) {
  return String(name || 'sheet').replace(/[\\\/\?\*\[\]\:]/g, '_').slice(0, 90);
}

function getOrCreateFolder_() {
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
