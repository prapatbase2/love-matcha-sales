/*
  Love Matcha Sales Backup Web App v1.2
  ทำหน้าที่รับ Backup จากเว็บ แล้วบันทึกลง Google Drive เป็น 2 แบบพร้อมกัน:
  1) ไฟล์ JSON เต็มระบบ
  2) Google Sheet ที่ Restore กลับเข้าเว็บได้

  วิธี Deploy:
  - เปิด https://script.google.com
  - New project
  - ลบโค้ดเดิมใน Code.gs แล้ววางโค้ดนี้ทั้งหมด
  - Deploy > New deployment > Web app
    Execute as: Me
    Who has access: Anyone
  - Copy Web app URL ที่ลงท้าย /exec ไปวางในหน้า “สำรองข้อมูล” ของเว็บ
*/

const BACKUP_FOLDER_NAME = 'LoveMatcha_Backups';
const META_SHEET = '_backup_meta';

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'ping');
    if (action === 'restoreSheet') {
      const sheetId = String((e.parameter && e.parameter.sheetId) || '').trim();
      if (!sheetId) throw new Error('missing sheetId');
      const backup = readBackupSpreadsheet_(sheetId);
      return output_({ ok: true, backup: backup, time: new Date().toISOString() }, e.parameter.callback);
    }
    const folder = getOrCreateFolder_();
    return output_({
      ok: true,
      app: 'Love Matcha Sales Backup v1.2',
      message: 'Web App พร้อมใช้งาน',
      folderName: folder.getName(),
      folderUrl: folder.getUrl(),
      time: new Date().toISOString()
    }, e && e.parameter && e.parameter.callback);
  } catch (err) {
    return output_({ ok: false, error: String(err && err.message ? err.message : err), time: new Date().toISOString() }, e && e.parameter && e.parameter.callback);
  }
}

function doPost(e) {
  try {
    const folder = getOrCreateFolder_();
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const incoming = JSON.parse(raw);
    const backup = incoming.backup && incoming.backup.collections ? incoming.backup : incoming;
    if (!backup || !backup.collections) throw new Error('payload ไม่มี collections สำหรับ Backup');

    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd_HH-mm-ss');
    const reason = incoming.reason || 'backup';
    const jsonFileName = `LoveMatcha_Backup_${stamp}.json`;
    const pretty = JSON.stringify(backup, null, 2);
    const jsonFile = folder.createFile(jsonFileName, pretty, MimeType.JSON);

    let sheetInfo = null;
    if (incoming.createSheet !== false) {
      const ss = createBackupSpreadsheet_(backup, stamp, reason);
      const ssFile = DriveApp.getFileById(ss.getId());
      ssFile.moveTo(folder);
      sheetInfo = { id: ss.getId(), name: ss.getName(), url: ss.getUrl() };
    }

    return output_({
      ok: true,
      json: { fileName: jsonFileName, fileId: jsonFile.getId(), url: jsonFile.getUrl(), bytes: pretty.length },
      sheet: sheetInfo,
      folder: { name: folder.getName(), url: folder.getUrl() },
      reason: reason,
      time: new Date().toISOString()
    });
  } catch (err) {
    return output_({ ok: false, error: String(err && err.message ? err.message : err), time: new Date().toISOString() });
  }
}

function createBackupSpreadsheet_(backup, stamp, reason) {
  const ss = SpreadsheetApp.create(`LoveMatcha_Backup_${stamp}`);
  const meta = ss.getSheets()[0];
  meta.setName(META_SHEET);
  meta.appendRow(['key', 'value']);
  meta.appendRow(['app', backup.app || 'Love Matcha Sales']);
  meta.appendRow(['version', backup.version || '']);
  meta.appendRow(['exportedAt', backup.exportedAt || new Date().toISOString()]);
  meta.appendRow(['savedAt', new Date().toISOString()]);
  meta.appendRow(['reason', reason || 'backup']);
  meta.appendRow(['format', 'LoveMatchaSheetBackupV1']);

  Object.keys(backup.collections || {}).forEach(function (collectionName) {
    const sheet = ss.insertSheet(safeSheetName_(collectionName));
    const docs = Array.isArray(backup.collections[collectionName]) ? backup.collections[collectionName] : [];
    const rows = docs.map(function (doc) {
      const chunks = chunkText_(JSON.stringify(doc.data || {}), 45000);
      return [String(doc.id || '')].concat(chunks);
    });
    const maxChunks = rows.reduce(function (m, r) { return Math.max(m, r.length - 1); }, 1);
    const headers = ['id'];
    for (let i = 1; i <= maxChunks; i++) headers.push('json_' + i);
    sheet.appendRow(headers);
    if (rows.length) {
      const values = rows.map(function (r) {
        while (r.length < headers.length) r.push('');
        return r;
      });
      sheet.getRange(2, 1, values.length, headers.length).setValues(values);
    }
    sheet.autoResizeColumns(1, Math.min(headers.length, 6));
  });

  // เพิ่ม tab อ่านง่ายสำหรับยอดขาย เพื่อเปิดดูใน Google Sheet ได้สะดวก แต่ Restore จะใช้ tab collection จริง
  const daily = backup.collections && backup.collections.dailySales;
  if (Array.isArray(daily)) {
    const sheet = ss.insertSheet('dailySales_readable');
    const headers = ['date','branchId','closed','grossSales','discount','netSales','cashSales','transferSales','lineMan','grab','totalAll','cowMilkCost','oatMilkCost','milkCost','otherExpenseTotal','cashDiff','cupsUsed','note'];
    sheet.appendRow(headers);
    const rows = daily.map(function (item) {
      const d = item.data || {};
      return headers.map(function (h) { return d[h] === undefined ? '' : d[h]; });
    });
    if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.autoResizeColumns(1, headers.length);
  }
  return ss;
}

function readBackupSpreadsheet_(sheetId) {
  const ss = SpreadsheetApp.openById(sheetId);
  const backup = { app: 'Love Matcha Sales', version: '', exportedAt: '', restoredFromSheetId: sheetId, collections: {} };
  const meta = ss.getSheetByName(META_SHEET);
  if (meta) {
    const values = meta.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      const key = String(values[i][0] || '');
      const value = values[i][1];
      if (key === 'app') backup.app = value;
      if (key === 'version') backup.version = value;
      if (key === 'exportedAt') backup.exportedAt = value;
    }
  }
  ss.getSheets().forEach(function (sheet) {
    const name = sheet.getName();
    if (name === META_SHEET || name.endsWith('_readable')) return;
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      backup.collections[name] = [];
      return;
    }
    const headers = values[0].map(function (h) { return String(h || '').trim(); });
    const idCol = headers.indexOf('id');
    let jsonCols = [];
    const oldJsonCol = headers.indexOf('json');
    if (oldJsonCol >= 0) jsonCols = [oldJsonCol];
    headers.forEach(function (h, i) { if (/^json_\d+$/.test(h)) jsonCols.push(i); });
    jsonCols = jsonCols.sort(function (a, b) { return a - b; });
    if (idCol < 0 || !jsonCols.length) return;
    backup.collections[name] = [];
    for (let r = 1; r < values.length; r++) {
      const id = String(values[r][idCol] || '').trim();
      const json = jsonCols.map(function (c) { return String(values[r][c] || ''); }).join('').trim();
      if (!id || !json) continue;
      backup.collections[name].push({ id: id, data: JSON.parse(json) });
    }
  });
  return backup;
}

function getOrCreateFolder_() {
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

function chunkText_(text, size) {
  const chunks = [];
  const s = String(text || '');
  for (let i = 0; i < s.length; i += size) chunks.push(s.slice(i, i + size));
  return chunks.length ? chunks : [''];
}

function safeSheetName_(name) {
  return String(name || 'sheet').replace(/[\\\/\?\*\[\]\:]/g, '_').slice(0, 90);
}

function output_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    const safeCallback = String(callback).replace(/[^a-zA-Z0-9_.$]/g, '');
    return ContentService.createTextOutput(`${safeCallback}(${json});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
