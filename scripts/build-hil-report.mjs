// Generates a "HIL Corrections" style Excel report from the query_result source file.
// Columns:
//   A Thumbnail | B Image ID | C Category | D Flyreel ID (hyperlinked) |
//   E Model Label | F HIL Label | G Rationale | H HIL Assessment | I Assessment Rationale
// Thumbnails fill the cell and use two-cell anchoring so deleting a row deletes
// its image. Rationale (fp/fn) supports the HIL change per the inference prompts;
// the Assessment columns record an independent agree/disagree QA review of HIL.
//
// Usage: node scripts/build-hil-report.mjs [limit] [month]
//   limit (optional): number of data rows to include (default: all)
//   month (optional): YYYY-MM to filter by detection_day (e.g., 2026-09)

import ExcelJS from 'exceljs';
import sharp from 'sharp';
import https from 'https';
import http from 'http';
import fs from 'fs';

const SRC = 'query_result_2026-10-19T14_58_24.883092421-07_00.xlsx';
const LIMIT = process.argv[2] && /^\d+$/.test(process.argv[2]) ? parseInt(process.argv[2], 10) : Infinity;
const MONTH = process.argv[3] || null; // e.g. '2026-09'
const MONTH_NAMES = { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec' };
const monthTag = MONTH ? `_${MONTH_NAMES[MONTH.slice(5, 7)]}${MONTH.slice(0, 4)}` : '';
const OUT = LIMIT === Infinity
  ? `Major Corrosion_HIL Corrections${monthTag || '_Oct 19_2026'}.xlsx`
  : `Major Corrosion_HIL Corrections_Oct 19_2026_sample${LIMIT}.xlsx`;

function detectionMonth(v) {
  const iso = v instanceof Date ? v.toISOString() : String(v);
  return iso.slice(0, 7);
}

// Rationales authored from visual review of the fp/fn thumbnails, grounded in
// the fixture-specific inference prompts. Keyed by source row number.
const RATIONALES = JSON.parse(fs.readFileSync('scripts/_rationales.json', 'utf8'));
// Independent QA assessment of each HIL change (agree/disagree + rationale).
const ASSESSMENTS = JSON.parse(fs.readFileSync('scripts/_assessments.json', 'utf8'));

// Thumbnail cell geometry. Large enough to review the image by eye.
const COL_WIDTH = 34; // Excel char width for the thumbnail column
const ROW_HEIGHT = 230; // points
// Cell pixel size (Excel: width*7+5 px; height*96/72 px), rendered at ~2x.
const CELL_PX_W = Math.round((COL_WIDTH * 7 + 5) * 2);
const CELL_PX_H = Math.round(((ROW_HEIGHT * 96) / 72) * 2);

function fetchImage(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client
      .get(url, { headers: { 'User-Agent': 'detection-lab-export' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchImage(res.headers.location, redirects + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function flyreelIdFromUrl(url) {
  const m = String(url).match(/flyreel-media-2020\/([^/]+)\/([^/]+)\//);
  return m ? m[2] : null;
}

// The 3rd colon-segment of the tag is the fixture type.
function categoryFromTag(tag) {
  const parts = String(tag).split(':');
  const fixture = (parts[2] || '').trim().toLowerCase();
  switch (fixture) {
    case 'water heater': return 'Water Heater';
    case 'toilet': return 'Toilet';
    case 'sink': return 'Sink';
    case 'washing machine': return 'Laundry';
    default: return fixture ? fixture.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
  }
}

// Map outcome -> [modelLabel (predicted), hilLabel]
function labelsForOutcome(outcome) {
  switch (outcome) {
    case 'tp': return ['DETECTED', 'DETECTED'];
    case 'fp': return ['DETECTED', 'NOT_DETECTED'];
    case 'fn': return ['NOT_DETECTED', 'DETECTED'];
    default: return ['', ''];
  }
}

const src = new ExcelJS.Workbook();
await src.xlsx.readFile(SRC);
const sws = src.worksheets[0];
const header = sws.getRow(1);
const idx = {};
header.eachCell((cell, c) => { idx[String(cell.value).trim()] = c; });

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Dataset');
ws.columns = [
  { header: 'Thumbnail', key: 'thumb', width: COL_WIDTH },
  { header: 'Image ID', key: 'image_id', width: 16 },
  { header: 'Category', key: 'category', width: 16 },
  { header: 'Flyreel ID', key: 'flyreel_id', width: 32 },
  { header: 'Model Label', key: 'model_label', width: 16 },
  { header: 'HIL Label', key: 'hil_label', width: 16 },
  { header: 'Rationale', key: 'rationale', width: 60 },
  { header: 'HIL Assessment', key: 'hil_assessment', width: 16 },
  { header: 'Assessment Rationale', key: 'assessment_rationale', width: 60 },
  { header: 'Corrosion Flagged on Same Flyreel/Location', key: 'same_location_flag', width: 34 },
];
const headerRow = ws.getRow(1);
headerRow.font = { bold: true };
headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

const total = sws.rowCount - 1;
let imagesFailed = 0;

// Collect the selected source rows into records before writing anything, so we
// can sort by flyreel ID and compute cross-image flags.
const records = [];
for (let srcRowNum = 2; srcRowNum <= total + 1; srcRowNum++) {
  if (records.length >= LIMIT) break;
  const row = sws.getRow(srcRowNum);
  if (MONTH && detectionMonth(row.getCell(idx.detection_day).value) !== MONTH) continue;
  const outcome = String(row.getCell(idx.outcome).value).toLowerCase();
  const frameUrl = String(row.getCell(idx.frame_url).value);
  const flyreelId = flyreelIdFromUrl(frameUrl);
  const category = categoryFromTag(row.getCell(idx.tag).value);
  const [modelLabel, hilLabel] = labelsForOutcome(outcome);
  const rationale = outcome === 'tp' ? '' : (RATIONALES[String(srcRowNum)] || '');
  const assessment = outcome === 'tp' ? null : ASSESSMENTS[String(srcRowNum)];
  records.push({ srcRowNum, outcome, frameUrl, flyreelId, category, modelLabel, hilLabel, rationale, assessment });
}
const count = records.length;

// Group same-flyreel (and same-location) images together.
records.sort((a, b) => {
  const fa = a.flyreelId || '';
  const fb = b.flyreelId || '';
  if (fa !== fb) return fa < fb ? -1 : 1;
  if (a.category !== b.category) return a.category < b.category ? -1 : 1;
  return a.srcRowNum - b.srcRowNum;
});

// Assign display Image IDs in the sorted order.
records.forEach((rec, i) => { rec.imageId = `Example_${String(i + 1).padStart(2, '0')}`; });

// Flag: was major corrosion (HIL = DETECTED) identified on ANY OTHER image with
// the same flyreel ID and same location? Lists the other Image IDs when so.
for (const rec of records) {
  const others = records.filter(
    (o) => o !== rec && o.flyreelId === rec.flyreelId && o.category === rec.category && o.hilLabel === 'DETECTED',
  );
  rec.sameLocationFlag = others.length ? `Yes - ${others.map((o) => o.imageId).join(', ')}` : 'No';
}

// Phase 1: create all data rows first (in sorted order). Images are added
// afterwards so that addImage materializing a `br` row cannot shift subsequent
// addRow() cursors.
const rowMeta = [];
for (const rec of records) {
  const { srcRowNum, frameUrl, flyreelId, category, modelLabel, hilLabel, rationale, assessment } = rec;

  const added = ws.addRow({
    thumb: '',
    image_id: rec.imageId,
    category,
    flyreel_id: flyreelId || '',
    model_label: modelLabel,
    hil_label: hilLabel,
    rationale,
    hil_assessment: assessment ? assessment.verdict : '',
    assessment_rationale: assessment ? assessment.rationale : '',
    same_location_flag: rec.sameLocationFlag,
  });
  added.height = ROW_HEIGHT;
  added.alignment = { vertical: 'middle', wrapText: true };
  added.getCell('image_id').alignment = { vertical: 'middle', horizontal: 'center' };
  added.getCell('category').alignment = { vertical: 'middle', horizontal: 'center' };
  added.getCell('model_label').alignment = { vertical: 'middle', horizontal: 'center' };
  added.getCell('hil_label').alignment = { vertical: 'middle', horizontal: 'center' };
  added.getCell('hil_assessment').alignment = { vertical: 'middle', horizontal: 'center' };
  added.getCell('same_location_flag').alignment = { vertical: 'middle', horizontal: 'center' };
  if (assessment) {
    added.getCell('hil_assessment').font = {
      bold: true,
      color: { argb: assessment.verdict === 'Agree' ? 'FF107C41' : 'FFC00000' },
    };
  }
  if (rec.sameLocationFlag !== 'No') {
    added.getCell('same_location_flag').font = { bold: true, color: { argb: 'FFC00000' } };
  }

  if (flyreelId) {
    const cell = added.getCell('flyreel_id');
    cell.value = {
      text: flyreelId,
      hyperlink: `https://dashboard.flyreel.co/flyreels/${flyreelId}`,
    };
    cell.font = { color: { argb: 'FF0563C1' }, underline: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }

  rowMeta.push({ srcRowNum, rowNum: added.number, frameUrl });
}

// Phase 2: fetch images and anchor them to their (now-existing) rows.
for (let i = 0; i < rowMeta.length; i++) {
  const { srcRowNum, rowNum, frameUrl } = rowMeta[i];
  try {
    const buf = await fetchImage(frameUrl);
    // Letterbox onto a cell-shaped white canvas so the full image is visible
    // and fills the cell without distortion. failOn:'none' tolerates truncated JPEGs.
    const thumb = await sharp(buf, { failOn: 'none' })
      .resize(CELL_PX_W, CELL_PX_H, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 82 })
      .toBuffer();
    const imageId = wb.addImage({ buffer: thumb, extension: 'jpeg' });
    // Full-cell two-cell anchor (col 0->1, row r-1->r). editAs 'twoCell' => the
    // image moves and sizes with the cell and is deleted when the row is deleted.
    ws.addImage(imageId, {
      tl: { col: 0, row: rowNum - 1 },
      br: { col: 1, row: rowNum },
      editAs: 'twoCell',
    });
  } catch (e) {
    imagesFailed++;
    if (imagesFailed <= 5) console.warn(`  image failed (src row ${srcRowNum}): ${e.message}`);
  }

  if ((i + 1) % 25 === 0) console.log(`  processed ${i + 1}/${count}`);
}

await wb.xlsx.writeFile(OUT);
console.log(`\nWrote ${OUT}`);
console.log(`  rows: ${count}, images embedded: ${count - imagesFailed}/${count}`);
