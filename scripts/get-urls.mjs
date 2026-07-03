import Database from "better-sqlite3";
const db = new Database("./data/vlm-eval.db");

const imageIds = ['MO-16','MO-23','MO-27','O-107','O-108','O-111','O-117','O-120','O-131','O-138','O-141','O-148','O-166','O-294','O-302','R-105','R-115','R-1050','R-1060','R-1062','R-1065','MO-28','MR-2','MR-6','MR-8','MR-9','MR-11','MR-12','MR-16','MR-22','MR-23','MR-24','MR-26','O-19','O-116','O-11','O-18','O-26','O-100','O-110','O-118','O-134','O-136','O-140','O-152','O-155','O-158','O-162','O-167','O-171','O-173','O-175','O-178','O-179','O-187','O-200','O-201','O-207','O-208','O-212','O-220','O-231','O-234','O-236','O-248','O-249','R-1135','O-12','O-123','O-150','O-295','O-299','O-301','O-305','R-11','R-104','R-1102','R-1105','R-1128','R-1136','R-1166','R-1169','R-1174','R-1195'];

const placeholders = imageIds.map(() => '?').join(',');
const rows = db.prepare(`SELECT image_id, image_uri FROM predictions WHERE run_id = 'e54e563f-0b8f-4101-9b47-d20b8f886903' AND image_id IN (${placeholders})`).all(...imageIds);

const rowMap = {};
for (const r of rows) rowMap[r.image_id] = r.image_uri;

console.log(`Image ID | Org ID | Flyreel ID | URL`);
console.log(`--- | --- | --- | ---`);
for (const id of imageIds) {
  const uri = rowMap[id] || 'NOT FOUND';
  let orgId = '';
  let flyreelId = '';
  if (uri.includes('storage.googleapis.com/flyreel-media-2020/')) {
    const parts = uri.replace('https://storage.googleapis.com/flyreel-media-2020/', '').split('/');
    orgId = parts[0] || '';
    flyreelId = parts[1] || '';
  } else if (uri.includes('firebasestorage.googleapis.com')) {
    const match = uri.match(/o\/[^%]+%2F([^%]+)%2F/);
    flyreelId = match ? match[1] : '';
  }
  console.log(`${id} | ${orgId} | ${flyreelId} | ${uri}`);
}
db.close();
