// ===== 今日推荐 & 关注板块渲染 =====

// ============================
// 今日推荐股票筛选条件（各条件独立方法，可注释/取消注释来开关）
// ============================

/** 条件A：股票连续流入天数 >= LEADER_STOCK_MIN_DAYS */
function leaderCondMinDays(stockDays) {
    return stockDays >= LEADER_STOCK_MIN_DAYS;
}

/** 条件B：至少有一个所属板块在重点关注（关注板块）中（直接复用 getFocusSectors 的板块集合） */

/** 条件C：当日成交额 > 前一日成交额 * 0.9（防止缩量过快） */
function leaderCondTurnoverNotTooLow(stockName) {
    return isStockTurnoverNotTooLow(stockName);
}

/** 条件D：当日成交额 < 前一日成交额 * 1.5（防止放量过快） */
function leaderCondAmountNotTooHigh(stockName) {
    return isStockAmountNotTooHigh(stockName);
}

/** 条件E：所有所属板块当日成交额均 < 板块前一日成交额 × RATIO_TURNOVER_HIGH */
function leaderCondAllSectorsDecreased(stockName, sectors) {
    const activeData = getActiveData();
    const prevDayData = getPrevDayData();
    // 按类型提前构建板块 Map，使 isSectorTurnoverDecreased O(1) 查找
    const maps = {};
    for (const key of ['行业板块资金流向', '概念板块资金流向']) {
        maps[key] = {
            curr: buildSectorMap(activeData[key] || []),
            prev: buildSectorMap(prevDayData?.[key] || [])
        };
    }
    return sectors.every(s => {
        const st = s.type === '行业' ? '行业板块资金流向' : '概念板块资金流向';
        return isSectorTurnoverDecreased(s.name, maps[st].curr, maps[st].prev);
    });
}

/** 条件F：所属板块中净流入天数 >= 股票天数的板块，成交额需 > 昨日成交额 × RATIO_TURNOVER_LOW */
function leaderCondHighDaysSectorsAbove090(stockName, stockDays, sectors) {
    const activeData = getActiveData();
    const prevDayData = getPrevDayData();
    const maps = {};
    for (const key of ['行业板块资金流向', '概念板块资金流向']) {
        maps[key] = {
            curr: buildSectorMap(activeData[key] || []),
            prev: buildSectorMap(prevDayData?.[key] || [])
        };
    }
    return sectors.every(s => {
        if (s.days < stockDays) return true;
        const st = s.type === '行业' ? '行业板块资金流向' : '概念板块资金流向';
        return isSectorAbove090(s.name, maps[st].curr, maps[st].prev);
    });
}

/** 条件G：股票连续流入天数在板块最大天数范围内（容差LEADER_GAP） */
function leaderCondDaysWithinGap(stockDays, sectors) {
    if (!sectors || sectors.length === 0) return false;
    const maxSectorDays = Math.max(...sectors.map(s => s.days));
    return stockDays >= maxSectorDays - LEADER_GAP && stockDays <= maxSectorDays;
}

/** 条件H：股票当日成交量 < 近5日内最大成交量（缩量） */
function leaderCondVolumeDecreased(stockName) {
    return isStockVolumeDecreased(stockName);
}

/** 条件I：当日成交量 > 昨日成交量时，涨跌幅必须 < 5% */
function leaderCondVolumeUpChangeLimited(stockName) {
    return isStockVolumeUpChangeLimited(stockName);
}

/**
 * 今日推荐股票的完整筛选逻辑（加星逻辑也复用此函数，保持一致）
 * 修改下方任一条件的注释状态，今日推荐与加星会自动同步
 */
function passesLeaderConditions(stockName, stockDays, sectors, focusSectors) {
    if (!leaderCondMinDays(stockDays)) return false;       // 条件A：股票连续天数 >= 最小值
    // 条件B：至少一个所属板块在关注板块中（直接复用 getFocusSectors 的板块集合）
    const inFocus = sectors.some(s => focusSectors.has(s.name));
    if (!inFocus) return false;
    // if (!leaderCondTurnoverNotTooLow(stockName)) return false;           // 条件C：股票当日成交额 > 前一日成交额 * 0.9（防缩量）
    if (!leaderCondAmountNotTooHigh(stockName)) return false;        // 条件D：股票当日成交额 < 前一日成交额 * 1.5（防放量）
    if (!leaderCondAllSectorsDecreased(stockName, sectors)) return false; // 条件E：所有所属板块成交额 < 板块前一日 * 1.5
    // if (!leaderCondHighDaysSectorsAbove090(stockName, stockDays, sectors)) return false; // 条件F：高天数板块成交额 > 板块前一日 * 0.9
    if (!leaderCondDaysWithinGap(stockDays, sectors)) return false; // 条件G：股票天数在所属板块最大天数 ± LEADER_GAP 范围内
    // if (!leaderCondVolumeDecreased(stockName)) return false;             // 条件H：股票当日成交量 < 近5日内最大成交量
    if (!leaderCondVolumeUpChangeLimited(stockName)) return false; // 条件I：放量时涨跌幅必须 < 5%
    return true;
}

/** 计算给定股票列表的加星集合（复用今日推荐完整筛选逻辑，自动同步条件开关） */
function calcLeaderStarSet(stocks, stockDaysMap) {
    const daysMap = stockDaysMap || calcStockConsecutiveDays();
    const stockSectorsMap = buildStockSectorsMap();
    const focusSectors = getFocusSectors(getActiveData());
    const starSet = new Set();
    for (const stock of stocks) {
        const stockDays = daysMap.get(stock.name) || 0;
        const sectors = stockSectorsMap.get(stock.name) || [];
        if (passesLeaderConditions(stock.name, stockDays, sectors, focusSectors)) {
            starSet.add(stock.name);
        }
    }
    return starSet;
}

// ============================

function updateLeaderArea(activeData) {
    const container = document.getElementById('leaderContent');
    if (!container) return;

    const industryList = activeData.行业板块资金流向 || [];
    const conceptList = activeData.概念板块资金流向 || [];
    const allCurrentSectors = [...industryList, ...conceptList];

    if (allCurrentSectors.length === 0) {
        container.innerHTML = '<span style="color:#999;">暂无数据</span>';
        return;
    }

    // 计算所有股票的连续流入天数
    const stockConsecutiveDays = calcStockConsecutiveDays();

    // 关注板块集合（与关注板块区一致，复用公共函数避免阈值分歧）
    const focusSectors = getFocusSectors(activeData);

    // 建立当前日期 股票→所属板块 的映射（复用共享函数 buildStockSectorsMap）
    const stockSectors = buildStockSectorsMap();
    const stockChange = new Map(); // 股票→涨跌幅
    for (const sector of allCurrentSectors) {
        if (!condNotPlaceholder(sector)) continue;
        const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);
        for (const stock of stocks) {
            if (!stockChange.has(stock.name)) {
                stockChange.set(stock.name, stock.change);
            }
        }
    }

    // 筛选龙头股票（条件集中在 passesLeaderConditions，加星逻辑也复用，自动同步）
    const leaders = [];
    for (const [stockName, sectors] of stockSectors) {
        const stockDays = stockConsecutiveDays.get(stockName) || 0;
        if (!passesLeaderConditions(stockName, stockDays, sectors, focusSectors)) continue;

        const sectorNames = sectors
            .filter(s => s.days >= 1)
            .map(s => `${s.name}(${s.type}${s.days}天)`);
        leaders.push({
            name: stockName,
            stockDays: stockDays,
            change: stockChange.get(stockName) || '',
            sectors: sectorNames,
            _allSectors: stockSectors.get(stockName)
        });
    }

    // 渲染
    container.innerHTML = '';
    if (leaders.length === 0) {
        container.innerHTML = '<span style="color:#999;">暂无符合条件的龙头股票</span>';
        return;
    }

    // 按股票连续天数降序排列
    leaders.sort((a, b) => b.stockDays - a.stockDays || a.name.localeCompare(b.name));

    const html = leaders.map(leader => {
        const secJson = escapeHtml(JSON.stringify(leader._allSectors));
        const changeNum = parseFloat(leader.change);
        const changeColor = changeNum >= 0 ? '#e53935' : '#43a047';
        const changeArrow = changeNum >= 0 ? '▲' : '▼';
        return `<span class="leader-item leader-clickable" title="连续流入${leader.stockDays}天 | 所属板块: ${leader.sectors.map(s => escapeHtml(s)).join('、')}" data-stock="${escapeHtml(leader.name)}" data-sectors='${secJson}'>
            <span class="leader-name">${escapeHtml(leader.name)}</span>
            <span class="leader-days">${leader.stockDays}天</span>
            <span class="leader-change" style="color:${changeColor}">${changeArrow} ${leader.change}</span>
        </span>`;
    }).join('');
    container.innerHTML = html;
}

function updateFocusArea(activeData) {
    const container = document.getElementById('focusContent');
    if (!container) return;
    container.innerHTML = '';

    const industryList = activeData.行业板块资金流向 || [];
    const conceptList = activeData.概念板块资金流向 || [];

    const industries = filterSectors(industryList, '行业板块资金流向').map(i => ({
        name: i.板块,
        days: calcConsecutiveInflow(i.板块, '行业板块资金流向'),
        stocks: new Set((i._parsedStocks || parseStocks(i.涉及股票)).map(s => s.name)),
        stockStr: i.涉及股票
    }));

    const concepts = filterSectors(conceptList, '概念板块资金流向').map(c => ({
        name: c.板块,
        days: calcConsecutiveInflow(c.板块, '概念板块资金流向'),
        stocks: new Set((c._parsedStocks || parseStocks(c.涉及股票)).map(s => s.name)),
        stockStr: c.涉及股票
    }));

    if (industries.length === 0 && concepts.length === 0) {
        container.innerHTML = '<span style="color:#999;">暂无符合条件的关注板块</span>';
        return;
    }

    // 建立行业↔概念共同股票配对（供弹窗展示关联板块使用）
    const allPairs = [];
    industries.forEach(ind => {
        concepts.forEach(con => {
            const common = [...ind.stocks].filter(s => con.stocks.has(s));
            if (common.length > 0) {
                allPairs.push({ industry: ind, concept: con, commonCount: common.length, commonStocks: common });
            }
        });
    });

    /**
     * 生成关注板块标签的 data-* 属性字符串（供事件委托使用）
     */
    function buildSectorDataAttrs(item, type, allPairs, stockStr) {
        const otherType = type === '行业板块资金流向' ? '概念' : '行业';
        const matched = allPairs
            .filter(p => {
                const targetField = type === '行业板块资金流向' ? 'industry' : 'concept';
                return p[targetField].name === item.name;
            })
            .map(p => {
                const otherField = type === '行业板块资金流向' ? 'concept' : 'industry';
                return { name: p[otherField].name, days: p[otherField].days, commonStocks: p.commonStocks };
            });
        const commonStocks = new Set(allPairs
            .filter(p => {
                const targetField = type === '行业板块资金流向' ? 'industry' : 'concept';
                return p[targetField].name === item.name;
            })
            .flatMap(p => p.commonStocks)
        );
        const stocks = parseStocks(stockStr);
        const attrs = {
            sector: item.name,
            type: type,
            matched: JSON.stringify(matched),
            stocks: JSON.stringify(stocks.map(s => ({ name: s.name, code: s.code, net: s.net }))),
            common: JSON.stringify([...commonStocks])
        };
        return Object.entries(attrs).map(([k, v]) => `data-${k}="${escapeHtml(v)}"`).join(' ');
    }

    // 渲染行业部分
    {
        const indSection = document.createElement('div');
        indSection.style.marginBottom = '10px';

        industries.sort((a, b) => b.days - a.days).forEach(item => {
            const div = document.createElement('div');
            div.className = 'pair clickable';
            div.style.display = 'inline-block';
            div.title = `连续流入${item.days}天\n点击查看最近10日趋势`;
            const daysColor = item.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : '#2563eb';
            div.innerHTML = `<span style="color:#2563eb;font-weight:600;">${escapeHtml(item.name)}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            div.setAttribute('data-sector', item.name);
            div.setAttribute('data-type', '行业板块资金流向');
            const matched = allPairs
                .filter(p => p.industry.name === item.name)
                .map(p => ({ name: p.concept.name, days: p.concept.days, commonStocks: p.commonStocks }));
            div.setAttribute('data-matched', JSON.stringify(matched));
            const stocks = parseStocks(item.stockStr || '');
            div.setAttribute('data-stocks', JSON.stringify(stocks.map(s => ({ name: s.name, code: s.code, net: s.net }))));
            const commonStocks = new Set(allPairs.filter(p => p.industry.name === item.name).flatMap(p => p.commonStocks));
            div.setAttribute('data-common', JSON.stringify([...commonStocks]));
            indSection.appendChild(div);
        });
        container.appendChild(indSection);
    }

    // 2. 渲染概念部分
    {
        const conSection = document.createElement('div');

        concepts.sort((a, b) => b.days - a.days).forEach(item => {
            const div = document.createElement('div');
            div.className = 'pair clickable';
            div.style.display = 'inline-block';
            div.title = `连续流入${item.days}天\n点击查看最近10日趋势`;
            const daysColor = item.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : '#7c3aed';
            div.innerHTML = `<span style="color:#7c3aed;font-weight:600;">${escapeHtml(item.name)}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            div.setAttribute('data-sector', item.name);
            div.setAttribute('data-type', '概念板块资金流向');
            const matched = allPairs
                .filter(p => p.concept.name === item.name)
                .map(p => ({ name: p.industry.name, days: p.industry.days, commonStocks: p.commonStocks }));
            div.setAttribute('data-matched', JSON.stringify(matched));
            const stocks = parseStocks(item.stockStr || '');
            div.setAttribute('data-stocks', JSON.stringify(stocks.map(s => ({ name: s.name, code: s.code, net: s.net }))));
            const commonStocks = new Set(allPairs.filter(p => p.concept.name === item.name).flatMap(p => p.commonStocks));
            div.setAttribute('data-common', JSON.stringify([...commonStocks]));
            conSection.appendChild(div);
        });
        container.appendChild(conSection);
    }
}
