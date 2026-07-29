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

function getDateMeta(filename) {
    const loaded = allDataByDate[filename];
    const manifest = _manifestEntryByPath?.get(filename);
    return {
        label: loaded?.dateLabel || manifest?.tradingDate || extractDateLabel(filename),
        genTime: loaded?.data?.生成时间
    };
}

/** 按日期标签排序完整 manifest 路径，返回排序后的新数组（带缓存）。 */
function sortDateFileList() {
    if (_sortedDateFileList) return _sortedDateFileList;
    const source = _dataManifest.length > 0 ? _dataManifest.map(entry => entry.path) : dateFileList;
    _sortedDateFileList = [...source].sort((a, b) => {
        const metaA = getDateMeta(a);
        const metaB = getDateMeta(b);
        return toDateNum(metaA.label, metaA.genTime) - toDateNum(metaB.label, metaB.genTime);
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
    const stockDictionary = data.股票字典 || null;
    for (const item of [...industryList, ...conceptList]) {
        item._parsedStocks = getSectorStocks(item, stockDictionary);
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

function touchLoadedDate(filename) {
    if (!filename || !allDataByDate[filename]) return;
    _dateAccessOrder.delete(filename);
    _dateAccessOrder.set(filename, Date.now());
}

function rebuildLoadedIndexes() {
    const state = createLoadedState();
    for (const filename of dateFileList) {
        const entry = allDataByDate[filename];
        if (!entry) continue;
        storeDataForDate(filename, entry.data, {
            skipInvalidate: true,
            tradingDate: entry.dateLabel
        }, state);
    }
    allDataByDate = state.allDataByDate;
    dateFileList = state.dateFileList;
    _stockFieldIndex = state.stockFieldIndex;
    _stockNameKeyIndex = state.stockNameKeyIndex;
}

function evictLoadedDates(protectedPaths = new Set()) {
    const loaded = dateFileList.filter(filename => allDataByDate[filename]);
    if (loaded.length <= MAX_LOADED_DATES) return [];
    const protectedSet = new Set(protectedPaths);
    if (currentDateFile) protectedSet.add(currentDateFile);
    const removable = loaded
        .filter(filename => !protectedSet.has(filename))
        .sort((a, b) => (_dateAccessOrder.get(a) || 0) - (_dateAccessOrder.get(b) || 0));
    const removed = removable.slice(0, Math.max(0, loaded.length - MAX_LOADED_DATES));
    if (removed.length === 0) return [];
    for (const filename of removed) {
        delete allDataByDate[filename];
        _dateAccessOrder.delete(filename);
    }
    dateFileList = dateFileList.filter(filename => !removed.includes(filename));
    rebuildLoadedIndexes();
    invalidateDateCaches();
    return removed;
}

function getCurrentData() {
    if (currentDateFile) touchLoadedDate(currentDateFile);
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

    const sorted = sortDateFileList();
    if (sorted.length === 0) {
        container.innerHTML = renderEmptyState('📅', '暂无数据', '请点击「加载数据」');
        return;
    }

    const visibleDates = sorted.slice(-DATE_BUTTON_LIMIT);
    visibleDates.forEach(filename => {
        container.appendChild(createDateButton(filename));
    });

    if (!currentDateFile) {
        setCurrentDateFile(visibleDates[visibleDates.length - 1]);
        const btns = container.querySelectorAll('.date-btn');
        if (btns.length > 0) {
            btns[btns.length - 1].classList.add('active');
        }
    }
}

/** 创建日期切换按钮（事件由 app.js 中的事件委托处理） */
function createDateButton(filename) {
    const item = allDataByDate[filename];
    const manifest = _manifestEntryByPath.get(filename);
    const btn = document.createElement('button');
    btn.className = 'date-btn';
    btn.textContent = item?.dateLabel || manifest?.tradingDate || extractDateLabel(filename);
    btn.dataset.datefile = filename;
    btn.classList.toggle('date-not-loaded', !item);
    if (filename === currentDateFile) btn.classList.add('active');
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

async function fetchManifestEntries(entries, signal, onProgress) {
    const loadedResults = [];
    const BATCH_SIZE = 4;
    for (let index = 0; index < entries.length; index += BATCH_SIZE) {
        const batch = entries.slice(index, index + BATCH_SIZE);
        const results = await Promise.all(batch.map(async entry => {
            try {
                const response = await fetch(entry.path, { signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return { entry, data: await response.json() };
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                console.error(`加载文件 ${entry.path} 失败:`, error);
                return null;
            }
        }));
        loadedResults.push(...results.filter(Boolean));
        if (onProgress) onProgress(Math.min(index + BATCH_SIZE, entries.length), entries.length);
    }
    return loadedResults;
}

let _historyLoadPromise = null;

async function ensureDateWindowLoaded(filename, days = TREND_CHART_DAYS) {
    if (_historyLoadPromise) await _historyLoadPromise;
    if (!_manifestEntryByPath.has(filename)) return false;
    const sorted = sortDateFileList();
    const index = sorted.indexOf(filename);
    if (index < 0) return false;
    const start = Math.max(0, index - days + 1);
    const paths = sorted.slice(start, index + 1);
    const entries = paths
        .filter(path => !allDataByDate[path])
        .map(path => _manifestEntryByPath.get(path))
        .filter(Boolean);
    if (entries.length === 0) return true;

    showLoadingProgress(`正在补载历史数据 0/${entries.length}...`, 0, entries.length);
    _historyLoadPromise = (async () => {
        const results = await fetchManifestEntries(entries, undefined, (done, total) =>
            showLoadingProgress(`正在补载历史数据 ${done}/${total}...`, done, total)
        );
        for (const result of results) {
            storeDataForDate(result.entry.path, result.data, { tradingDate: result.entry.tradingDate, skipInvalidate: true });
            touchLoadedDate(result.entry.path);
        }
        evictLoadedDates(new Set(paths));
        invalidateDateCaches();
        renderDateButtons();
        showSuccessStatus(`已补载 ${results.length} 个历史文件`);
        return results.length === entries.length;
    })();
    try {
        return await _historyLoadPromise;
    } finally {
        _historyLoadPromise = null;
    }
}

async function selectDateFile(filename) {
    await ensureDateWindowLoaded(filename, DATA_ANALYSIS_DAYS);
    if (!allDataByDate[filename]) {
        showWarningStatus('该日期数据加载失败');
        return false;
    }
    setCurrentDateFile(filename);
    touchLoadedDate(filename);
    document.querySelectorAll('.date-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.datefile === filename);
    });
    updateCharts();
    return true;
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

    _dataManifest = manifest.slice().sort((a, b) => {
        const aDate = a.tradingDate || extractDateLabel(a.path);
        const bDate = b.tradingDate || extractDateLabel(b.path);
        return toDateNum(aDate, Date.now()) - toDateNum(bDate, Date.now());
    });
    _manifestEntryByPath = new Map(_dataManifest.map(entry => [entry.path, entry]));
    _sortedDateFileList = null;

    // 首屏载入最近 4 日以快速展示；随后后台补齐分析窗口，不阻塞首次渲染。
    const initialManifest = _dataManifest.slice(-4);
    const totalFiles = initialManifest.length;
    showLoadingProgress(`正在加载 0/${totalFiles}...`, 0, totalFiles);
    const loadedResults = await fetchManifestEntries(initialManifest, controller.signal, (done, total) =>
        showLoadingProgress(`正在加载 ${done}/${total}...`, done, total)
    );
    if (generation !== _loadGeneration || controller.signal.aborted) return;

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
    _dateAccessOrder = new Map(dateFileList.map(filename => [filename, Date.now()]));
    _sortedDateFileList = null;
    currentDateFile = previousDate && _manifestEntryByPath.has(previousDate) && allDataByDate[previousDate]
        ? previousDate : null;
    invalidateDateCaches();
    renderDateButtons();

    try {
        updateCharts();
        showSuccessStatus(`已加载 ${loadedResults.length} 个文件，正在后台补齐分析窗口...`, false);
        const latestPath = _dataManifest.at(-1)?.path;
        if (latestPath) {
            ensureDateWindowLoaded(latestPath, DATA_ANALYSIS_DAYS).then(complete => {
                if (!complete || currentDateFile !== latestPath) return;
                invalidateDateCaches();
                updateCharts();
                showSuccessStatus(`分析窗口已就绪（${DATA_ANALYSIS_DAYS}日）`);
            }).catch(error => {
                console.error('后台补载分析窗口失败:', error);
                showWarningStatus('当前数据已显示，但历史分析窗口未完整加载');
            });
        }
    } catch (error) {
        console.error('❌ 渲染图表失败:', error);
        showWarningStatus('数据加载成功，但渲染失败: ' + error.message);
    }
}
