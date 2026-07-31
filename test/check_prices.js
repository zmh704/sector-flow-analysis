'use strict';
const fs = require('fs');
const path = require('path');

// Check if all v3 files have price data in stock dictionary
const files = fs.readdirSync('data')
    .filter(f => f.endsWith('.v3.json'))
    .sort();

let totalStocks = 0;
let withClose = 0;
let withAvg5 = 0;

for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join('data', f), 'utf8'));
    const dict = d['股票字典'];
    const stocks = Object.values(dict);
    totalStocks += stocks.length;
    for (const s of stocks) {
        if (s.close != null && Number.isFinite(s.close)) withClose++;
        if (s.avg5 != null && Number.isFinite(s.avg5)) withAvg5++;
    }
}

console.log('文件数:', files.length);
console.log('总股票记录:', totalStocks);
console.log('有close:', withClose);
console.log('有avg5:', withAvg5);

// Check overlap between consecutive days
const dates = files.map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);
console.log('日期范围:', dates[0], '~', dates[dates.length - 1]);

let totalPairs = 0;
for (let i = 0; i < dates.length - 1; i++) {
    const d1 = JSON.parse(fs.readFileSync(path.join('data', files[i]), 'utf8'));
    const d2 = JSON.parse(fs.readFileSync(path.join('data', files[i + 1]), 'utf8'));
    const keys1 = new Set(Object.keys(d1['股票字典']));
    const keys2 = new Set(Object.keys(d2['股票字典']));
    const overlap = [...keys1].filter(k => keys2.has(k));
    totalPairs += overlap.length;
    console.log(`${dates[i]} -> ${dates[i + 1]}: ${keys1.size} vs ${keys2.size}, 重叠 ${overlap.length}`);
}
console.log('总配对数:', totalPairs);
