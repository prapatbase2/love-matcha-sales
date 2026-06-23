/*
  Love Matcha Sales Backup Web App
  วิธีใช้:
  1) เปิด https://script.google.com
  2) New project
  3) วางโค้ดนี้ใน Code.gs
  4) Deploy > New deployment > Web app
     - Execute as: Me
     - Who has access: Anyone
  5) Copy Web app URL ไปวางในหน้า "สำรองข้อมูล" ของเว็บ Love Matcha

  หมายเหตุ:
  - เว็บจะส่ง POST แบบ text/plain เพื่อเลี่ยง preflight CORS
  - doPost จะบันทึกไฟล์ JSON ลง Google Drive ของบัญชีที่ Deploy
*/

const BACKUP_FOLDER_NAME = 'LoveMatcha_Backups';

function doGet(e) {
  const folder = getOrCreateFolder_();
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      app: 'Love Matcha Sales Backup',
      message: 'Web App พร้อมใช้งาน',
      folderName: folder.getName(),
      time: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const folder = getOrCreateFolder_();
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const obj = JSON.parse(raw);

    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd_HH-mm-ss');
    const fileName = `LoveMatcha_Backup_${stamp}.json`;
    const pretty = JSON.stringify(obj, null, 2);
    const file = folder.createFile(fileName, pretty, MimeType.JSON);

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        fileName: fileName,
        fileId: file.getId(),
        url: file.getUrl(),
        bytes: pretty.length,
        time: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        error: String(err && err.message ? err.message : err),
        time: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateFolder_() {
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}
