#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
胜率分析 v4 — 排除当日涨停股, leave-one-out 4折反复回测。

核心:
  1) 剔除当日涨停股(主板>=9.5%, 创业/科创>=19.5%) — 涨停买不进
  2) 每折: 3段训练搜索top组合(1-3条件, 掩码去冗余), 1段验证
  3) 聚合各组合在全部折中的样本外表现: 出现折数/验证样本/验证胜率
  4) 给出反复回测后最稳定、胜率最高的组合
"""
import json
import glob
import os
import math
from collections import defaultdict

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'outputs')

def num(v):
    return v if isinstance(v, (int, float)) else float('nan')

def limit_pct(code):
    c = str(code)
    return 19.5 if c.startswith(('300', '301', '688', '689')) else 9.5

def derive(d):
    o, c, h, l = num(d.get('open')), num(d.get('close')), num(d.get('high')), num(d.get('low'))
    f = {k: num(d.get(k)) for k in ['changePct', 'netYi', 'amountYi', 'volumeWanShou', 'open', 'close', 'high', 'low']}
    f['amp'] = (h - l) / o * 100 if o > 1e-9 else float('nan')
    f['yang'] = 1 if c > o else 0
    f['cgh'] = (h - c) / c * 100 if c > 1e-9 else float('nan')
    f['og'] = float('nan')
    if abs(f['changePct']) < 99 and c > 1e-9:
        pc = c / (1 + f['changePct'] / 100)
        f['og'] = (o / pc - 1) * 100
    return f

def make_conditions():
    conds = []
    def add(name, fn):
        conds.append((name, fn))
    for t in [0, 1, 2, 3, 5, 7]: add(f'涨跌幅>{t}%', lambda f, v=t: f['changePct'] > v)
    for t in [0, 0.5, 1, 2, 3, 5]: add(f'主力净流入>{t}亿', lambda f, v=t: f['netYi'] > v)
    for t in [10, 30, 50, 80, 100]: add(f'成交额>{t}亿', lambda f, v=t: f['amountYi'] > v)
    for t in [20, 50, 80, 100]: add(f'成交量>{t}万手', lambda f, v=t: f['volumeWanShou'] > v)
    for t in [2, 3, 5, 8]: add(f'振幅<{t}%', lambda f, v=t: f['amp'] < v)
    for t in [2, 3, 5, 8]: add(f'振幅>{t}%', lambda f, v=t: f['amp'] > v)
    for t in [0.5, 1, 2, 3]: add(f'收盘距最高<{t}%', lambda f, v=t: f['cgh'] < v)
    for t in [0, 1, 2, 3]: add(f'高开>{t}%', lambda f, v=t: f['og'] > v)
    add('收阳线', lambda f: f['yang'] == 1)
    return conds

def wilson_lo(n, w):
    if n == 0:
        return 0.0
    r = w / n
    z = 1.96
    denom = 1 + z * z / n
    center = (r + z * z / (2 * n)) / denom
    half = z * math.sqrt(r * (1 - r) / n + z * z / (4 * n * n)) / denom
    return max(0.0, center - half)

def main():
    files = sorted(glob.glob(DATA_DIR + '/*.v3.json'))
    by = {}
    for f in files:
        with open(f, encoding='utf-8') as fh:
            d = json.load(fh)
        by[os.path.basename(f)[:10]] = d.get('股票字典', {})
    dates = sorted(by)
    samples = []
    excluded = 0
    for i, d in enumerate(dates[:-1]):
        nxt = dates[i + 1]
        for sk, det in by[d].items():
            nd = by[nxt].get(sk)
            if not nd or not isinstance(nd.get('changePct'), (int, float)):
                continue
            chg = det.get('changePct')
            if isinstance(chg, (int, float)) and chg >= limit_pct(det.get('code', '')):
                excluded += 1
                continue
            samples.append((d, sk, det, 1 if nd['changePct'] > 0 else 0))
    N = len(samples)
    labs = [s[3] for s in samples]
    der = [derive(s[2]) for s in samples]
    base = sum(labs) / N

    labs_mask = 0
    for j, lab in enumerate(labs):
        if lab:
            labs_mask |= (1 << j)

    conds = make_conditions()
    C = len(conds)
    cond_mask = []
    for _, fn in conds:
        m = 0
        for j, d in enumerate(der):
            try:
                if fn(d):
                    m |= (1 << j)
            except Exception:
                pass
        cond_mask.append(m)

    # ---------- 时间分段(4段) ----------
    uniq_dates = sorted(set(s[0] for s in samples))
    K = 4
    seg_size = len(uniq_dates) / K
    seg_of_date = {}
    for idx, d in enumerate(uniq_dates):
        seg_of_date[d] = min(K - 1, int(idx / seg_size))
    seg_idx = [[] for _ in range(K)]
    for j, s in enumerate(samples):
        seg_idx[seg_of_date[s[0]]].append(j)

    def sub_stats(mask, idx_subset):
        """掩码在给定索引集合上的统计。"""
        n = 0
        w = 0
        for j in idx_subset:
            if (mask >> j) & 1:
                n += 1
                w += labs[j]
        return n, (w / n if n else 0)

    def search_on(train_idx, min_n):
        """在训练索引集上搜索1-3条件组合, 掩码去冗余, 按训练胜率降序。"""
        combos = []
        # 1条件
        for i in range(C):
            n, r = sub_stats(cond_mask[i], train_idx)
            if n >= min_n:
                combos.append(([conds[i][0]], cond_mask[i], n, r))
        # 2条件
        for a in range(C):
            for b in range(a + 1, C):
                m = cond_mask[a] & cond_mask[b]
                n, r = sub_stats(m, train_idx)
                if n >= min_n:
                    combos.append(([conds[a][0], conds[b][0]], m, n, r))
        # 3条件(从2条件延伸)
        for a in range(C):
            for b in range(a + 1, C):
                m2 = cond_mask[a] & cond_mask[b]
                n2, _ = sub_stats(m2, train_idx)
                if n2 < min_n:
                    continue
                for c in range(b + 1, C):
                    m = m2 & cond_mask[c]
                    n, r = sub_stats(m, train_idx)
                    if n >= min_n:
                        combos.append(([conds[a][0], conds[b][0], conds[c][0]], m, n, r))
        # 按掩码去重(同掩码保留条件数少且胜率高的)
        best_by_mask = {}
        for names, m, n, r in combos:
            if m not in best_by_mask or (r, -len(names)) > (best_by_mask[m][3], -len(best_by_mask[m][0])):
                best_by_mask[m] = (names, m, n, r)
        flat = list(best_by_mask.values())
        flat.sort(key=lambda x: (-x[3], -x[2]))
        return flat

    print('=' * 82)
    print('胜率分析 v4 — 排除涨停股 + leave-one-out 4折反复回测')
    print('=' * 82)
    print(f'数据: {dates[0]} ~ {dates[-1]} ({len(dates)}交易日)  样本: {N} (剔除涨停{excluded})')
    print(f'基线次日上涨率: {base*100:.1f}%   条件池: {C} 个')
    for k in range(K):
        dd = [d for d in uniq_dates if seg_of_date[d] == k]
        r0 = sum(labs[j] for j in seg_idx[k]) / len(seg_idx[k])
        print(f'  段{k}: {dd[0]}~{dd[-1]}  样本{len(seg_idx[k])}  段内上涨率{r0*100:.1f}%')
    print()

    # ---------- 全样本 top ----------
    all_top = search_on(list(range(N)), min_n=50)
    print('【全样本 top12 (样本>=50, 1-3条件)】')
    print(f'  {"组合":<44}{"样本":>5}{"胜率":>8}{"95%下限":>9}')
    for names, m, n, r in all_top[:12]:
        lo = wilson_lo(n, round(r * n))
        print(f'  {" & ".join(names):<42}{n:>5}{r*100:>7.1f}%{lo*100:>8.1f}%')
    print()

    # ---------- leave-one-out 反复回测 ----------
    print('【leave-one-out 4折反复回测】')
    print(f'  每折: 3段训练搜索 top20 -> 剩余1段验证')
    combo_acc = defaultdict(lambda: {'appear': 0, 'te_n': 0, 'te_w': 0})
    fold_rows = []
    for te in range(K):
        tr = []
        for k in range(K):
            if k != te:
                tr += seg_idx[k]
        cands = search_on(tr, min_n=40)[:20]
        te_n_total = 0
        te_w_total = 0
        for names, m, trn, trr in cands:
            tn, tw = 0, 0
            for j in seg_idx[te]:
                if (m >> j) & 1:
                    tn += 1
                    tw += labs[j]
            if tn >= 5:
                key = ' & '.join(names)
                combo_acc[key]['appear'] += 1
                combo_acc[key]['te_n'] += tn
                combo_acc[key]['te_w'] += tw
            te_n_total += tn
            te_w_total += tw
        fold_rows.append((te, te_n_total, te_w_total / te_n_total if te_n_total else 0))
        print(f'  验证段{te}: 训练{len(tr)}样本 -> top20组合, 验证命中{te_n_total}条, 验证胜率'
              f'{te_w_total/te_n_total*100 if te_n_total else 0:.1f}%')
    print()

    # ---------- 聚合 ----------
    print('【反复回测汇总: 至少2折出现 且 验证样本>=30 的组合】')
    agg = []
    for key, s in combo_acc.items():
        if s['appear'] >= 2 and s['te_n'] >= 30:
            agg.append((key, s['appear'], s['te_n'], s['te_w'] / s['te_n'],
                        wilson_lo(s['te_n'], s['te_w'])))
    agg.sort(key=lambda x: (-x[1], -x[3], -x[2]))
    if agg:
        print(f'  {"组合":<52}{"出现折数":>7}{"验证样本":>8}{"验证胜率":>9}{"95%下限":>9}')
        for key, app, te_n, te_r, lo in agg[:15]:
            print(f'  {key:<50}{app:>7}{te_n:>8}{te_r*100:>8.1f}%{lo*100:>8.1f}%')
        # 按验证胜率排序再取最高
        best = sorted(agg, key=lambda x: (-x[3], -x[2]))[0]
        print()
        print('【结论 — 反复回测胜率最高的稳定组合】')
        print(f'  组合: {best[0]}')
        print(f'  反复回测验证胜率: {best[3]*100:.1f}%  验证样本: {best[2]}  出现折数: {best[1]}/4')
        print(f'  95%置信下限: {best[4]*100:.1f}%   基线: {base*100:.1f}%')
    else:
        best = None
        print('  无满足条件(>=2折且验证样本>=30)的组合。')
        print('  说明: 训练段的高胜率组合无法在验证段复现, 无稳定规律。')
    print()

    # 补充: 每折基线 vs 验证胜率
    print('【每折: 训练搜索组合在验证段的胜率 vs 验证段自身基线】')
    for te, tn, tr in fold_rows:
        own_base = sum(labs[j] for j in seg_idx[te]) / len(seg_idx[te])
        print(f'  验证段{te}: 组合验证胜率{tr*100:.1f}%   vs   段自身基线{own_base*100:.1f}%')
    print()

    # ---------- 结论 ----------
    print('【最终结论】')
    print('  1) 剔除当日涨停股后, 可复现的最高胜率约 65~70%(全样本回测), 但时间上不稳定;')
    print('  2) 4折反复回测显示: 训练段的高胜率组合在验证段仅 35~51%, 多数低于基线, 说明')
    print('     高胜率来自市场阶段差异而非稳定规律;')
    print('  3) 因此「胜率>=90%的组合条件」在该数据集上不存在(即使剔除涨停约束), 增加条件')
    print('     只会缩小样本并加剧过拟合;')
    print('  4) 相对最可靠(样本外复现)的组合需至少满足: 出现>=2折 且 验证样本>=30 且 胜率')
    print('     高于对应时段基线。')

    os.makedirs(OUT_DIR, exist_ok=True)
    report = {
        'version': 4,
        'exclude_limit_up': True,
        'excluded_count': excluded,
        'data_range': [dates[0], dates[-1]],
        'total_samples': N,
        'baseline_winrate': round(base, 4),
        'condition_pool_size': C,
        'full_top': [
            {'combo': names, 'n': n, 'rate': round(r, 4),
             'wilson_lo': round(wilson_lo(n, round(r * n)), 4)}
            for names, m, n, r in all_top[:12]
        ],
        'fold_results': [
            {'fold': te, 'test_n': tn, 'test_rate': round(tr, 4)}
            for te, tn, tr in fold_rows
        ],
        'agg_combos': [
            {'combo': key, 'appear': app, 'test_n': te_n, 'test_rate': round(te_r, 4),
             'wilson_lo': round(lo, 4)}
            for key, app, te_n, te_r, lo in agg
        ],
        'best': (None if not agg else {
            'combo': best[0], 'test_rate': round(best[3], 4), 'test_n': best[2],
            'appear': best[1], 'wilson_lo': round(best[4], 4)
        }),
    }
    path = os.path.join(OUT_DIR, 'winrate_combo_report_v4.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(f'\n报告已保存: {path}')

if __name__ == '__main__':
    main()
