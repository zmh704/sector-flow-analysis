// ===== 弹窗：查看全部 / 趋势对比 / 今日龙头，及股票表格 =====

// 查看全部弹窗状态
let modalSortState = { key: 'net', asc: false };
let modalDataType = '';
let modalDataCache = [];

// ===== 查看全部弹窗 =====

function renderModalTable() {
    const tbody = document.getElementById('modalBody');
    tbody.innerHTML = '';

    if (modalDataCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:30px;">暂无数据</td></tr>';
        return;
    }

    const filterInvalid = document.getElementById('filterInvalid').checked;
    let filtered = modalDataCache;
    if (filterInvalid && modalDataType === '概念板块资金流向') {
        filtered = modalDataCache.filter(item => Number(item.股票数量) > 1);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:30px;">过滤后无数据，请取消「过滤无效」</td></tr>';
        return;
    }

    const sorted = [...filtered].sort((a, b) => {
        let va, vb;
        if (modalSortState.key === 'name') {
            va = a.板块;
            vb = b.板块;
            return modalSortState.asc ? va.localeCompare(vb) : vb.localeCompare(va);
        } else if (modalSortState.key === 'net') {
            va = a._val;
            vb = b._val;
        } else if (modalSortState.key === 'turnover') {
            va = a._turnover;
            vb = b._turnover;
        } else if (modalSortState.key === 'days') {
            va = a._days === '-' ? -1 : a._days;
            vb = b._days === '-' ? -1 : b._days;
        } else if (modalSortState.key === 'count') {
            va = a._stockCount;
            vb = b._stockCount;
        }
        return modalSortState.asc ? va - vb : vb - va;
    });

    sorted.forEach(item => {
        const val = item._val;
        const cls = val >= 0 ? 'positive' : 'negative';
        const formattedVal = (val / 100000000).toFixed(2);
        const turnover = (item._turnover / 100000000).toFixed(2);
        const sign = val >= 0 ? '+' : '';

        const sectorStyle = item._highlighted
            ? 'color:#e53935;font-weight:700'
            : '';
        const daysStyle = typeof item._days === 'number' && item._days >= MODAL_DAYS_HIGHLIGHT
            ? 'color:#e53935;font-weight:700'
            : 'color:#555';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="${sectorStyle}white-space:nowrap">${item.板块}</td>
            <td style="text-align:right;white-space:nowrap">${sign}${formattedVal} 亿</td>
            <td style="text-align:right;white-space:nowrap">${turnover} 亿</td>
            <td style="text-align:center;${daysStyle}white-space:nowrap">${item._days}</td>
            <td style="text-align:right;white-space:nowrap">${item.股票数量}</td>
            <td style="font-size:12px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.涉及股票 || '-'}</td>
        `;
        tbody.appendChild(tr);
    });

    ['name', 'net', 'turnover', 'days', 'count'].forEach(k => {
        const arrow = document.getElementById('sortArrow' + k.charAt(0).toUpperCase() + k.slice(1));
        if (arrow) {
            if (modalSortState.key === k) {
                arrow.textContent = modalSortState.asc ? '▲' : '▼';
                arrow.className = 'sort-arrow active';
            } else {
                arrow.textContent = '';
                arrow.className = 'sort-arrow';
            }
        }
    });
}

function sortModalTable(key) {
    if (modalSortState.key === key) {
        modalSortState.asc = !modalSortState.asc;
    } else {
        modalSortState.key = key;
        modalSortState.asc = key === 'net';
    }
    renderModalTable();
}

function showAllData(type) {
    const activeData = getActiveData();
    const list = activeData[type] || [];
    const title = type === '行业板块资金流向' ? '🏛️ 全部行业板块' : '💡 全部概念板块';

    document.getElementById('modalTitle').textContent = title;

    modalDataType = type;
    modalDataCache = list.map(item => {
        const val = Number(item.主力净额);
        let days = '-';
        let highlighted = false;
        if (val > 0) {
            days = calcConsecutiveInflow(item.板块, type);
            highlighted = days >= MODAL_DAYS_HIGHLIGHT;
        }
        return {
            ...item,
            _val: val,
            _turnover: Number(item.成交额),
            _stockCount: Number(item.股票数量),
            _days: days,
            _highlighted: highlighted
        };
    });

    modalSortState = { key: 'days', asc: false };
    renderModalTable();

    document.getElementById('modalOverlay').classList.add('active');
}

function closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('modalOverlay').classList.remove('active');
}

// ===== 趋势对比弹窗 =====

function getTrendData(sectorName, type) {
    const sorted = sortDateFileList();

    let available = sorted;
    if (currentDateFile) {
        const idx = sorted.indexOf(currentDateFile);
        if (idx >= 0) {
            available = sorted.slice(0, idx + 1);
        }
    }

    const recent = available.slice(-10);

    const dates = [];
    const values = [];

    for (const filename of recent) {
        const entry = allDataByDate[filename];
        dates.push(entry?.dateLabel || filename);

        const dayData = entry?.data;
        if (!dayData) {
            values.push(0);
            continue;
        }

        const sectorList = dayData[type] || [];
        const sectorMap = new Map();
        for (const s of sectorList) {
            sectorMap.set(s.板块, s);
        }
        const sector = sectorMap.get(sectorName);
        if (sector) {
            values.push(Number(sector.主力净额) / 100000000);
        } else {
            values.push(0);
        }
    }

    return { dates, values };
}

function createBarChart(ctx, trendData, existingChart) {
    if (existingChart) {
        existingChart.destroy();
    }

    const colors = trendData.values.map(v => {
        if (v == null) return 'rgba(150, 150, 150, 0.5)';
        return v >= 0 ? 'rgba(229, 57, 53, 0.8)' : 'rgba(67, 160, 71, 0.8)';
    });
    const borderColors = trendData.values.map(v => {
        if (v == null) return 'rgba(150, 150, 150, 0.5)';
        return v >= 0 ? 'rgba(229, 57, 53, 1)' : 'rgba(67, 160, 71, 1)';
    });

    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: trendData.dates,
            datasets: [{
                data: trendData.values,
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: 2,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed.y;
                            const sign = val >= 0 ? '+' : '';
                            return `主力净额: ${sign}${val.toFixed(2)} 亿`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: '日期',
                        font: { size: 13, weight: 'bold' }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.06)'
                    },
                    ticks: {
                        font: { size: 12 }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: '主力净额（亿）',
                        font: { size: 13, weight: 'bold' }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        font: { size: 12 },
                        callback: function(value) {
                            const sign = value >= 0 ? '+' : '';
                            return sign + value.toFixed(1);
                        }
                    }
                }
            }
        }
    });

    return chart;
}

function getCurrentActiveData() {
    const activeData = allDataByDate[currentDateFile];
    return activeData ? activeData.data : null;
}

/** 渲染股票表格 */
function renderStockTable(panelList, stocks, bgSet, starSet, stockDaysMap) {
    panelList.innerHTML = '';
    if (!stocks || stocks.length === 0) {
        panelList.innerHTML = '<span style="color:#999;">无涉及股票数据</span>';
        return;
    }

    const bs = bgSet || new Set();
    const ss = starSet || bs;
    const sdm = stockDaysMap || new Map();

    // 排序：共同股票（背景色）放前面，其余放后面，各自按主力净额降序
    const commonStocks = stocks.filter(s => bs.has(s.name))
        .sort((a, b) => (parseFloat(b.net) || -999) - (parseFloat(a.net) || -999));
    const otherStocks = stocks.filter(s => !bs.has(s.name))
        .sort((a, b) => (parseFloat(b.net) || -999) - (parseFloat(a.net) || -999));
    const sortedStocks = [...commonStocks, ...otherStocks];

    const table = document.createElement('table');
    table.className = 'stock-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>#</th><th>股票名称</th><th>成交额</th><th>主力净额</th><th>涨跌幅</th><th>连续天数</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    sortedStocks.forEach((stock, i) => {
        const tr = document.createElement('tr');
        const isBg = bs.has(stock.name);
        const isStarred = ss.has(stock.name);
        if (isBg) tr.classList.add('stock-common');
        const changeNum = parseFloat(stock.change);
        const changeColor = changeNum >= 0 ? 'color:#e53935;' : 'color:#43a047;';
        const changeArrow = changeNum >= 0 ? '▲' : '▼';
        const stockDays = sdm.get(stock.name) || 0;
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td>${isStarred ? '⭐ ' : ''}${escapeHtml(stock.name)}</td>
            <td>${escapeHtml(stock.amount)}</td>
            <td style="${changeColor}">${escapeHtml(stock.net)}</td>
            <td style="${changeColor}font-weight:600;">${changeArrow} ${escapeHtml(stock.change)}</td>
            <td style="text-align:center;color:#888;font-size:11px;">${stockDays > 0 ? stockDays + '天' : '-'}</td>
        `;
        tr.style.cursor = 'pointer';
        tr.onclick = function() { openStockQuote(stock.name, stock.code); };
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panelList.appendChild(table);
}

function showStocksInPanel(sectorName, type, commonStockNames) {
    const panelList = document.getElementById('stockPanelList');
    const panelTitle = document.getElementById('stockPanelTitle');
    if (!panelList) return;

    const activeData = getCurrentActiveData();
    if (!activeData) {
        panelList.innerHTML = '<span style="color:#999;">暂无数据</span>';
        return;
    }

    const sectorList = activeData[type] || [];
    const sector = sectorList.find(s => s.板块 === sectorName);
    if (!sector) {
        panelList.innerHTML = '<span style="color:#999;">未找到该板块数据</span>';
        return;
    }

    const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);

    if (panelTitle) {
        const typeLabel = type === '行业板块资金流向' ? '🏛️' : '💡';
        panelTitle.textContent = `${typeLabel} ${sectorName}`;
    }

    // 计算五角星：股票连续流入天数 >= 板块连续流入天数 - STAR_GAP 且 成交量小于窗口内最大
    const sectorDays = calcConsecutiveInflow(sectorName, type);
    const stockDaysMap = calcStockConsecutiveDays();
    const starSet = new Set();
    for (const stock of stocks) {
        const sDays = stockDaysMap.get(stock.name) || 0;
        if (sDays >= sectorDays - STAR_GAP && isStockVolumeDecreased(stock.name)) starSet.add(stock.name);
    }

    renderStockTable(panelList, stocks, commonStockNames, starSet, stockDaysMap);
}

/** 切换趋势弹窗的图表和股票面板到指定板块 */
function switchTrendView(sectorName, type, commonStockNames) {
    // 更新图表
    if (trendChart) {
        trendChart.destroy();
        trendChart = null;
    }
    const trend = getTrendData(sectorName, type);
    const ctx = document.getElementById('trendChart').getContext('2d');
    trendChart = createBarChart(ctx, trend, trendChart);

    // 更新股票面板
    showStocksInPanel(sectorName, type, commonStockNames);
}

function showSingleTrendModal(sectorName, type, label, matchedSectors, stocks, commonStockNames) {
    if (trendChart) {
        trendChart.destroy();
        trendChart = null;
    }

    const typeIcon = type === '行业板块资金流向' ? '🏛️' : '💡';
    const sectorDays = calcConsecutiveInflow(sectorName, type);
    const titleEl = document.getElementById('trendModalTitle');
    titleEl.innerHTML = `${typeIcon} <span id="trendModalTitleSpan" style="color:#667eea;">${sectorName}</span> <span style="font-size:14px;color:#dc2626;font-weight:700;">${sectorDays}天</span>`;
    titleEl.style.cursor = 'pointer';
    titleEl.title = '切换图表和股票到该板块';
    titleEl.onclick = null;
    titleEl.onclick = function() {
        switchTrendView(sectorName, type, commonStockNames);
    };

    // 渲染匹配的对面板块列表（可点击）
    const matchedContainer = document.getElementById('trendMatchedSectors');
    if (matchedContainer) {
        matchedContainer.innerHTML = '';
        if (matchedSectors && matchedSectors.length > 0) {
            matchedContainer.style.display = '';
            const otherType = type === '行业板块资金流向' ? '概念' : '行业';
            const otherDataType = type === '行业板块资金流向' ? '概念板块资金流向' : '行业板块资金流向';
            const otherColor = type === '行业板块资金流向' ? '#7c3aed' : '#2563eb';
            const matchLabel = type === '行业板块资金流向' ? '相关概念' : '相关行业';
            const titleSpan = document.createElement('span');
            titleSpan.style.cssText = 'font-weight:600;margin-right:6px;';
            titleSpan.textContent = `匹配的${matchLabel}：`;
            matchedContainer.appendChild(titleSpan);
            matchedSectors.sort((a, b) => b.days - a.days).forEach((s) => {
                const tag = document.createElement('span');
                tag.className = 'pair clickable';
                const sDaysColor = s.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : otherColor;
                tag.innerHTML = `<span style="color:${otherColor};">${s.name}</span> <span style="color:${sDaysColor};font-size:11px;">${s.days}天</span>`;
                tag.title = '点击查看涉及股票';
                const sCommonStocks = s.commonStocks || [];
                tag.onclick = function(e) {
                    e.stopPropagation();
                    const dataType = s._dataType || otherDataType;
                    switchTrendView(s.name, dataType, new Set(sCommonStocks));
                };
                matchedContainer.appendChild(tag);
            });
        } else {
            matchedContainer.style.display = 'none';
        }
    }

    // 默认显示当前板块的股票（共同股票优先）
    if (stocks && stocks.length > 0) {
        const panelTitle = document.getElementById('stockPanelTitle');
        if (panelTitle) {
            panelTitle.textContent = `${typeIcon} ${sectorName}`;
        }
        const panelList = document.getElementById('stockPanelList');
        if (panelList) {
            // 计算五角星：股票连续流入天数 >= 板块连续流入天数 - STAR_GAP 且 成交量小于窗口内最大
            const sectorDays = calcConsecutiveInflow(sectorName, type);
            const stockDaysMap = calcStockConsecutiveDays();
            const activeData = getCurrentActiveData();
            const starSet = new Set();
            for (const stock of stocks) {
                const sDays = stockDaysMap.get(stock.name) || 0;
                if (activeData && sDays >= sectorDays - STAR_GAP && isStockVolumeDecreased(stock.name)) starSet.add(stock.name);
            }
            renderStockTable(panelList, stocks, commonStockNames, starSet, stockDaysMap);
        }
    } else {
        showStocksInPanel(sectorName, type);
    }

    // 绘制趋势图
    const trend = getTrendData(sectorName, type);
    const ctx = document.getElementById('trendChart').getContext('2d');
    trendChart = createBarChart(ctx, trend, trendChart);

    document.getElementById('trendModalOverlay').classList.add('active');
}

function closeTrendModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('trendModalOverlay').classList.remove('active');

    if (trendChart) {
        trendChart.destroy();
        trendChart = null;
    }
}

// ==================== 今日龙头弹窗 ====================

function showStockLeader(stockName, sectors) {
    // 选择连续天数最多的板块作为默认显示
    const best = [...sectors].sort((a, b) => b.days - a.days)[0];
    if (!best) return;

    const type = best.type === '行业' ? '行业板块资金流向' : '概念板块资金流向';
    const activeData = getCurrentActiveData();
    if (!activeData) return;

    const sectorList = activeData[type] || [];
    const sector = sectorList.find(s => s.板块 === best.name);
    if (!sector) return;

    const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);

    // 将股票所属的所有其他板块作为匹配板块展示
    const matchedSectors = sectors
        .filter(s => s.name !== best.name)
        .map(s => ({
            name: s.name,
            days: s.days,
            commonStocks: [stockName],
            _dataType: s.type === '行业' ? '行业板块资金流向' : '概念板块资金流向'
        }));

    showSingleTrendModal(
        best.name, type,
        `🐉 ${stockName} → ${best.name}(${best.type})`,
        matchedSectors, stocks,
        new Set([stockName])
    );
}
