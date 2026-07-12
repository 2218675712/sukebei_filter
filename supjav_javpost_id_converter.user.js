// ==UserScript==
// @name         SupJAV JavPost ID Converter
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Convert JavPost visited records to SupJAV numeric IDs by searching SupJAV
// @author       qisexin
// @license      MIT
// @match        https://supjav.com/*
// @match        https://www.supjav.com/*
// @grant        GM_setClipboard
// @updateURL    https://github.com/qisexin/sukebei_filter/raw/main/supjav_javpost_id_converter.user.js
// @downloadURL  https://github.com/qisexin/sukebei_filter/raw/main/supjav_javpost_id_converter.user.js
// @supportURL   https://github.com/qisexin/sukebei_filter/issues
// @homepageURL  https://github.com/qisexin/sukebei_filter
// ==/UserScript==

(function() {
    'use strict';

    const SEARCH_DELAY_MS = 700;
    const DETAIL_PATH_RE = /^\/(\d+)\.html$/i;
    const CODE_RE = /^([A-Z]{2,12}-\d{2,6})/;
    const SEARCH_SUFFIX_RE = /-(UNCENSORED-EDIT|REDUCING-MOSAIC)$/;

    let panel;
    let inputArea;
    let outputArea;
    let statusText;
    let lastOutput = '';

    function normalizeId(value) {
        return String(value || '').trim().toUpperCase();
    }

    function stripSearchSuffix(value) {
        return normalizeId(value).replace(SEARCH_SUFFIX_RE, '');
    }

    function getBaseId(value) {
        const match = stripSearchSuffix(value).match(CODE_RE);
        return match ? match[1] : '';
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function isSameSiteUrl(url) {
        return url.hostname === 'supjav.com' || url.hostname === 'www.supjav.com';
    }

    function getSupjavIdFromUrl(url) {
        const match = url.pathname.match(DETAIL_PATH_RE);
        return match ? match[1] : '';
    }

    function getCandidateText(link) {
        const container = link.closest('article, .post, .item, .movie, .video, .col, .card, li, div') || link;
        const imageText = Array.from(container.querySelectorAll('img'))
            .map(image => [image.alt, image.title].filter(Boolean).join(' '))
            .join(' ');
        return normalizeId([container.textContent, link.title, imageText].filter(Boolean).join(' '));
    }

    function findCandidates(html, fullId, baseId) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const candidates = [];
        doc.querySelectorAll('a[href]').forEach(link => {
            try {
                const url = new URL(link.getAttribute('href'), location.origin);
                const supjavId = isSameSiteUrl(url) ? getSupjavIdFromUrl(url) : '';
                if (!supjavId) return;

                const text = getCandidateText(link);
                const score = Number(text.includes(fullId)) * 3 + Number(text.includes(baseId)) * 2;
                candidates.push({ supjavId, score, text });
            } catch (error) {
                // Ignore invalid links from the search page.
            }
        });
        return candidates.sort((a, b) => b.score - a.score);
    }

    async function searchSupjav(rawId) {
        const fullId = normalizeId(rawId);
        const searchId = stripSearchSuffix(fullId);
        const baseId = getBaseId(searchId);
        if (!baseId) return { rawId, searchId, status: 'skipped', reason: '没有可搜索番号' };

        const response = await fetch('/?s=' + encodeURIComponent(baseId), {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) {
            return { rawId, searchId, baseId, status: 'failed', reason: '搜索失败：HTTP ' + response.status };
        }

        const candidates = findCandidates(await response.text(), searchId, baseId);
        const matched = candidates.find(item => item.score > 0) || candidates[0];
        if (!matched) return { rawId, searchId, baseId, status: 'missed', reason: '未找到 SupJAV 详情页' };

        return {
            rawId,
            searchId,
            baseId,
            supjavId: matched.supjavId,
            status: matched.score > 0 ? 'matched' : 'guessed',
            reason: matched.score > 0 ? '' : '未精确命中，使用首个搜索结果'
        };
    }

    function parseVisitedMap() {
        const value = JSON.parse(inputArea.value.trim());
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('请输入 JavPost 已访问 JSON 对象');
        }
        return value;
    }

    function setStatus(text) {
        statusText.textContent = text;
    }

    function renderOutput(convertedMap, results) {
        window.supjavJavPostConvertDetails = results;
        lastOutput = JSON.stringify(convertedMap, null, 2);
        outputArea.value = lastOutput;
    }

    async function convertRecords() {
        let sourceMap;
        try {
            sourceMap = parseVisitedMap();
        } catch (error) {
            alert(error.message || 'JSON 解析失败');
            return;
        }

        const rawIds = Object.keys(sourceMap);
        const convertedMap = {};
        const results = [];
        setStatus('开始转换，共 ' + rawIds.length + ' 条');

        for (let index = 0; index < rawIds.length; index += 1) {
            const rawId = rawIds[index];
            setStatus('转换中：' + (index + 1) + '/' + rawIds.length + ' ' + rawId);

            try {
                const result = await searchSupjav(rawId);
                results.push(result);
                if (result.supjavId) convertedMap[result.supjavId] = Number(sourceMap[rawId]) || Date.now();
            } catch (error) {
                results.push({ rawId, status: 'failed', reason: error.message || String(error) });
            }

            renderOutput(convertedMap, results);
            await sleep(SEARCH_DELAY_MS);
        }

        const countText = Object.keys(convertedMap).length + '/' + rawIds.length;
        const failedCount = results.filter(item => item.status === 'failed' || item.status === 'missed').length;
        setStatus('转换完成：' + countText + ' 条已转换，失败 ' + failedCount + ' 条。结果可直接作为 supjavVisitedItems 的值。');
    }

    function copyOutput() {
        if (!lastOutput) return;
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(lastOutput);
            alert('已复制转换结果');
            return;
        }
        navigator.clipboard.writeText(lastOutput).then(() => alert('已复制转换结果'));
    }

    function downloadOutput() {
        if (!lastOutput) return;
        const blob = new Blob([lastOutput], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'supjav_visited_items_converted.json';
        link.click();
        URL.revokeObjectURL(link.href);
    }

    function createButton(text, color) {
        const button = document.createElement('button');
        button.textContent = text;
        button.style.padding = '5px 10px';
        button.style.margin = '0 5px 5px 0';
        button.style.border = 'none';
        button.style.borderRadius = '3px';
        button.style.backgroundColor = color;
        button.style.color = 'white';
        button.style.cursor = 'pointer';
        return button;
    }

    function createTextArea(placeholder) {
        const area = document.createElement('textarea');
        area.placeholder = placeholder;
        area.style.width = '100%';
        area.style.height = '130px';
        area.style.boxSizing = 'border-box';
        area.style.color = 'black';
        area.style.marginBottom = '8px';
        return area;
    }

    function togglePanel() {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    function createPanel() {
        const trigger = createButton('JavPost转SupJAV', '#4CAF50');
        trigger.style.position = 'fixed';
        trigger.style.left = '10px';
        trigger.style.bottom = '10px';
        trigger.style.zIndex = '10001';
        trigger.addEventListener('click', togglePanel);
        document.body.appendChild(trigger);

        panel = document.createElement('div');
        panel.style.position = 'fixed';
        panel.style.left = '10px';
        panel.style.bottom = '48px';
        panel.style.width = '430px';
        panel.style.zIndex = '10000';
        panel.style.backgroundColor = 'rgba(0, 0, 0, 0.86)';
        panel.style.color = 'white';
        panel.style.padding = '10px';
        panel.style.borderRadius = '5px';
        panel.style.display = 'none';

        inputArea = createTextArea('粘贴 JavPost 已访问 JSON');
        outputArea = createTextArea('转换后的 supjavVisitedItems JSON 会显示在这里');
        outputArea.readOnly = true;
        statusText = document.createElement('div');
        statusText.style.marginBottom = '8px';
        statusText.textContent = '粘贴 JSON 后点击开始转换';

        const convertButton = createButton('开始转换', '#2196F3');
        const copyButton = createButton('复制结果', '#607D8B');
        const downloadButton = createButton('下载结果', '#607D8B');
        convertButton.addEventListener('click', convertRecords);
        copyButton.addEventListener('click', copyOutput);
        downloadButton.addEventListener('click', downloadOutput);

        panel.appendChild(statusText);
        panel.appendChild(inputArea);
        panel.appendChild(convertButton);
        panel.appendChild(copyButton);
        panel.appendChild(downloadButton);
        panel.appendChild(outputArea);
        document.body.appendChild(panel);
    }

    if (document.body) createPanel();
})();
