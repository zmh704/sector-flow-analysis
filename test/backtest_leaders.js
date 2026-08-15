'use strict';
/**
 * 回测「今日推荐」条件组合 v2 — 加入基线对比与时间切分样本外验证
 *
 * 复用项目真实算法 (config/calc/data/leaders via vm)
 * 胜率口径:
 *   1) 组合总体胜率: 推荐股票次日 changePct>0 比例
 *   2) 超额胜率: 每天「组合推荐上涨率 - 当天全池上涨率」, 再按样本加权平均 (消除大盘影响)
 * 防过拟合:
 *   - 时间切分: 前70%日期找最优组合 -> 后30%验证
 *   - 同时给出全量回测作为参考
 *
 * 用法: node test/backtest_leaders.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const dataDir = path.join(ROOT, 'data');
const StockUtils = require(path.join(ROOT, 'stock-utils.js'));

// ── 1. 读取数据 ──────────────────────────────────────
const v3Files = fs.readdirSync(dataDir).filter(f => f.endsWith('.v3.json')).sort();
const allData = new Map();
for (const f of v3Files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
    allData.set(f, { data: raw, date: raw['交易日期'] || f.slice(0, 10) });
}
const sortedFiles = [...allData.keys()];
console.log(`已加载 ${sortedFiles.length} 个交易日: ${allData.get(sortedFiles[0]).date} ~ ${allData.get(sortedFiles.at(-1)).date}`);

// ── 2. vm 上下文 ─────────────────────────────────────
const context = {
    console,
    Map, Set, Math, Number, JSON, Date, Promise, Object, Array, String, Boolean, RegExp, parseInt, parseFloat, isFinite, isNaN,
    StockUtils,
    document: { getElementById: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, toggle() {} } }) },
    localStorage: { getItem: () => null, setItem: () => {} },
    window: {},
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve([]) }),
    AbortController: class { },
    Chart: { register() {} },
    requestAnimationFrame: cb => cb(),
};
vm.createContext(context);
for (const f of ['config.js', 'calc.js', 'data.js', 'leaders.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    try { vm.runInContext(src, context, { filename: f }); }
    catch (e) { console.error(`加载 ${f} 失败:`, e.message); process.exit(1); }
}
console.log('项目源码加载成功');

for (const f of sortedFiles) {
    const entry = allData.get(f);
    try { context.storeDataForDate(f, entry.data, { skipInvalidate: true, tradingDate: entry.date }); }
    catch (e) { console.error(`注入 ${f} 失败:`, e.message); process.exit(1); }
}
const fileList = vm.runInContext('dateFileList', context);
console.log(`数据注入完成, ${fileList.length} 个交易日, 索引股票 ${Object.keys(vm.runInContext('_stockFieldIndex', context)).length} 只\n`);

// ── 3. 次日涨跌与每日基线 ────────────────────────────
const nextChange = new Map();   // date -> Map<stockKey, changePct>
const dailyBase = new Map();    // date -> { n, win } 全池次日上涨率
for (let i = 0; i < sortedFiles.length - 1; i++) {
    const cur = sortedFiles[i];
    const nxt = sortedFiles[i + 1];
    const map = new Map();
    const curDict = allData.get(cur).data['股票字典'] || {};
    const nxtDict = allData.get(nxt).data['股票字典'] || {};
    let n = 0, win = 0;
    for (const [sk, s] of Object.entries(curDict)) {
        const c = nxtDict[sk];
        if (c && typeof c.changePct === 'number') {
            map.set(sk, c.changePct);
            n++;
            if (c.changePct > 0) win++;
        }
    }
    nextChange.set(cur, map);
    dailyBase.set(cur, { n, win });
}

function setSwitch(name, value) {
    vm.runInContext(`LEADER_COND_${name} = ${value}`, context);
}
function setSwitches(switches) {
    for (const key of Object.keys(switches)) setSwitch(key, switches[key] ? 'true' : 'false');
}

/** 回测一个开关配置, 返回逐日结果 */
function backtestDetail(switches, startFile, endFile) {
    setSwitches(switches);
    const idx = sortedFiles.indexOf(startFile);
    const endIdx = sortedFiles.indexOf(endFile);
    const dayResults = [];
    for (let i = idx; i <= endIdx && i < sortedFiles.length - 1; i++) {
        const cur = sortedFiles[i];
        const nxtMap = nextChange.get(cur);
        if (!nxtMap || nxtMap.size === 0) continue;
        context.setCurrentDateFile(cur);
        context.invalidateDateCaches();
        let leaders;
        try { leaders = context.calcTodayLeaders() || []; }
        catch (e) { continue; }
        let reco = 0, win = 0;
        for (const L of leaders) {
            const chg = nxtMap.get(L.stockKey);
            if (chg != null) { reco++; if (chg > 0) win++; }
        }
        dayResults.push({
            date: allData.get(cur).date,
            reco, win,
            rate: reco ? win / reco : 0,
            base: (() => { const b = dailyBase.get(cur); return b.n ? b.win / b.n : 0; })()
        });
    }
    // 汇总
    let totalReco = 0, totalWin = 0, wSum = 0, wN = 0;
    let excessSum = 0, excessN = 0;
    for (const d of dayResults) {
        totalReco += d.reco;
        totalWin += d.win;
        if (d.reco >= 3) { excessSum += (d.rate - d.base) * d.reco; excessN += d.reco; }
    }
    return {
        dayResults,
        reco: totalReco, win: totalWin,
        rate: totalReco ? totalWin / totalReco : 0,
        avgPerDay: dayResults.length ? totalReco / dayResults.length : 0,
        excess: excessN ? excessSum / excessN : 0,   // 加权超额胜率(相对当天全池)
        days: dayResults.length
    };
}

function formatSw(sw) {
    const flag = v => v ? '开' : '关';
    return `高>前高:${flag(sw.HIGH_HIGHER)} 关联板块:${flag(sw.FOCUS_REQUIRED)} 收开比:${flag(sw.CLOSE_OPEN_RATIO)} 5>10均:${flag(sw.AVG5_GE_AVG10)} 收>5均:${flag(sw.CLOSE_ABOVE_AVG5)} 排除热门:${flag(sw.EXCLUDE_HOT)}`;
}

// ── 4. 窗口 ──────────────────────────────────────────
// 用法: node test/backtest_leaders.js [week|all]
//   week  = 最近一周(最近5个交易日, 含次日数据的前4天)
//   all   = 全量(默认, 首个含均线日期起)
const WINDOW_ARG = process.argv[2];
let startFile, endFile;
if (WINDOW_ARG === 'week') {
    startFile = sortedFiles[sortedFiles.length - 5];
    endFile = sortedFiles[sortedFiles.length - 2];
} else {
    const hasAvgIdx = sortedFiles.findIndex(f => {
        const dict = allData.get(f).data['股票字典'] || {};
        return Object.values(dict)[0] && Object.values(dict)[0].avg5 != null;
    });
    startFile = sortedFiles[Math.max(1, hasAvgIdx)];
    endFile = sortedFiles[sortedFiles.length - 2];
}
console.log(`回测窗口: ${allData.get(startFile).date} ~ ${allData.get(endFile).date} ${WINDOW_ARG === 'week' ? '(最近一周)' : '(含均线字段, 有次日数据)'}`);
console.log(`窗口内 ${sortedFiles.indexOf(endFile) - sortedFiles.indexOf(startFile) + 1} 个特征日\n`);

const switchKeys = ['HIGH_HIGHER', 'FOCUS_REQUIRED', 'CLOSE_OPEN_RATIO', 'AVG5_GE_AVG10', 'CLOSE_ABOVE_AVG5', 'EXCLUDE_HOT'];
const defaults = { HIGH_HIGHER: true, FOCUS_REQUIRED: true, CLOSE_OPEN_RATIO: true, AVG5_GE_AVG10: true, CLOSE_ABOVE_AVG5: true, EXCLUDE_HOT: true };

// ── 5. 全量 64 组合回测 ──────────────────────────────
console.log('【全量回测: 64 种开关组合, 按「总体胜率」排序 TOP15】');
console.log('  #  总体胜率  超额(vs大盘) 推荐数 日均  HHH FOC COA A5A CAB EXH');
const allCombos = [];
for (let mask = 0; mask < (1 << switchKeys.length); mask++) {
    const sw = {};
    for (let k = 0; k < switchKeys.length; k++) sw[switchKeys[k]] = ((mask >> k) & 1) === 1;
    const r = backtestDetail(sw, startFile, endFile);
    allCombos.push({ sw, ...r });
}
allCombos.sort((a, b) => b.rate - a.rate || b.reco - a.reco);
allCombos.forEach((r, i) => {
    if (i >= 15) return;
    const sw = r.sw;
    const flag = v => v ? 'Y' : 'N';
    console.log(
        `  ${String(i + 1).padStart(2)}  ${(r.rate * 100).toFixed(1).padStart(5)}%  ${(r.excess * 100).toFixed(1).padStart(6)}%  ${String(r.reco).padStart(5)}  ${r.avgPerDay.toFixed(1).padStart(5)}  ` +
        `${flag(sw.HIGH_HIGHER)}  ${flag(sw.FOCUS_REQUIRED)}  ${flag(sw.CLOSE_OPEN_RATIO)}  ${flag(sw.AVG5_GE_AVG10)}  ${flag(sw.CLOSE_ABOVE_AVG5)}  ${flag(sw.EXCLUDE_HOT)}`
    );
});
console.log();

// ── 6. 默认配置详细 ──────────────────────────────────
const rDefault = allCombos.find(r => switchKeys.every(k => r.sw[k] === defaults[k]));
console.log('【当前默认配置】');
console.log(`  总体胜率 ${(rDefault.rate * 100).toFixed(1)}%  超额 ${(rDefault.excess * 100).toFixed(1)}pp  推荐${rDefault.reco}次 日均${rDefault.avgPerDay.toFixed(1)}只`);
console.log('  逐日: 日期 | 推荐 | 次日上涨率 vs 当日大盘');
for (const d of rDefault.dayResults) {
    console.log(`    ${d.date} | ${String(d.reco).padStart(3)}只 | ${(d.rate * 100).toFixed(0).padStart(3)}% vs 大盘${(d.base * 100).toFixed(0)}%`);
}
console.log();

// ── 7. 按超额胜率排序 (消除大盘影响, 更有意义) ────────
console.log('【按「超额胜率」(相对当日大盘) 排序 TOP15, 样本>=30】');
const byExcess = allCombos.filter(r => r.reco >= 30).sort((a, b) => b.excess - a.excess || b.rate - a.rate);
byExcess.forEach((r, i) => {
    if (i >= 15) return;
    const sw = r.sw;
    const flag = v => v ? 'Y' : 'N';
    console.log(
        `  ${String(i + 1).padStart(2)}  超额${(r.excess * 100).toFixed(1).padStart(5)}%  总体${(r.rate * 100).toFixed(1)}%  推荐${String(r.reco).padStart(4)}  ` +
        `${flag(sw.HIGH_HIGHER)}  ${flag(sw.FOCUS_REQUIRED)}  ${flag(sw.CLOSE_OPEN_RATIO)}  ${flag(sw.AVG5_GE_AVG10)}  ${flag(sw.CLOSE_ABOVE_AVG5)}  ${flag(sw.EXCLUDE_HOT)}`
    );
});
console.log();

// ── 8. 样本外验证: 前70%找最优, 后30%验证 ──────────
const allDays = allCombos[0].dayResults.length;
const cut = Math.floor(allDays * 0.7);
const trainEnd = sortedFiles[sortedFiles.indexOf(startFile) + cut - 1];
console.log(`【样本外验证】训练段: ${allData.get(startFile).date} ~ ${allData.get(trainEnd).date} (${cut}天)  测试段: 剩余`);
console.log(`  训练段选「超额胜率最高且样本>=15」的组合, 在测试段看表现:`);
let trainBest = null;
for (const r of allCombos) {
    const tr = backtestDetail(r.sw, startFile, trainEnd);
    if (tr.reco >= 15) {
        const score = tr.excess;
        if (!trainBest || score > trainBest.score) trainBest = { sw: r.sw, score, tr };
    }
}
if (trainBest) {
    const te = backtestDetail(trainBest.sw, sortedFiles[sortedFiles.indexOf(trainEnd) + 1], endFile);
    console.log(`  训练段最佳: ${formatSw(trainBest.sw)}`);
    console.log(`    训练段: 总体胜率${(trainBest.tr.rate * 100).toFixed(1)}% 超额${(trainBest.score * 100).toFixed(1)}pp 推荐${trainBest.tr.reco}次`);
    console.log(`    测试段: 总体胜率${(te.rate * 100).toFixed(1)}% 超额${(te.excess * 100).toFixed(1)}pp 推荐${te.reco}次`);
} else {
    console.log('  训练段无满足样本>=15 的组合');
}
console.log();

// ── 9. 默认配置样本外 ────────────────────────────────
{
    const tr = backtestDetail(defaults, startFile, trainEnd);
    const te = backtestDetail(defaults, sortedFiles[sortedFiles.indexOf(trainEnd) + 1], endFile);
    console.log('【默认配置样本外对照】');
    console.log(`  训练段: 总体胜率${(tr.rate * 100).toFixed(1)}% 超额${(tr.excess * 100).toFixed(1)}pp 推荐${tr.reco}次`);
    console.log(`  测试段: 总体胜率${(te.rate * 100).toFixed(1)}% 超额${(te.excess * 100).toFixed(1)}pp 推荐${te.reco}次`);
}
