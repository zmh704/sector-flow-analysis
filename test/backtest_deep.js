'use strict';
/**
 * 深度回测：针对"涨+主力净流出"信号做精细化条件搜索
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const v3Files = fs.readdirSync(dataDir).filter(f => f.endsWith('.v3.json')).sort();

const days = [];
for (const f of v3Files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
    const dict = raw['股票字典'];
    if (!dict) continue;
    const stocks = new Map();
    for (const [key, s] of Object.entries(dict)) {
        const stock = {
            stockKey: key, name: s.name,
            netYi: Number(s.netYi) || 0,
            changePct: Number(s.changePct) || 0,
            amountYi: Number(s.amountYi) || 0,
            volumeWanShou: Number(s.volumeWanShou) || 0,
        };
        stock.netRatio = stock.amountYi > 0 ? stock.netYi / stock.amountYi : 0;
        stocks.set(key, stock);
    }
    days.push({ date: raw['交易日期'], stocks });
}

const samples = [];
for (let i = 0; i < days.length - 1; i++) {
    for (const [key, sT] of days[i].stocks) {
        const sT1 = days[i + 1].stocks.get(key);
        if (!sT1) continue;
        samples.push({
            date: days[i].date, nextDate: days[i + 1].date,
            stockKey: key, name: sT.name,
            netYi: sT.netYi, changePct: sT.changePct,
            amountYi: sT.amountYi, volumeWanShou: sT.volumeWanShou,
            netRatio: sT.netRatio,
            nextChangePct: sT1.changePct,
        });
    }
}

function backtest(name, filter) {
    const matched = samples.filter(filter);
    if (matched.length === 0) return null;
    const returns = matched.map(s => s.nextChangePct);
    const wins = returns.filter(r => r > 0);
    const losses = returns.filter(r => r <= 0);
    const winRate = wins.length / returns.length;
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : Infinity;
    const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length);
    const sharpe = stdDev > 0 ? avgReturn / stdDev : 0;

    // 逐日稳定性
    const dayMap = new Map();
    for (const s of matched) {
        if (!dayMap.has(s.date)) dayMap.set(s.date, []);
        dayMap.get(s.date).push(s.nextChangePct);
    }
    const dailyWinRates = [];
    for (const [date, rets] of dayMap) {
        const dw = rets.filter(r => r > 0).length / rets.length;
        dailyWinRates.push(dw);
    }
    const daysWinGt50 = dailyWinRates.filter(r => r > 0.5).length;
    const minDaily = Math.min(...dailyWinRates);
    const maxDaily = Math.max(...dailyWinRates);
    const consistentDays = daysWinGt50 / dailyWinRates.length;

    return { name, sampleCount: matched.length, winRate, avgReturn, avgWin, avgLoss, profitFactor, sharpe, stdDev, daysTotal: dailyWinRates.length, daysWinGt50, minDaily, maxDaily, consistentDays };
}

// ── 精细化条件搜索 ──────────────────────────────────
const conditions = [
    // === A: 涨+主力净流出 系列 (核心信号) ===
    { name: '涨+净流出>0.5亿', filter: s => s.changePct > 0 && s.netYi < -0.5 },
    { name: '涨+净流出>1亿', filter: s => s.changePct > 0 && s.netYi < -1 },
    { name: '涨+净流出>2亿', filter: s => s.changePct > 0 && s.netYi < -2 },
    { name: '涨+净流出>3亿', filter: s => s.changePct > 0 && s.netYi < -3 },
    { name: '涨+净流出>5亿', filter: s => s.changePct > 0 && s.netYi < -5 },
    { name: '涨+净流出>8亿', filter: s => s.changePct > 0 && s.netYi < -8 },

    // === B: 涨幅区间+净流出 ===
    { name: '涨0~3%+净流出>1亿', filter: s => s.changePct > 0 && s.changePct <= 3 && s.netYi < -1 },
    { name: '涨0~3%+净流出>2亿', filter: s => s.changePct > 0 && s.changePct <= 3 && s.netYi < -2 },
    { name: '涨3~5%+净流出>1亿', filter: s => s.changePct > 3 && s.changePct <= 5 && s.netYi < -1 },
    { name: '涨3~5%+净流出>2亿', filter: s => s.changePct > 3 && s.changePct <= 5 && s.netYi < -2 },
    { name: '涨5~10%+净流出>1亿', filter: s => s.changePct > 5 && s.changePct < 10 && s.netYi < -1 },
    { name: '涨5~10%+净流出>2亿', filter: s => s.changePct > 5 && s.changePct < 10 && s.netYi < -2 },
    { name: '涨5~10%+净流出>3亿', filter: s => s.changePct > 5 && s.changePct < 10 && s.netYi < -3 },

    // === C: 涨幅+净流出+净流出占比 ===
    { name: '涨+净流出>1亿+流出占比>3%', filter: s => s.changePct > 0 && s.netYi < -1 && s.netRatio < -0.03 },
    { name: '涨+净流出>1亿+流出占比>5%', filter: s => s.changePct > 0 && s.netYi < -1 && s.netRatio < -0.05 },
    { name: '涨>3%+净流出>1亿+流出占比>3%', filter: s => s.changePct > 3 && s.netYi < -1 && s.netRatio < -0.03 },
    { name: '涨>3%+净流出>1亿+流出占比>5%', filter: s => s.changePct > 3 && s.netYi < -1 && s.netRatio < -0.05 },
    { name: '涨>3%+净流出>2亿+流出占比>5%', filter: s => s.changePct > 3 && s.netYi < -2 && s.netRatio < -0.05 },

    // === D: 涨幅+净流出+成交额 ===
    { name: '涨>3%+净流出>1亿+成交>50亿', filter: s => s.changePct > 3 && s.netYi < -1 && s.amountYi > 50 },
    { name: '涨>3%+净流出>1亿+成交>100亿', filter: s => s.changePct > 3 && s.netYi < -1 && s.amountYi > 100 },
    { name: '涨+净流出>1亿+成交>50亿', filter: s => s.changePct > 0 && s.netYi < -1 && s.amountYi > 50 },
    { name: '涨+净流出>2亿+成交>50亿', filter: s => s.changePct > 0 && s.netYi < -2 && s.amountYi > 50 },

    // === E: 涨停板+净流出 ===
    { name: '涨停(>9.5%)+净流出>0', filter: s => s.changePct > 9.5 && s.netYi < 0 },
    { name: '涨停(>9.5%)+净流出>1亿', filter: s => s.changePct > 9.5 && s.netYi < -1 },
    { name: '涨停(>9.5%)+净流出>2亿', filter: s => s.changePct > 9.5 && s.netYi < -2 },

    // === F: 对照组: 涨+主力净流入 (验证反向) ===
    { name: '涨+净流入>1亿', filter: s => s.changePct > 0 && s.netYi > 1 },
    { name: '涨>3%+净流入>1亿', filter: s => s.changePct > 3 && s.netYi > 1 },
    { name: '涨>3%+净流入>2亿', filter: s => s.changePct > 3 && s.netYi > 2 },

    // === G: 跌+净流入 (对照) ===
    { name: '跌+净流入>1亿', filter: s => s.changePct < 0 && s.netYi > 1 },
    { name: '跌>3%+净流入>1亿', filter: s => s.changePct < -3 && s.netYi > 1 },

    // === H: 跌+净流出 (同向验证) ===
    { name: '跌+净流出>1亿', filter: s => s.changePct < 0 && s.netYi < -1 },
    { name: '跌>3%+净流出>1亿', filter: s => s.changePct < -3 && s.netYi < -1 },
    { name: '跌>3%+净流出>2亿', filter: s => s.changePct < -3 && s.netYi < -2 },

    // === I: 涨+净流出 最佳组合探索 ===
    { name: '涨2~5%+净流出>1亿', filter: s => s.changePct > 2 && s.changePct <= 5 && s.netYi < -1 },
    { name: '涨2~5%+净流出>2亿', filter: s => s.changePct > 2 && s.changePct <= 5 && s.netYi < -2 },
    { name: '涨2~8%+净流出>1亿', filter: s => s.changePct > 2 && s.changePct < 8 && s.netYi < -1 },
    { name: '涨2~8%+净流出>2亿', filter: s => s.changePct > 2 && s.changePct < 8 && s.netYi < -2 },
    { name: '涨3~8%+净流出>1亿', filter: s => s.changePct > 3 && s.changePct < 8 && s.netYi < -1 },
    { name: '涨3~8%+净流出>2亿', filter: s => s.changePct > 3 && s.changePct < 8 && s.netYi < -2 },
    { name: '涨3~8%+净流出>3亿', filter: s => s.changePct > 3 && s.changePct < 8 && s.netYi < -3 },
    { name: '涨4~8%+净流出>2亿', filter: s => s.changePct > 4 && s.changePct < 8 && s.netYi < -2 },
    { name: '涨4~8%+净流出>1亿', filter: s => s.changePct > 4 && s.changePct < 8 && s.netYi < -1 },
];

const results = [];
for (const cond of conditions) {
    const r = backtest(cond.name, cond.filter);
    if (r) results.push(r);
}

results.sort((a, b) => b.winRate - a.winRate || b.avgReturn - a.avgReturn);

console.log('\n' + '='.repeat(140));
console.log('深度回测结果 - "涨+主力净流出"信号精细化 (按胜率降序)');
console.log('='.repeat(140));
console.log(
    '筛选条件'.padEnd(32) +
    '样本'.padStart(5) +
    '胜率'.padStart(6) +
    '均涨'.padStart(7) +
    '均盈'.padStart(7) +
    '均亏'.padStart(7) +
    '盈亏比'.padStart(6) +
    '夏普'.padStart(7) +
    '日均涨>50%'.padStart(10) +
    '日胜率范围'.padStart(14)
);
console.log('-'.repeat(140));

for (const r of results) {
    console.log(
        r.name.padEnd(32) +
        String(r.sampleCount).padStart(5) +
        (r.winRate * 100).toFixed(1).padStart(5) + '%' +
        r.avgReturn.toFixed(2).padStart(6) + '%' +
        r.avgWin.toFixed(2).padStart(6) + '%' +
        r.avgLoss.toFixed(2).padStart(6) + '%' +
        r.profitFactor.toFixed(2).padStart(6) +
        r.sharpe.toFixed(3).padStart(7) +
        `${r.daysWinGt50}/${r.daysTotal}`.padStart(9) +
        `${(r.minDaily * 100).toFixed(0)}~${(r.maxDaily * 100).toFixed(0)}%`.padStart(13)
    );
}

// ── 最佳条件详细分析 ─────────────────────────────────
const topConditions = results.filter(r => r.winRate > 0.60 && r.sampleCount >= 50);
console.log('\n' + '='.repeat(80));
console.log(`高胜率+充足样本 (胜率>60% & 样本>=50): ${topConditions.length} 个`);
console.log('='.repeat(80));
for (const r of topConditions) {
    console.log(`\n  ${r.name}`);
    console.log(`    样本: ${r.sampleCount}, 胜率: ${(r.winRate*100).toFixed(1)}%, 均涨: ${r.avgReturn.toFixed(2)}%`);
    console.log(`    均盈: ${r.avgWin.toFixed(2)}%, 均亏: ${r.avgLoss.toFixed(2)}%, 盈亏比: ${r.profitFactor.toFixed(2)}, 夏普: ${r.sharpe.toFixed(3)}`);
    console.log(`    逐日: ${r.daysTotal}日中${r.daysWinGt50}日胜率>50% (${(r.consistentDays*100).toFixed(0)}%), 日胜率: ${(r.minDaily*100).toFixed(0)}%~${(r.maxDaily*100).toFixed(0)}%`);
}

// ── 保存 ──
const outputPath = path.join(__dirname, '..', 'outputs', 'backtest-deep-results.json');
fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalSamples: samples.length,
    results: results.map(r => ({ ...r, winRate: +r.winRate.toFixed(4), avgReturn: +r.avgReturn.toFixed(4), avgWin: +r.avgWin.toFixed(4), avgLoss: +r.avgLoss.toFixed(4), profitFactor: +r.profitFactor.toFixed(4), sharpe: +r.sharpe.toFixed(4), stdDev: +r.stdDev.toFixed(4), consistentDays: +r.consistentDays.toFixed(4) })),
}, null, 2), 'utf8');
console.log(`\n保存: ${outputPath}`);
