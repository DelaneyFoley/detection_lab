// Merge scripts/_review/*.json into _rationales.json and _assessments.json.
import fs from 'fs';

const dir = 'scripts/_review';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const rationales = {};
const assessments = {};
let n = 0;
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  for (const [row, v] of Object.entries(data)) {
    rationales[row] = v.rationale;
    assessments[row] = { verdict: v.verdict, rationale: v.assessment };
    n++;
  }
}
fs.writeFileSync('scripts/_rationales.json', JSON.stringify(rationales, null, 2));
fs.writeFileSync('scripts/_assessments.json', JSON.stringify(assessments, null, 2));
console.log(`merged ${n} reviewed images from ${files.length} montage files`);
