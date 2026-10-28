import { mkdir, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { createRequire } from 'node:module';

// Authoritative synthetic parser fixtures; no personal financial information.
const directory = 'public/samples/formats';
const records = [['date','description','amount'], ...Array.from({length:18},(_,i) => [`2026-10-${String(i+1).padStart(2,'0')}`,`Shop-${String.fromCharCode(65+i)}`,String(-(i+1))+'.00'])];
const lines = records.map(row => row.join(','));
await mkdir(directory,{recursive:true});
await writeFile(`${directory}/statement.csv`,lines.join('\n'));
const workbook = new ExcelJS.Workbook();const sheet = workbook.addWorksheet('Synthetic statement');
records.forEach(row => sheet.addRow(row)); await workbook.xlsx.writeFile(`${directory}/statement.xlsx`);

const escapePdf = (value: string) => value.replace(/([\\()])/g,'\\$1');
const stream = `BT /F1 9 Tf 14 TL 20 790 Td\n${lines.map(line => `(${escapePdf(line)}) Tj T*`).join('\n')}\nET`;
const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
let pdf = '%PDF-1.4\n';const offsets = [0];
objects.forEach((object,i) => { offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
await writeFile(`${directory}/statement.pdf`,pdf);

// Canvas is provided by PDF.js's Node renderer dependency; generation only.
const require = createRequire(import.meta.url);
const { createCanvas } = require('@napi-rs/canvas') as { createCanvas: (w:number,h:number) => any };
const canvas = createCanvas(2300,1000);const context = canvas.getContext('2d');
context.fillStyle='#ffffff';context.fillRect(0,0,2300,1000);context.fillStyle='#000000';context.font='34px Consolas';
lines.forEach((line,i) => context.fillText(line,40,60+i*48));
await writeFile(`${directory}/statement.png`,canvas.toBuffer('image/png'));
console.log('Created four synthetic statement formats with 18 equivalent rows.');
