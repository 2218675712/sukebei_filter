// ==UserScript==
// @name         Sukebei Chinese Title Size Filter
// @namespace    http://tampermonkey.net/
// @version      7.1
// @description  保留中文标题，并过滤其他语言、疑似番号和过小文件
// @author       qisexin
// @license      MIT
// @match        https://sukebei.nyaa.si/*
// @grant        GM_registerMenuCommand
// @updateURL    https://github.com/qisexin/sukebei_filter/raw/main/sukebei_size_filter.user.js
// @downloadURL  https://github.com/qisexin/sukebei_filter/raw/main/sukebei_size_filter.user.js
// @supportURL   https://github.com/qisexin/sukebei_filter/issues
// @homepageURL  https://github.com/qisexin/sukebei_filter
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'sukebeiChineseTitleFilterSettings';
    const DEFAULT_SETTINGS = {
        minSizeMB: 400,
        panelVisible: false,
        temporarilyShowAll: false
    };
    let settings = loadSettings();
    let panel;
    let statusText;
    let minSizeInput;
    let showAllButton;

    function loadSettings() {
        try {
            const savedSettings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return { ...DEFAULT_SETTINGS, ...savedSettings, temporarilyShowAll: false };
        } catch (error) {
            console.warn('Failed to load filter settings:', error);
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings() {
        const { temporarilyShowAll, ...savedSettings } = settings;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSettings));
    }

    function convertSizeToMB(sizeText) {
        const match = String(sizeText || '').trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
        if (!match) return 0;

        const value = Number.parseFloat(match[1]);
        if (!Number.isFinite(value)) return 0;

        const unit = match[2].toUpperCase();
        const unitMultipliers = {
            B: 1 / 1024 / 1024,
            KB: 1 / 1024,
            KIB: 1 / 1024,
            MB: 1,
            MIB: 1,
            GB: 1024,
            GIB: 1024,
            TB: 1024 * 1024,
            TIB: 1024 * 1024
        };

        return value * (unitMultipliers[unit] || 0);
    }

    function hasChineseTitle(title) {
        return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(title || '');
    }

    function hasJapaneseKana(title) {
        return /[\u3040-\u30ff\uff66-\uff9f]/.test(title || '');
    }

    function hasCodePattern(title) {
        const text = String(title || '');
        return /\b[A-Za-z]{2,8}[-_ ]?\d{2,6}\b/.test(text);
    }

    function getTorrentInfo(row) {
        const cells = row.querySelectorAll('td');
        const nameCell = row.querySelector('td[colspan="2"]') || cells[1] || cells[0];
        const nameLink = nameCell ? nameCell.querySelector('a[href^="/view/"]') : null;
        const sizeCell = cells.length === 8 ? cells[3] : cells.length === 9 ? cells[4] : null;

        return {
            title: (nameLink || nameCell) ? (nameLink || nameCell).textContent.trim() : '',
            sizeMB: sizeCell ? convertSizeToMB(sizeCell.textContent) : 0
        };
    }

    function getHideReason(info) {
        if (hasJapaneseKana(info.title)) return '日文标题';
        if (!hasChineseTitle(info.title)) return '非中文标题';
        if (hasCodePattern(info.title)) return '疑似番号';
        if (info.sizeMB < settings.minSizeMB) return `小于 ${settings.minSizeMB}MB`;
        return '';
    }

    function filterRows() {
        const rows = Array.from(document.querySelectorAll('table.torrent-list tbody tr'));
        const stats = {
            total: rows.length,
            visible: 0,
            hidden: 0,
            noChineseTitle: 0,
            japaneseTitle: 0,
            codeTitle: 0,
            tooSmall: 0
        };

        rows.forEach(row => {
            const info = getTorrentInfo(row);
            const reason = getHideReason(info);

            row.dataset.filterReason = reason;

            if (settings.temporarilyShowAll || !reason) {
                row.style.display = '';
                stats.visible++;
                return;
            }

            row.style.display = 'none';
            stats.hidden++;

            if (reason === '日文标题') {
                stats.japaneseTitle++;
            } else if (reason === '非中文标题') {
                stats.noChineseTitle++;
            } else if (reason === '疑似番号') {
                stats.codeTitle++;
            } else {
                stats.tooSmall++;
            }
        });

        updateStatus(stats);
    }

    function updateStatus(stats) {
        if (!statusText) return;

        if (settings.temporarilyShowAll) {
            statusText.textContent = `已临时显示全部：共 ${stats.total} 条`;
            return;
        }

        statusText.textContent = [
            `显示 ${stats.visible}/${stats.total}`,
            `隐藏 ${stats.hidden}`,
            `日文 ${stats.japaneseTitle}`,
            `非中文 ${stats.noChineseTitle}`,
            `番号 ${stats.codeTitle}`,
            `过小 ${stats.tooSmall}`
        ].join(' | ');
    }

    function applyMinSize() {
        const nextMinSize = Number.parseInt(minSizeInput.value, 10);
        if (!Number.isFinite(nextMinSize) || nextMinSize < 0) {
            minSizeInput.value = settings.minSizeMB;
            return;
        }

        settings.minSizeMB = nextMinSize;
        settings.temporarilyShowAll = false;
        saveSettings();
        updateShowAllButton();
        filterRows();
    }

    function togglePanel() {
        settings.panelVisible = !settings.panelVisible;
        panel.style.display = settings.panelVisible ? 'block' : 'none';
        saveSettings();
    }

    function toggleShowAll() {
        settings.temporarilyShowAll = !settings.temporarilyShowAll;
        updateShowAllButton();
        filterRows();
    }

    function updateShowAllButton() {
        showAllButton.textContent = settings.temporarilyShowAll ? '恢复过滤' : '临时显示全部';
        showAllButton.style.backgroundColor = settings.temporarilyShowAll ? '#4CAF50' : '#f44336';
    }

    function createButton(text, backgroundColor) {
        const button = document.createElement('button');
        button.textContent = text;
        button.style.padding = '5px 10px';
        button.style.backgroundColor = backgroundColor;
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.borderRadius = '3px';
        button.style.cursor = 'pointer';
        button.style.marginRight = '5px';
        return button;
    }

    function createPanel() {
        panel = document.createElement('div');
        panel.style.position = 'fixed';
        panel.style.top = '10px';
        panel.style.right = '10px';
        panel.style.zIndex = '9999';
        panel.style.backgroundColor = 'rgba(0, 0, 0, 0.82)';
        panel.style.color = 'white';
        panel.style.padding = '10px';
        panel.style.borderRadius = '5px';
        panel.style.fontSize = '14px';
        panel.style.display = settings.panelVisible ? 'block' : 'none';

        statusText = document.createElement('div');
        statusText.style.marginBottom = '10px';

        const sizeLabel = document.createElement('label');
        sizeLabel.textContent = '最小大小 (MB): ';
        sizeLabel.style.marginRight = '5px';

        minSizeInput = document.createElement('input');
        minSizeInput.type = 'number';
        minSizeInput.min = '0';
        minSizeInput.step = '50';
        minSizeInput.value = settings.minSizeMB;
        minSizeInput.style.width = '80px';
        minSizeInput.style.color = 'black';
        minSizeInput.style.marginRight = '5px';

        const applyButton = createButton('应用', '#2196F3');
        showAllButton = createButton('', '#f44336');

        applyButton.addEventListener('click', applyMinSize);
        minSizeInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') applyMinSize();
        });
        showAllButton.addEventListener('click', toggleShowAll);

        panel.appendChild(statusText);
        panel.appendChild(sizeLabel);
        panel.appendChild(minSizeInput);
        panel.appendChild(applyButton);
        panel.appendChild(document.createElement('br'));
        panel.appendChild(document.createElement('br'));
        panel.appendChild(showAllButton);

        document.body.appendChild(panel);
        updateShowAllButton();
    }

    function watchTableChanges() {
        const torrentTable = document.querySelector('table.torrent-list');
        if (!torrentTable) return;

        let filterTimer = null;
        const observer = new MutationObserver(mutations => {
            const hasNewRows = mutations.some(mutation => (
                mutation.type === 'childList' &&
                Array.from(mutation.addedNodes).some(node => (
                    node.nodeType === Node.ELEMENT_NODE &&
                    (node.tagName === 'TR' || node.querySelector('tr'))
                ))
            ));

            if (!hasNewRows) return;

            clearTimeout(filterTimer);
            filterTimer = setTimeout(filterRows, 100);
        });

        observer.observe(torrentTable, {
            childList: true,
            subtree: true
        });
    }

    createPanel();
    filterRows();
    watchTableChanges();

    GM_registerMenuCommand('切换中文标题过滤面板', togglePanel);
})();
