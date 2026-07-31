'use strict';
/**
 * 回测引擎：基于板块资金流向数据，寻找次日涨跌幅>0的有效筛选条件
 *
 * 数据结构：每日 v3 JSON 含 股票字典 (~200只TOP成交额股票)
 * 字段: netYi(主力净额亿), changePct(涨跌幅%), amountYi(成交额亿), volumeWanShou(成交量万手)
 *
 * 目标变量: 次日涨跌幅 = T+1 的 changePct
 * 信号变量: T 日的 netYi, changePct, amountYi, volumeWanShou 及衍生比率
 */

const fs = require('fs');
const path = require('path');

// ── 1. 加载全部交易日数据 ──────────────────────────────
const dataDir = path.join(__dirname, '..', 'data');
const v3Files = fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.v3.json'))
    .sort();

const days = []; // [{date, stocks: Map<stockKey, stockData>}]

for (const f of v3Files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
    const dict = raw['股票字典'];
    if (!dict) continue;
    const stocks = new Map();
    for (const [key, s] of Object.entries(dict)) {
        const stock = {
            stockKey: key,
            name: s.name,
            netYi: Number(s.netYi) || 0,
            changePct: Number(s.changePct) || 0,
            amountYi: Number(s.amountYi) || 0,
            volumeWanShou: Number(s.volumeWanShou) || 0,
            close: s.close != null ? Number(s.close) : null,
            avg5: s.avg5 != null ? Number(s.avg5) : null,
        };
        stock.netRatio = stock.amountYi > 0 ? stock.netYi / stock.amountYi : 0;
        stocks.set(key, stock);
    }
    days.push({ date: raw['交易日期'], stocks });
}

console.log(`加载 ${days.length} 个交易日，日期范围 ${days[0].date} ~ ${days[days.length - 1].date}`);

// ── 2. 构建配对样本 ────────────────────────────────────
// 每个样本: {date, stockKey, ...dayTSignals, nextChangePct}
const samples = [];

for (let i = 0; i < days.length - 1; i++) {
    const dayT = days[i];
    const dayT1 = days[i + 1];
    for (const [key, sT] of dayT.stocks) {
        const sT1 = dayT1.stocks.get(key);
        if (!sT1) continue;
        samples.push({
            date: dayT.date,
            nextDate: dayT1.date,
            stockKey: key,
            name: sT.name,
            netYi: sT.netYi,
            changePct: sT.changePct,
            amountYi: sT.amountYi,
            volumeWanShou: sT.volumeWanShou,
            netRatio: sT.netRatio,
            close: sT.close,
            avg5: sT.avg5,
            nextChangePct: sT1.changePct, // 次日涨跌幅
        });
    }
}

console.log(`配对样本总数: ${samples.length}`);

// 基线统计
const allReturns = samples.map(s => s.nextChangePct);
const baselineWinRate = allReturns.filter(r => r > 0).length / allReturns.length;
const baselineAvg = allReturns.reduce((a, b) => a + b, 0) / allReturns.length;
const sortedR = [...allReturns].sort((a, b) => a - b);
const baselineMedian = sortedR[Math.floor(sortedR.length / 2)];
console.log(`\n=== 基线 (无条件) ===`);
console.log(`样本数: ${allReturns.length}, 次日涨>0占比: ${(baselineWinRate * 100).toFixed(1)}%, 平均涨幅: ${baselineAvg.toFixed(3)}%, 中位数: ${baselineMedian.toFixed(3)}%`);

// ── 3. 定义筛选条件 ────────────────────────────────────
// 每个条件: {name, filter: (sample) => boolean}
const conditions = [
    // --- 单条件: 主力净额 ---
    { name: '主力净额>0', filter: s => s.netYi > 0 },
    { name: '主力净额>0.5亿', filter: s => s.netYi > 0.5 },
    { name: '主力净额>1亿', filter: s => s.netYi > 1 },
    { name: '主力净额>2亿', filter: s => s.netYi > 2 },
    { name: '主力净额>3亿', filter: s => s.netYi > 3 },
    { name: '主力净额>5亿', filter: s => s.netYi > 5 },
    { name: '主力净额<-1亿', filter: s => s.netYi < -1 },
    { name: '主力净额<-2亿', filter: s => s.netYi < -2 },
    { name: '主力净额<-5亿', filter: s => s.netYi < -5 },

    // --- 单条件: 当日涨跌幅 ---
    { name: '当日涨幅>0', filter: s => s.changePct > 0 },
    { name: '当日涨幅>2%', filter: s => s.changePct > 2 },
    { name: '当日涨幅>3%', filter: s => s.changePct > 3 },
    { name: '当日涨幅>5%', filter: s => s.changePct > 5 },
    { name: '当日涨幅>5%且<10%', filter: s => s.changePct > 5 && s.changePct < 10 },
    { name: '当日涨幅>9.5%', filter: s => s.changePct > 9.5 },
    { name: '当日跌幅>-2%', filter: s => s.changePct < -2 },
    { name: '当日跌幅>-5%', filter: s => s.changePct < -5 },

    // --- 单条件: 净额占比 ---
    { name: '净额占比>3%', filter: s => s.netRatio > 0.03 },
    { name: '净额占比>5%', filter: s => s.netRatio > 0.05 },
    { name: '净额占比>8%', filter: s => s.netRatio > 0.08 },
    { name: '净额占比>10%', filter: s => s.netRatio > 0.10 },
    { name: '净额占比>15%', filter: s => s.netRatio > 0.15 },

    // --- 组合: 量价齐升 ---
    { name: '涨+主力净流入(>0)', filter: s => s.changePct > 0 && s.netYi > 0 },
    { name: '涨+主力净流入>1亿', filter: s => s.changePct > 0 && s.netYi > 1 },
    { name: '涨+主力净流入>2亿', filter: s => s.changePct > 0 && s.netYi > 2 },
    { name: '涨>2%+净流入>1亿', filter: s => s.changePct > 2 && s.netYi > 1 },
    { name: '涨>2%+净流入>2亿', filter: s => s.changePct > 2 && s.netYi > 2 },
    { name: '涨>3%+净流入>1亿', filter: s => s.changePct > 3 && s.netYi > 1 },
    { name: '涨>3%+净流入>2亿', filter: s => s.changePct > 3 && s.netYi > 2 },
    { name: '涨>3%+净额占比>5%', filter: s => s.changePct > 3 && s.netRatio > 0.05 },
    { name: '涨>5%+净流入>1亿', filter: s => s.changePct > 5 && s.netYi > 1 },
    { name: '涨>5%+净额占比>5%', filter: s => s.changePct > 5 && s.netRatio > 0.05 },

    // --- 组合: 缩量回调+主力净流入 ---
    { name: '跌+主力净流入>0', filter: s => s.changePct < 0 && s.netYi > 0 },
    { name: '跌+主力净流入>1亿', filter: s => s.changePct < 0 && s.netYi > 1 },
    { name: '跌+主力净流入>2亿', filter: s => s.changePct < 0 && s.netYi > 2 },
    { name: '小跌(-2~0)+净流入>1亿', filter: s => s.changePct < 0 && s.changePct > -2 && s.netYi > 1 },
    { name: '小跌(-3~0)+净流入>2亿', filter: s => s.changePct < 0 && s.changePct > -3 && s.netYi > 2 },
    { name: '跌+净额占比>5%', filter: s => s.changePct < 0 && s.netRatio > 0.05 },
    { name: '跌+净额占比>8%', filter: s => s.changePct < 0 && s.netRatio > 0.08 },

    // --- 组合: 横盘+主力净流入 ---
    { name: '横盘(-2~2)+净流入>1亿', filter: s => Math.abs(s.changePct) <= 2 && s.netYi > 1 },
    { name: '横盘(-2~2)+净流入>2亿', filter: s => Math.abs(s.changePct) <= 2 && s.netYi > 2 },
    { name: '横盘(-2~2)+净额占比>5%', filter: s => Math.abs(s.changePct) <= 2 && s.netRatio > 0.05 },
    { name: '横盘(-1~1)+净流入>2亿', filter: s => Math.abs(s.changePct) <= 1 && s.netYi > 2 },

    // --- 组合: 强势涨停/大涨+主力净流入 ---
    { name: '涨停(>9.5%)+净流入>0', filter: s => s.changePct > 9.5 && s.netYi > 0 },
    { name: '涨停(>9.5%)+净流入>1亿', filter: s => s.changePct > 9.5 && s.netYi > 1 },

    // --- 组合: 大成交额+主力净流入 ---
    { name: '成交额>50亿+净流入>1亿', filter: s => s.amountYi > 50 && s.netYi > 1 },
    { name: '成交额>50亿+净流入>2亿', filter: s => s.amountYi > 50 && s.netYi > 2 },
    { name: '成交额>100亿+净流入>1亿', filter: s => s.amountYi > 100 && s.netYi > 1 },
    { name: '成交额>100亿+净额占比>5%', filter: s => s.amountYi > 100 && s.netRatio > 0.05 },

    // --- 组合: 净额占比高+涨幅适中 ---
    { name: '净额占比>5%+涨0~5%', filter: s => s.netRatio > 0.05 && s.changePct > 0 && s.changePct < 5 },
    { name: '净额占比>8%+涨0~5%', filter: s => s.netRatio > 0.08 && s.changePct > 0 && s.changePct < 5 },
    { name: '净额占比>10%+涨0~3%', filter: s => s.netRatio > 0.10 && s.changePct > 0 && s.changePct < 3 },

    // --- 组合: 强势+高占比 ---
    { name: '涨>2%+净额占比>8%', filter: s => s.changePct > 2 && s.netRatio > 0.08 },
    { name: '涨>3%+净额占比>10%', filter: s => s.changePct > 3 && s.netRatio > 0.10 },
    { name: '涨>2%+净流入>2亿+占比>5%', filter: s => s.changePct > 2 && s.netYi > 2 && s.netRatio > 0.05 },
    { name: '涨>3%+净流入>1亿+占比>5%', filter: s => s.changePct > 3 && s.netYi > 1 && s.netRatio > 0.05 },

    // --- 反向: 主力净流出 ---
    { name: '主力净流出>1亿', filter: s => s.netYi < -1 },
    { name: '主力净流出>2亿', filter: s => s.netYi < -2 },
    { name: '涨+主力净流出>1亿', filter: s => s.changePct > 0 && s.netYi < -1 },
    { name: '涨>3%+主力净流出>1亿', filter: s => s.changePct > 3 && s.netYi < -1 },
];

// ── 4. 执行回测 ────────────────────────────────────────
function backtest(condition) {
    const matched = samples.filter(condition.filter);
    if (matched.length === 0) return null;

    const returns = matched.map(s => s.nextChangePct);
    const wins = returns.filter(r => r > 0);
    const losses = returns.filter(r => r <= 0);
    const winRate = wins.length / returns.length;
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const median = sortedReturns[Math.floor(sortedReturns.length / 2)];
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : wins.length > 0 ? Infinity : 0;
    const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length);
    const sharpe = stdDev > 0 ? avgReturn / stdDev : 0;

    return {
        name: condition.name,
        sampleCount: matched.length,
        winRate,
        avgReturn,
        median,
        avgWin,
        avgLoss,
        profitFactor,
        stdDev,
        sharpe,
        maxReturn: Math.max(...returns),
        minReturn: Math.min(...returns),
    };
}

const results = [];
for (const cond of conditions) {
    const r = backtest(cond);
    if (r) results.push(r);
}

// ── 5. 输出结果 ────────────────────────────────────────
// 按胜率降序排列
results.sort((a, b) => b.winRate - a.winRate || b.avgReturn - a.avgReturn);

console.log('\n' + '='.repeat(120));
console.log('回测结果 (按次日涨>0胜率降序)');
console.log('='.repeat(120));
console.log(
    '筛选条件'.padEnd(28) +
    '样本数'.padStart(6) +
    '胜率'.padStart(7) +
    '均涨'.padStart(8) +
    '中位'.padStart(8) +
    '均盈'.padStart(8) +
    '均亏'.padStart(8) +
    '盈亏比'.padStart(7) +
    '夏普'.padStart(7) +
    '最大'.padStart(8) +
    '最小'.padStart(8)
);
console.log('-'.repeat(120));

for (const r of results) {
    console.log(
        r.name.padEnd(28) +
        String(r.sampleCount).padStart(6) +
        (r.winRate * 100).toFixed(1).padStart(6) + '%' +
        r.avgReturn.toFixed(2).padStart(7) + '%' +
        r.median.toFixed(2).padStart(7) + '%' +
        r.avgWin.toFixed(2).padStart(7) + '%' +
        r.avgLoss.toFixed(2).padStart(7) + '%' +
        r.profitFactor.toFixed(2).padStart(7) +
        r.sharpe.toFixed(3).padStart(7) +
        r.maxReturn.toFixed(2).padStart(7) + '%' +
        r.minReturn.toFixed(2).padStart(7) + '%'
    );
}

// ── 6. 高胜率条件 (胜率>55% & 样本>=30) ───────────────
const highWin = results.filter(r => r.winRate > 0.55 && r.sampleCount >= 30);
console.log('\n' + '='.repeat(80));
console.log(`高胜率条件 (胜率>55% & 样本>=30): ${highWin.length} 个`);
console.log('='.repeat(80));
for (const r of highWin) {
    console.log(`  ${r.name}: 胜率${(r.winRate*100).toFixed(1)}% 样本${r.sampleCount} 均涨${r.avgReturn.toFixed(2)}% 盈亏比${r.profitFactor.toFixed(2)}`);
}

// ── 7. 逐日稳定性分析 (针对高胜率条件) ──────────────────
console.log('\n' + '='.repeat(80));
console.log('逐日胜率稳定性 (高胜率条件)');
console.log('='.repeat(80));

for (const cond of conditions) {
    const r = backtest(cond);
    if (!r || r.winRate <= 0.55 || r.sampleCount < 30) continue;

    // 逐日统计
    const dailyStats = [];
    for (let i = 0; i < days.length - 1; i++) {
        const dayT = days[i];
        const dayT1 = days[i + 1];
        let matched = 0, wins = 0, totalReturn = 0;
        for (const [key, sT] of dayT.stocks) {
            const sT1 = dayT1.stocks.get(key);
            if (!sT1) continue;
            if (!cond.filter({ ...sT, netRatio: sT.netRatio })) continue;
            matched++;
            totalReturn += sT1.changePct;
            if (sT1.changePct > 0) wins++;
        }
        if (matched > 0) {
            dailyStats.push({
                date: dayT.date,
                matched,
                winRate: wins / matched,
                avgReturn: totalReturn / matched,
            });
        }
    }

    const daysWin = dailyStats.filter(d => d.winRate > 0.5).length;
    const daysTotal = dailyStats.length;
    const minDailyWinRate = Math.min(...dailyStats.map(d => d.winRate));
    const maxDailyWinRate = Math.max(...dailyStats.map(d => d.winRate));
    const consistentDays = dailyStats.filter(d => d.winRate > 0.5).length;

    console.log(`\n  ${cond.name} (总胜率${(r.winRate*100).toFixed(1)}%, 样本${r.sampleCount})`);
    console.log(`    逐日统计: ${daysTotal}个交易日, 其中${daysWin}日胜率>50% (${(daysWin/daysTotal*100).toFixed(0)}%)`);
    console.log(`    日胜率范围: ${(minDailyWinRate*100).toFixed(0)}% ~ ${(maxDailyWinRate*100).toFixed(0)}%`);
}

// ── 8. 保存完整结果到JSON ─────────────────────────────
const outputDir = path.join(__dirname, '..', 'outputs');
const outputPath = path.join(outputDir, 'backtest-results.json');
const outputData = {
    generatedAt: new Date().toISOString(),
    dataRange: `${days[0].date} ~ ${days[days.length-1].date}`,
    totalDays: days.length,
    totalSamples: samples.length,
    baseline: {
        winRate: baselineWinRate,
        avgReturn: baselineAvg,
        median: baselineMedian,
    },
    results: results.map(r => ({
        ...r,
        winRate: +(r.winRate.toFixed(4)),
        avgReturn: +r.avgReturn.toFixed(4),
        median: +r.median.toFixed(4),
        avgWin: +r.avgWin.toFixed(4),
        avgLoss: +r.avgLoss.toFixed(4),
        profitFactor: +r.profitFactor.toFixed(4),
        stdDev: +r.stdDev.toFixed(4),
        sharpe: +r.sharpe.toFixed(4),
        maxReturn: +r.maxReturn.toFixed(4),
        minReturn: +r.minReturn.toFixed(4),
    })),
};
fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
console.log(`\n完整结果已保存: ${outputPath}`);
