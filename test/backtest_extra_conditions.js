'use strict';
/**
 * 探索今日推荐之外的候选条件: 在「建议基线配置」的推荐池上, 叠加测试各类字段条件,
 * 评估能否进一步提升次日上涨胜率。跨窗口验证(全量40天 + 最近一周)。
 *
 * 基线配置: HHH+COA+EXH 开启, FOC/L/M 关闭 (此前回测推荐)
 * 候选条件: 基于原始字段及派生特征, 逐条件过滤推荐池后统计胜率/超额
 *
 * 用法: node test/backtest_extra_conditions.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const dataDir = path.join(ROOT, 'data');
const StockUtils = require(path.join(ROOT, 'stock-utils.js'));

// ── 1. 数据加载 ──────────────────────────────────────
const v3Files = fs.readdirSync(dataDir).filter(f => f.endsWith('.v3.json')).sort();
const allData = new Map();
for (const f of v3Files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
    allData.set(f, { data: raw, date: raw['交易日期'] || f.slice(0, 10) });
}
const sortedFiles = [...allData.keys()];

const context = {
    console, Map, Set, Math, Number, JSON, Date, Promise, Object, Array, String, Boolean, RegExp, parseInt, parseFloat, isFinite, isNaN,
    StockUtils,
    document: { getElementById: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, toggle() {} } }) },
    localStorage: { getItem: () => null, setItem: () => {} }, window: {},
    fetch: () => Promise.resolve({ ok: false }), AbortController: class { }, Chart: { register() {} }, requestAnimationFrame: cb => cb(),
};
vm.createContext(context);
for (const f of ['config.js', 'calc.js', 'data.js', 'leaders.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
}
for (const f of sortedFiles) {
    const entry = allData.get(f);
    context.storeDataForDate(f, entry.data, { skipInvalidate: true, tradingDate: entry.date });
}

// ── 2. 次日涨跌与大盘基线 ────────────────────────────
const nextChange = new Map();
const dailyBase = new Map();
for (let i = 0; i < sortedFiles.length - 1; i++) {
    const cur = sortedFiles[i], nxt = sortedFiles[i + 1];
    const m = new Map();
    const cd = allData.get(cur).data['股票字典'] || {}, nd = allData.get(nxt).data['股票字典'] || {};
    let n = 0, w = 0;
    for (const [sk, s] of Object.entries(cd)) {
        const c = nd[sk];
        if (c && typeof c.changePct === 'number') { m.set(sk, c.changePct); n++; if (c.changePct > 0) w++; }
    }
    nextChange.set(cur, m);
    dailyBase.set(cur, { n, w });
}

// ── 3. 基线配置 ──────────────────────────────────────
const BASE = { HIGH_HIGHER: true, FOCUS_REQUIRED: false, CLOSE_OPEN_RATIO: true, AVG5_GE_AVG10: false, CLOSE_ABOVE_AVG5: false, EXCLUDE_HOT: true };
for (const k of Object.keys(BASE)) vm.runInContext(`LEADER_COND_${k} = ${BASE[k] ? 'true' : 'false'}`, context);

/** 获取基线推荐池中每只股票的字段快照 */
function getLeadersWithFields(startFile, endFile) {
    const idx = sortedFiles.indexOf(startFile), endIdx = sortedFiles.indexOf(endFile);
    const fieldIndex = vm.runInContext('_stockFieldIndex', context);
    const out = []; // {date, stockKey, rate? , fields}
    for (let i = idx; i <= endIdx && i < sortedFiles.length - 1; i++) {
        const cur = sortedFiles[i];
        const nm = nextChange.get(cur);
        if (!nm || nm.size === 0) continue;
        context.setCurrentDateFile(cur);
        context.invalidateDateCaches();
        const leaders = (() => { try { return context.calcTodayLeaders() || []; } catch (e) { return []; } })();
        const base = dailyBase.get(cur);
        for (const L of leaders) {
            const chg = nm.get(L.stockKey);
            if (chg == null) continue;
            const fi = fieldIndex[L.stockKey]?.[cur] || {};
            const prev = fieldIndex[L.stockKey]?.[sortedFiles[i - 1]] || {};
            out.push({
                date: allData.get(cur).date,
                stockKey: L.stockKey,
                nextChg: chg,
                win: chg > 0 ? 1 : 0,
                baseRate: base.n ? base.w / base.n : 0,
                net: fi.net, change: fi.change, amount: fi.amount, volume: fi.volume,
                open: fi.open, high: fi.high, low: fi.low, close: fi.close,
                avg5: fi.avg5, avg10: fi.avg10,
                prevVolume: prev.volume, prevAmount: prev.amount, prevHigh: prev.high,
                code: fi.code
            });
        }
    }
    return out;
}

// ── 4. 候选条件 ──────────────────────────────────────
// 每个条件: {name, fn(stock) -> bool}
function makeCandidates() {
    const C = [];
    const add = (name, fn) => C.push({ name, fn });
    // 原始数值阈值
    for (const t of [0, 1, 2, 3, 5, 7]) add(`涨跌幅>${t}%`, s => s.change > t);
    for (const t of [0, 0.5, 1, 2, 3, 5]) add(`主力净流入>${t}亿`, s => s.net > t);
    for (const t of [10, 30, 50, 80, 100]) add(`成交额>${t}亿`, s => s.amount > t);
    for (const t of [20, 50, 80, 100]) add(`成交量>${t}万手`, s => s.volume > t);
    // 派生: 放量/缩量
    add('放量>1.5x', s => s.prevVolume > 0 && s.volume / s.prevVolume > 1.5);
    add('放量>2x', s => s.prevVolume > 0 && s.volume / s.prevVolume > 2);
    add('缩量<0.8x', s => s.prevVolume > 0 && s.volume / s.prevVolume < 0.8);
    add('成交额放大>1.2x', s => s.prevAmount > 0 && s.amount / s.prevAmount > 1.2);
    // 均线关系
    add('收盘>5均', s => s.avg5 != null && s.close > s.avg5);
    add('收盘>10均', s => s.avg10 != null && s.close > s.avg10);
    add('5均>10均', s => s.avg5 != null && s.avg10 != null && s.avg5 > s.avg10);
    add('收盘>5均且>10均', s => s.avg5 != null && s.avg10 != null && s.close > s.avg5 && s.close > s.avg10);
    // 价格形态
    add('收阳线(close>open)', s => s.close > s.open);
    add('收盘距最高<3%', s => s.close > 0 && s.high > 0 && (s.high - s.close) / s.close < 0.03);
    add('收盘距最高<1.5%', s => s.close > 0 && s.high > 0 && (s.high - s.close) / s.close < 0.015);
    add('高开>1%', s => s.open > 0 && s.change != null && s.prevHigh != null
        && s.prevHigh > 0 && s.open / s.prevHigh - 1 > 0.01);
    add('最高突破前日', s => s.prevHigh != null && s.high > s.prevHigh);
    // 主力强度比率
    add('净额/成交额>5%', s => s.amount > 0 && s.net / s.amount > 0.05);
    add('净额/成交额>10%', s => s.amount > 0 && s.net / s.amount > 0.10);
    // 板块: 主板 vs 创业/科创
    add('主板(60/00开头)', s => /^(60|00)/.test(String(s.code || '')));
    add('创业板/科创板(30/68)', s => /^(30|68)/.test(String(s.code || '')));
    return C;
}

// ── 5. 评估 ──────────────────────────────────────────
function evaluate(records) {
    const total = records.length;
    if (!total) return { n: 0, rate: 0, excess: 0 };
    const win = records.reduce((a, r) => a + r.win, 0);
    // 加权超额(相对当日大盘, 按样本加权)
    let es = 0, en = 0;
    for (const r of records) { es += (r.win / 1 - r.baseRate); en += 1; }
    // 更精确: 用分组加权
    const byDate = new Map();
    for (const r of records) {
        if (!byDate.has(r.date)) byDate.set(r.date, { n: 0, w: 0, base: 0 });
        const d = byDate.get(r.date); d.n++; d.w += r.win; d.base = r.baseRate;
    }
    let es2 = 0, en2 = 0;
    for (const d of byDate.values()) { if (d.n >= 3) { es2 += (d.w / d.n - d.base) * d.n; en2 += d.n; } }
    return { n: total, rate: win / total, excess: en2 ? es2 / en2 : 0 };
}

function runWindow(startFile, endFile, label) {
    const records = getLeadersWithFields(startFile, endFile);
    const base = evaluate(records);
    console.log(`\n===== ${label} (${allData.get(startFile).date} ~ ${allData.get(endFile).date}) =====`);
    console.log(`基线推荐池: ${base.n} 样本, 胜率 ${(base.rate * 100).toFixed(1)}%, 超额 ${(base.excess * 100).toFixed(1)}pp`);
    console.log('候选条件(按胜率排序):');
    console.log('  #  胜率    超额    样本  条件');
    const rows = [];
    for (const c of makeCandidates()) {
        const filtered = records.filter(c.fn);
        const r = evaluate(filtered);
        if (r.n >= 15) rows.push({ name: c.name, ...r });
    }
    rows.sort((a, b) => b.rate - a.rate || b.n - a.n);
    rows.forEach((r, i) => {
        if (i >= 18) return;
        const dRate = (r.rate - base.rate) * 100;
        const dEx = (r.excess - base.excess) * 100;
        console.log(`  ${String(i + 1).padStart(2)}  ${(r.rate * 100).toFixed(1).padStart(5)}% (Δ${dRate >= 0 ? '+' : ''}${dRate.toFixed(1).padStart(5)}pp)  ${(r.excess * 100).toFixed(1).padStart(5)}% (Δ${dEx >= 0 ? '+' : ''}${dEx.toFixed(1).padStart(5)}pp)  ${String(r.n).padStart(4)}  ${r.name}`);
    });
    return { records, base, rows };
}

// ── 6. 窗口 ──────────────────────────────────────────
const hasAvgIdx = sortedFiles.findIndex(f => {
    const dict = allData.get(f).data['股票字典'] || {};
    return Object.values(dict)[0] && Object.values(dict)[0].avg5 != null;
});
const allStart = sortedFiles[Math.max(1, hasAvgIdx)];
const allEnd = sortedFiles[sortedFiles.length - 2];
const weekStart = sortedFiles[sortedFiles.length - 5];
const weekEnd = sortedFiles[sortedFiles.length - 2];

const resAll = runWindow(allStart, allEnd, '全量窗口');
const resWeek = runWindow(weekStart, weekEnd, '最近一周');

// ── 7. 跨窗口稳定性对比 ──────────────────────────────
console.log('\n===== 跨窗口一致提升(两窗口胜率均高于各自基线) =====');
const cands = makeCandidates();
const stable = [];
for (const c of cands) {
    const fa = resAll.records.filter(c.fn);
    const fw = resWeek.records.filter(c.fn);
    const ra = evaluate(fa), rw = evaluate(fw);
    if (ra.n >= 15 && rw.n >= 10 && ra.rate > resAll.base.rate && rw.rate > resWeek.base.rate) {
        stable.push({ name: c.name, all: ra, week: rw });
    }
}
stable.sort((a, b) => (b.all.rate - resAll.base.rate) - (a.all.rate - resAll.base.rate) || b.all.n - a.all.n);
if (stable.length === 0) {
    console.log('无候选条件在两窗口同时稳定跑赢基线推荐池。');
} else {
    console.log('  条件 | 全量:胜率/样本 | 最近周:胜率/样本');
    for (const s of stable) {
        console.log(`  ${s.name.padEnd(22)} | ${(s.all.rate * 100).toFixed(1)}%/${s.all.n} | ${(s.week.rate * 100).toFixed(1)}%/${s.week.n}`);
    }
}
