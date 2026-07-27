// ===== 数据存储、日期排序、加载与日期按钮 =====

function extractDateLabel(filename) {
    const m1 = filename.match(/(\d{1,2}月\d{1,2}日)/);
    if (m1) return m1[1];

    const m2 = filename.match(/(\d{4}[-年]\d{1,2}[-月]\d{1,2}日?)/);
    if (m2) return m2[1];

    return filename.replace(/_.*$/, '');
}

/**
 * 将日期标签转为可排序的数字。
 * 文件名仅含「月日」无年份，故用「生成时间」所在年份推断；
 * 若文件月份比处理月份早半年以上，视为上一年数据（处理年末、次年初场景）。
 * 例：处理时间 2026/1/5 + 文件「12月20日」→ 20251220。
 */
function toDateNum(label, genTime) {
    const iso = String(label).match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})日?/);
    if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);

    const m = String(label).match(/(\d{1,2})月(\d{1,2})日/);
    if (!m) return 0;
    const fileMonth = Number(m[1]);
    let year = new Date().getFullYear();
    if (genTime) {
        const gt = new Date(genTime);
        if (!isNaN(gt.getTime())) {
            year = gt.getFullYear();
            const procMonth = gt.getMonth() + 1;
            if (fileMonth - procMonth >= 6) year = year - 1;
        }
    }
    return year * 10000 + fileMonth * 100 + Number(m[2]);
}

/** 按日期标签排序 dateFileList，返回排序后的新数组（带缓存） */
function sortDateFileList() {
    if (_sortedDateFileList) return _sortedDateFileList;
    _sortedDateFileList = [...dateFileList].sort((a, b) => {
        const entryA = allDataByDate[a];
        const entryB = allDataByDate[b];
        const labelA = entryA?.dateLabel || a;
        const labelB = entryB?.dateLabel || b;
        return toDateNum(labelA, entryA?.data?.生成时间) - toDateNum(labelB, entryB?.data?.生成时间);
    });
    return _sortedDateFileList;
}

/** 创建一份可独立构建的数据状态。 */
function createLoadedState() {
    return {
        allDataByDate: {},
        dateFileList: [],
        stockFieldIndex: {},
        stockNameKeyIndex: new Map()
    };
}

/**
 * 存储单个日期的数据，并预解析股票、构建字段索引。
 * 传入 state 时只修改该局部状态；省略时写入当前页面状态。
 */
function storeDataForDate(filename, data, opts, state) {
    const target = state || {
        allDataByDate,
        dateFileList,
        stockFieldIndex: _stockFieldIndex || {},
        stockNameKeyIndex: _stockNameKeyIndex || new Map()
    };
    const key = filename;
    target.allDataByDate[key] = {
        filename,
        dateLabel: opts?.tradingDate || data.交易日期 || extractDateLabel(filename),
        data
    };

    if (!target.dateFileList.includes(key)) target.dateFileList.push(key);

    const industryList = data.行业板块资金流向 || [];
    const conceptList = data.概念板块资金流向 || [];
    for (const item of [...industryList, ...conceptList]) {
        item._parsedStocks = getSectorStocks(item);
    }

    for (const stockKey of Object.keys(target.stockFieldIndex)) {
        if (key in target.stockFieldIndex[stockKey]) delete target.stockFieldIndex[stockKey][key];
        if (Object.keys(target.stockFieldIndex[stockKey]).length === 0) delete target.stockFieldIndex[stockKey];
    }

    for (const item of [...industryList, ...conceptList]) {
        for (const stock of item._parsedStocks) {
            const stockKey = stock.stockKey || getStockKey(stock.code, stock.name);
            target.stockNameKeyIndex.set(stock.name, stockKey);
            if (!target.stockFieldIndex[stockKey]) target.stockFieldIndex[stockKey] = {};
            if (!target.stockFieldIndex[stockKey][key]) {
                target.stockFieldIndex[stockKey][key] = {
                    name: stock.name,
                    stockKey,
                    volume: stock.volumeWanShou,
                    net: stock.netYi,
                    amount: stock.amountYi,
                    change: stock.changePct,
                    code: stock.code,
                    high: stock.high,
                    open: stock.open,
                    low: stock.low,
                    close: stock.close
                };
            }
        }
    }

    if (!state) {
        allDataByDate = target.allDataByDate;
        dateFileList = target.dateFileList;
        _stockFieldIndex = target.stockFieldIndex;
        _stockNameKeyIndex = target.stockNameKeyIndex;
        _sortedDateFileList = null;
        if (!opts || !opts.skipInvalidate) invalidateDateCaches();
    }
    return target;
}

function getCurrentData() {
    return currentDateFile ? allDataByDate[currentDateFile] : null;
}

/** 获取当前选中日期前一个交易日的数据（供今日推荐条件E等需要比较前一日场景使用） */
function getPrevDayData() {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return null;
    return allDataByDate[sorted[currentIdx - 1]]?.data || null;
}

/** 切换当前选中日期，并失效依赖于该日期的缓存 */
function setCurrentDateFile(filename) {
    if (currentDateFile === filename) return;
    currentDateFile = filename;
    invalidateDateCaches();
}

function getActiveData() {
    return getCurrentData()?.data || {
        行业板块资金流向: [],
        概念板块资金流向: [],
        分析总结: null
    };
}

function updateActiveDataMeta() {
    const current = getCurrentData();
    const data = current?.data || {};
    const label = current ? `${current.dateLabel}｜${current.filename}` : '未选择数据';

    if (data.生成时间) {
        document.getElementById('generateTime').textContent = data.生成时间;
        document.getElementById('dataDate').textContent = `当前显示：${label}｜数据生成时间：${data.生成时间}`;
    } else {
        document.getElementById('generateTime').textContent = '-';
        document.getElementById('dataDate').textContent = `当前显示：${label}`;
    }

    // 数据来源：优先显示实际来源（上传文件名），无则回退到通用描述
    const sourceEl = document.getElementById('dataSource');
    if (sourceEl) {
        sourceEl.textContent = data.数据来源 || 'A股成交额TOP200';
    }
}

function renderDateButtons() {
    const container = document.getElementById('dateButtons');
    container.innerHTML = '';

    if (dateFileList.length === 0) {
        container.innerHTML = renderEmptyState('📅', '暂无数据', '请点击「加载数据」');
        return;
    }

    const sorted = sortDateFileList();

    sorted.forEach(filename => {
        container.appendChild(createDateButton(filename));
    });

    if (!currentDateFile && dateFileList.length > 0) {
        setCurrentDateFile(sorted[sorted.length - 1]);
        const btns = container.querySelectorAll('.date-btn');
        if (btns.length > 0) {
            btns[btns.length - 1].classList.add('active');
        }
    }
}

/** 创建日期切换按钮（事件由 app.js 中的事件委托处理） */
function createDateButton(filename) {
    const item = allDataByDate[filename];
    const btn = document.createElement('button');
    btn.className = 'date-btn';
    btn.textContent = item?.dateLabel || filename;
    btn.dataset.datefile = filename;
    if (filename === currentDateFile) {
        btn.classList.add('active');
    }
    return btn;
}

function normalizeManifest(payload) {
    if (Array.isArray(payload)) {
        return payload.map(path => ({ path, tradingDate: '', schemaVersion: 1 }));
    }
    if (payload && payload.schemaVersion >= 2 && Array.isArray(payload.files)) {
        return payload.files.filter(item => item && typeof item.path === 'string');
    }
    throw new Error('文件列表格式无效');
}

/**
 * 将本轮下载结果构建成独立 staging 状态，避免加载过程中污染当前页面。
 */
function buildLoadedState(results) {
    const state = createLoadedState();
    for (const result of results) {
        storeDataForDate(result.entry.path, result.data, {
            skipInvalidate: true,
            tradingDate: result.entry.tradingDate
        }, state);
    }
    return state;
}

async function loadAllJsonFiles() {
    const generation = ++_loadGeneration;
    if (_loadAbortController) _loadAbortController.abort();
    const controller = new AbortController();
    _loadAbortController = controller;
    const previousDate = currentDateFile;
    const hadPreviousData = dateFileList.length > 0;
    showLoadingStatus('正在扫描并加载数据文件...');

    let manifest;
    try {
        const response = await fetch('/api/list', { signal: controller.signal, cache: 'no-cache' });
        if (!response.ok) throw new Error('服务器 API 不可用，状态码: ' + response.status);
        manifest = normalizeManifest(await response.json());
    } catch (error) {
        if (error.name === 'AbortError' || generation !== _loadGeneration) return;
        showWarningStatus('本地服务器不可用，尝试通过静态列表加载...');
        try {
            const fallbackResp = await fetch('list.json', { signal: controller.signal, cache: 'no-cache' });
            if (!fallbackResp.ok) throw new Error('list.json 加载失败');
            manifest = normalizeManifest(await fallbackResp.json());
        } catch (fallbackError) {
            if (fallbackError.name === 'AbortError' || generation !== _loadGeneration) return;
            showWarningStatus(hadPreviousData
                ? '刷新失败，继续显示上次成功加载的数据'
                : '数据加载失败：请确保已启动服务器（双击 start.cmd）或已生成 list.json');
            return;
        }
    }

    if (generation !== _loadGeneration) return;
    if (manifest.length === 0) {
        showWarningStatus(hadPreviousData ? '未发现新数据，继续显示当前数据' : 'data/ 目录下没有找到板块资金流向 JSON 文件');
        return;
    }

    const MAX_RECENT_FILES = 12;
    manifest = manifest.slice().sort((a, b) => {
        const aDate = a.tradingDate || extractDateLabel(a.path);
        const bDate = b.tradingDate || extractDateLabel(b.path);
        return toDateNum(aDate, Date.now()) - toDateNum(bDate, Date.now());
    }).slice(-MAX_RECENT_FILES);

    const totalFiles = manifest.length;
    const loadedResults = [];
    const BATCH_SIZE = 6;
    showLoadingProgress(`正在加载 0/${totalFiles}...`, 0, totalFiles);

    for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
        const batch = manifest.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(async entry => {
            try {
                const response = await fetch(entry.path, { signal: controller.signal });
                if (!response.ok) return null;
                return { entry, data: await response.json() };
            } catch (error) {
                if (error.name !== 'AbortError') console.error(`加载文件 ${entry.path} 失败:`, error);
                return null;
            }
        }));
        if (generation !== _loadGeneration || controller.signal.aborted) return;
        loadedResults.push(...results.filter(Boolean));
        const done = Math.min(i + BATCH_SIZE, totalFiles);
        showLoadingProgress(`正在加载 ${done}/${totalFiles}...`, done, totalFiles);
    }

    if (loadedResults.length === 0) {
        showWarningStatus(hadPreviousData ? '刷新失败，继续显示上次成功加载的数据' : '没有成功加载任何数据文件');
        return;
    }

    const staged = buildLoadedState(loadedResults);
    if (generation !== _loadGeneration) return;

    allDataByDate = staged.allDataByDate;
    dateFileList = staged.dateFileList;
    _stockFieldIndex = staged.stockFieldIndex;
    _stockNameKeyIndex = staged.stockNameKeyIndex;
    _sortedDateFileList = null;
    currentDateFile = previousDate && allDataByDate[previousDate] ? previousDate : null;
    invalidateDateCaches();
    renderDateButtons();

    try {
        updateCharts();
        showSuccessStatus(`已加载 ${loadedResults.length} 个文件`);
    } catch (error) {
        console.error('❌ 渲染图表失败:', error);
        showWarningStatus('数据加载成功，但渲染失败: ' + error.message);
    }
}
