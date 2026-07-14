# อัปโหลด Love Matcha Sales v1.4.2 ขึ้น GitHub

## อัปโหลดทับ repository เดิม

1. เข้า repository ที่ GitHub Pages ใช้อยู่
2. กด **Add file > Upload files**
3. ลากไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้นไป โดย `index.html`, `app.js`, `style.css`, `sw.js` และ `version.json` ต้องอยู่ระดับเดียวกัน
4. เลือก **Commit changes**
5. เข้า **Actions** หรือ **Settings > Pages** เพื่อตรวจว่า deploy สำเร็จ
6. เปิด URL เดิมและตรวจเลขเวอร์ชัน `v1.4.2`

ข้อมูลร้านทั้งหมดอยู่ใน Firebase เดิม การอัปโหลดไฟล์หน้าเว็บทับไม่ลบข้อมูล Firestore

## ทดสอบในเครื่อง

Windows: ดับเบิลคลิก `เปิดทดสอบในเครื่อง.bat`

จากนั้นเปิด `http://localhost:8000` โปรแกรมห้ามเปิดด้วยการดับเบิลคลิก `index.html` เพราะเบราว์เซอร์จะบล็อก module และ service worker
