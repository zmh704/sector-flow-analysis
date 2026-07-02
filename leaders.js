// ===== 今日推荐 & 关注板块渲染 =====

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

    // 建立当前日期 股票→所属板块 的映射（过滤占位板块）
    const stockSectors = new Map();
    const stockChange = new Map(); // 股票→涨跌幅
    for (const sector of allCurrentSectors) {
        if (sector.板块 === '所属行业' || sector.板块 === '所属概念') continue;
        const isIndustry = industryList.includes(sector);
        const type = isIndustry ? '行业板块资金流向' : '概念板块资金流向';
        const sectorDays = calcConsecutiveInflow(sector.板块, type);
        const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);
        for (const stock of stocks) {
            if (!stockSectors.has(stock.name)) {
                stockSectors.set(stock.name, []);
                stockChange.set(stock.name, stock.change);
            }
            stockSectors.get(stock.name).push({
                name: sector.板块,
                type: isIndustry ? '行业' : '概念',
                days: sectorDays
            });
        }
    }

    // 筛选龙头股票
    const leaders = [];
    for (const [stockName, sectors] of stockSectors) {
        const stockDays = stockConsecutiveDays.get(stockName) || 0;
        if (stockDays < LEADER_STOCK_MIN_DAYS) continue;

        // 至少有一个所属板块在重点关注中
        const inFocus = sectors.some(s => focusSectors.has(s.name));
        if (!inFocus) continue;

        // 当日成交额 > 前一日成交额 * 0.9
        if (!isStockTurnoverNotTooLow(stockName)) continue;

        // 当日成交额 < 前一日成交额 * 1.5
        if (!isStockAmountNotTooHigh(stockName)) continue;

        // 所有所属板块当日成交额均 < 板块前一日成交额 * 1.5
        const allSectorsOK = sectors.every(s => {
            const st = s.type === '行业' ? '行业板块资金流向' : '概念板块资金流向';
            return isSectorTurnoverDecreased(s.name, st);
        });
        if (!allSectorsOK) continue;

        // 股票连续流入天数 >= 所有所属板块最大天数 - LEADER_GAP
        const maxSectorDays = Math.max(...sectors.map(s => s.days));
        // if (stockDays < maxSectorDays - LEADER_GAP) continue;

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
        const secJson = JSON.stringify(leader._allSectors).replace(/'/g, "\\'");
        const changeNum = parseFloat(leader.change);
        const changeColor = changeNum >= 0 ? '#e53935' : '#43a047';
        const changeArrow = changeNum >= 0 ? '▲' : '▼';
        return `<span class="leader-item leader-clickable" title="连续流入${leader.stockDays}天 | 所属板块: ${leader.sectors.join('、')}" onclick='showStockLeader("${leader.name}", ${secJson})'>
            <span class="leader-name">${leader.name}</span>
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

    const industries = industryList
        .filter(i => Number(i.主力净额) > 0 && i.板块 !== '所属行业' && i.板块 !== '所属概念')
        .filter(i => isSectorTurnoverDecreased(i.板块, '行业板块资金流向'))
        .filter(i => isSectorTurnoverNotTooLow(i.板块, '行业板块资金流向'))
        .map(i => ({
            name: i.板块,
            days: calcConsecutiveInflow(i.板块, '行业板块资金流向'),
            stocks: new Set((i._parsedStocks || parseStocks(i.涉及股票)).map(s => s.name))
        }))
        .filter(i => i.days >= FOCUS_MIN_DAYS);

    const concepts = conceptList
        .filter(c => Number(c.主力净额) > 0 && Number(c.股票数量) > 1 && c.板块 !== '所属行业' && c.板块 !== '所属概念')
        .filter(c => isSectorTurnoverDecreased(c.板块, '概念板块资金流向'))
        .filter(c => isSectorTurnoverNotTooLow(c.板块, '概念板块资金流向'))
        .map(c => ({
            name: c.板块,
            days: calcConsecutiveInflow(c.板块, '概念板块资金流向'),
            stocks: new Set((c._parsedStocks || parseStocks(c.涉及股票)).map(s => s.name))
        }))
        .filter(c => c.days >= FOCUS_MIN_DAYS);

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

    // 渲染行业部分
    {
        const indSection = document.createElement('div');
        indSection.style.marginBottom = '10px';

        industries.sort((a, b) => b.days - a.days).forEach(item => {
            const div = document.createElement('div');
            div.className = 'pair clickable';
            div.style.display = 'inline-block';
            div.title = `连续流入${item.days}天\\n点击查看最近10日趋势`;
            const daysColor = item.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : '#2563eb';
            div.innerHTML = `<span style="color:#2563eb;font-weight:600;">${item.name}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            const industryStockStr = (industryList.find(i => i.板块 === item.name) || {}).涉及股票 || '';
            div.onclick = function() {
                const matchedConceptsForIndustry = allPairs
                    .filter(p => p.industry.name === item.name)
                    .map(p => ({ name: p.concept.name, days: p.concept.days, commonStocks: p.commonStocks }));
                const industryCommonStocks = new Set(
                    allPairs.filter(p => p.industry.name === item.name)
                        .flatMap(p => p.commonStocks)
                );
                showSingleTrendModal(item.name, '行业板块资金流向', '🏛️ ' + item.name + '（行业）', matchedConceptsForIndustry, parseStocks(industryStockStr), industryCommonStocks);
            };
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
            div.title = `连续流入${item.days}天\\n点击查看最近10日趋势`;
            const daysColor = item.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : '#7c3aed';
            div.innerHTML = `<span style="color:#7c3aed;font-weight:600;">${item.name}</span> <span style="font-size:11px;color:${daysColor};font-weight:700;">${item.days}天</span>`;
            const conceptStockStr = (conceptList.find(c => c.板块 === item.name) || {}).涉及股票 || '';
            div.onclick = function() {
                const matchedIndustriesForConcept = allPairs
                    .filter(p => p.concept.name === item.name)
                    .map(p => ({ name: p.industry.name, days: p.industry.days, commonStocks: p.commonStocks }));
                const conceptCommonStocks = new Set(
                    allPairs.filter(p => p.concept.name === item.name)
                        .flatMap(p => p.commonStocks)
                );
                showSingleTrendModal(item.name, '概念板块资金流向', '💡 ' + item.name + '（概念）', matchedIndustriesForConcept, parseStocks(conceptStockStr), conceptCommonStocks);
            };
            conSection.appendChild(div);
        });
        container.appendChild(conSection);
    }
}
