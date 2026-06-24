# คู่มือ Backup / Restore Love Matcha Sales v1.2

## สิ่งที่ v1.2 ทำให้แล้ว

1. Backup ไป Google Drive ได้ทั้ง 2 แบบพร้อมกัน
   - ไฟล์ `.json` สำหรับ Restore เต็มระบบแบบตรงที่สุด
   - Google Sheet สำหรับเปิดดู/ตรวจสอบ/Restore กลับเข้าเว็บได้
2. Restore ได้ 2 ทาง
   - เลือกไฟล์ JSON จากเครื่อง
   - วางลิงก์ Google Sheet Backup แล้วโหลดกลับเข้าเว็บ
3. Auto Backup ใช้ URL เดียวกันทุกเครื่อง เพราะ URL ถูกบันทึกใน Firebase `appSettings` ทุกเครื่องที่ login เข้ามาจะเห็นค่าเดียวกัน
4. ก่อน Restore ระบบจะ Backup ปัจจุบันให้อีกชุดก่อนเสมอ และต้องกรอก PIN เจ้าของ

---

## A) วิธีสร้าง Google Apps Script Web App แบบละเอียด

### 1) เปิด Apps Script

1. เข้าเว็บ `https://script.google.com`
2. กด **New project**
3. ตั้งชื่อโปรเจกต์ เช่น `Love Matcha Sales Backup`

### 2) วางโค้ด Backup

1. ในไฟล์ `Code.gs` ให้ลบโค้ดเดิมออกทั้งหมด
2. เปิดไฟล์ใน ZIP ชื่อ `apps-script-backup.gs`
3. คัดลอกโค้ดทั้งหมดในไฟล์นั้น
4. วางลงใน `Code.gs`
5. กด **Save**

### 3) Deploy เป็น Web App

1. กด **Deploy** มุมขวาบน
2. เลือก **New deployment**
3. กดไอคอนรูปเฟือง / Select type
4. เลือก **Web app**
5. ตั้งค่าดังนี้
   - Description: `Love Matcha Backup v1.2`
   - Execute as: **Me**
   - Who has access: **Anyone**
6. กด **Deploy**
7. Google จะให้อนุญาตสิทธิ์ ให้กด Authorize / Review permissions / Allow
8. คัดลอก **Web app URL** ที่ลงท้ายด้วย `/exec`

> สำคัญ: ใช้ URL ที่ลงท้าย `/exec` ไม่ใช่ `/dev`

---

## B) เอา URL ไปใส่ในเว็บ Love Matcha

1. เข้าเว็บ Love Matcha Sales
2. Login ด้วย user เจ้าของ
3. ไปหน้า **สำรอง**
4. วาง Web App URL ในช่อง **Google Apps Script Web App URL**
5. ตั้ง Auto Backup ได้ตามต้องการ
   - ปิด
   - สำรองทุกกี่นาที
   - สำรองเมื่อมีการทำรายการ
   - ทั้งสองแบบ
6. ให้ติ๊ก **สร้าง Google Sheet ทุกครั้ง** ไว้
7. กด **บันทึกตั้งค่า**
8. กด **ทดสอบเชื่อมต่อ**
9. กด **Backup ไป Drive ตอนนี้** หนึ่งครั้งเพื่อทดสอบจริง

เมื่อสำเร็จ ให้เปิด Google Drive ของบัญชีที่ Deploy Apps Script จะมีโฟลเดอร์ชื่อ:

`LoveMatcha_Backups`

ข้างในจะมีไฟล์ประมาณนี้:

- `LoveMatcha_Backup_2026-06-24_21-30-00.json`
- `LoveMatcha_Backup_2026-06-24_21-30-00` เป็น Google Sheet

---

## C) ทำไมทุกเครื่องถึง Backup ได้เหมือนกัน

ค่า Web App URL ถูกบันทึกไว้ใน Firebase ในเอกสาร `appSettings/main` ไม่ได้เก็บไว้เฉพาะเครื่องใดเครื่องหนึ่ง

ดังนั้นถ้าเจ้าของตั้ง URL แล้ว ทุกเครื่องที่เปิดเว็บเดียวกันและใช้ Firebase โปรเจกต์เดียวกันจะใช้ URL เดียวกันได้ทันที

---

## D) วิธี Restore จาก JSON

ใช้วิธีนี้เมื่ออยากกู้เต็มระบบแบบตรงที่สุด

1. เข้าเว็บด้วย user เจ้าของ
2. ไปหน้า **สำรอง**
3. ในหัวข้อ Restore เลือกไฟล์ `.json`
4. ระบบจะแสดง Preview จำนวนข้อมูลแต่ละ collection
5. กรอก PIN เจ้าของ
6. กด **Restore ข้อมูล**
7. ยืนยันอีกครั้ง

ระบบจะ Backup ข้อมูลปัจจุบันให้อีกชุดก่อน แล้วค่อย Restore

---

## E) วิธี Restore จาก Google Sheet

ใช้กับ Google Sheet ที่ระบบ v1.2 สร้างไว้เท่านั้น

1. เปิด Google Drive
2. เข้าโฟลเดอร์ `LoveMatcha_Backups`
3. เปิดไฟล์ Google Sheet Backup ที่ต้องการกู้
4. Copy URL ของ Google Sheet นั้น หรือ Copy เฉพาะ Sheet ID ก็ได้
5. กลับมาเว็บ Love Matcha Sales หน้า **สำรอง**
6. วาง URL/Sheet ID ในช่อง **Restore จาก Google Sheet URL / Sheet ID**
7. กด **โหลดข้อมูลจาก Sheet**
8. ระบบจะแสดง Preview
9. กรอก PIN เจ้าของ
10. กด **Restore ข้อมูล**

---

## F) ข้อควรระวัง

- Restore จะเขียนทับข้อมูลที่มี ID เดียวกัน เช่น ยอดขายสาขาเดียวกันวันเดียวกัน
- ก่อน Restore ระบบจะ Backup ปัจจุบันให้อัตโนมัติ แต่ควรกด Backup เองอีกครั้งก่อนทำเสมอ
- อย่าแก้ tab collection ใน Google Sheet ถ้าจะเอาไว้ Restore กลับ
- tab ที่ชื่อ `dailySales_readable` มีไว้เปิดดูง่าย ไม่ได้ใช้เป็นต้นฉบับ Restore
- ถ้า Deploy Apps Script ใหม่ ต้องเอา URL `/exec` ใหม่ไปวางในเว็บอีกครั้ง

---

## G) ถ้ากด Backup แล้วไม่เห็นไฟล์ใน Drive

ตรวจทีละข้อ:

1. ใช้ user เจ้าของในเว็บหรือไม่
2. วาง URL `/exec` ถูกต้องหรือไม่
3. Apps Script Deploy เป็น Web app แล้วหรือยัง
4. Execute as ตั้งเป็น **Me** หรือไม่
5. Who has access ตั้งเป็น **Anyone** หรือไม่
6. ตอน Authorize ให้สิทธิ์ Drive/Spreadsheet แล้วหรือยัง
7. เปิด Google Drive ด้วยบัญชีเดียวกับที่ Deploy Apps Script หรือไม่

---

## H) วิธีอัปเดตโค้ด Apps Script ถ้ามีเวอร์ชันใหม่

1. เปิดโปรเจกต์ Apps Script เดิม
2. แก้โค้ดใน `Code.gs`
3. กด Save
4. กด **Deploy > Manage deployments**
5. เลือก deployment เดิม
6. กด Edit
7. Version เลือก **New version**
8. กด Deploy
9. ถ้า URL `/exec` ยังเป็นอันเดิม ไม่ต้องแก้ในเว็บ

