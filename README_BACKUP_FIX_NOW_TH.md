# วิธีแก้ Backup Drive ว่าง (สำคัญ)

ถ้ากดทดสอบแล้วหน้าใหม่ขึ้น `Love Matcha Sales Backup v1.2` แปลว่า Google Apps Script ที่ URL เดิมยังเป็นโค้ดเก่า หรือยังไม่ได้ Deploy version ใหม่เข้า URL `/exec` เดิม

## ทำตามนี้แบบเป๊ะ ๆ

1. เปิด Google Apps Script ตัวเดิมที่ใช้ URL นี้
2. เปิดไฟล์ `apps-script-backup.gs` ใน ZIP นี้
3. ก๊อปโค้ดทั้งหมดไปวางทับ `Code.gs` ทั้งไฟล์
4. กด Save
5. ไปที่ `Deploy` > `Manage deployments`
6. กดรูปดินสอของ Web App เดิม
7. ช่อง `Version` เลือก `New version`
8. ตั้งค่า:
   - Execute as: Me
   - Who has access: Anyone
9. กด Deploy และ Authorize ถ้ามีให้กด
10. กลับไปที่แอป กด `ทดสอบสร้างไฟล์ใน Drive`

## ผลที่ถูกต้อง

หน้าใหม่ต้องขึ้นประมาณนี้:

- `app`: `Love Matcha Sales Backup v1.4.0`
- มี `jsonFileName`
- ไม่มี `sheetName` เพราะ v1.4.0 ยกเลิก Google Sheet/Excel แล้ว
- มี `folderUrl`

ถ้ายังขึ้น v1.2 คือยัง Deploy ไม่สำเร็จ หรือเปิด Apps Script คนละตัว

## ถ้ามีโฟลเดอร์ LoveMatcha_Backups ซ้ำ 2 อัน

ให้เปิดโฟลเดอร์ที่ต้องการใน Google Drive แล้วคัดลอก Folder ID จาก URL:

`https://drive.google.com/drive/folders/เอารหัสตรงนี้`

จากนั้นเอารหัสไปใส่ใน `Code.gs` บรรทัดนี้:

`const BACKUP_FOLDER_ID = '';`

เช่น:

`const BACKUP_FOLDER_ID = '1AbCxxxxxxxxxxxxxxxx';`

แล้ว Save > Deploy New version อีกครั้ง
