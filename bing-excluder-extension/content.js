// 注意：这里不需要 Tampermonkey 的 // ==UserScript== ... // ==/UserScript== 部分

(function () {
    'use strict';

    // --- Configuration ---
    const DEBUG = false; // 设置为 true 会在控制台打印详细日志，方便调试

    // ✅ 自定义黑名单列表（想屏蔽的域名加在这里）
    const blacklist = [
        'csdn.net',
        'zhihu.com',
        'baidu.com'
        // 添加更多你想屏蔽的域名...
    ];

    // --- Constants ---
    const SEARCH_INPUT_SELECTOR = 'input[name="q"]'; // 搜索输入框的选择器
    const SEARCH_FORM_SELECTOR = 'form#sb_form, form[role="search"]';
    const BING_SEARCH_PATH = '/search'; // Bing 搜索的基础路径
    const DEFAULT_FORM_PARAM = 'QBRE'; // 一个常见的 Bing 搜索 form 参数默认值

    // --- Pre-calculated Values ---
    const exclusionParts = blacklist.map(domain => `-site:${domain.trim().toLowerCase()}`);
    const cleaningRegexParts = exclusionParts.map(part => {
        const escapedPart = part.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
         return new RegExp(`(?:\\s+|^)${escapedPart}(?:\\s+|$)`, 'gi');
    });

    // --- Helper Functions ---
    function log(...args) {
        if (DEBUG) {
            console.log('[Bing Excluder Ext]', ...args); // 稍微改下前缀区分
        }
    }

    function waitForElement(selector, callback, timeout = 5000) {
        const element = document.querySelector(selector);
        if (element) {
            log(`元素已存在: ${selector}`);
            callback(element);
            return;
        }
        let observer = null;
        let timeoutId = null;
        const cleanup = () => {
            if (observer) observer.disconnect();
            if (timeoutId) clearTimeout(timeoutId);
            observer = null; timeoutId = null;
            log(`观察器已停止: ${selector}`);
        };
        observer = new MutationObserver((mutations, obs) => {
            const targetElement = document.querySelector(selector);
            if (targetElement) {
                log(`通过观察器找到元素: ${selector}`);
                cleanup();
                callback(targetElement);
            }
        });
        log(`正在等待元素: ${selector}`);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        timeoutId = setTimeout(() => {
            if (observer) {
               log(`在 ${timeout}ms 内未找到元素: ${selector}`);
               cleanup();
            }
        }, timeout);
    }

    function getCleanQuery(fullQuery) {
        if (!fullQuery) return '';
        let cleanQuery = ` ${fullQuery} `;
        log('开始清理查询:', cleanQuery);
        cleaningRegexParts.forEach((regex, index) => {
            cleanQuery = cleanQuery.replace(regex, ' ');
            log(`移除 ${exclusionParts[index]} 后:`, cleanQuery);
        });
        cleanQuery = cleanQuery.replace(/\s\s+/g, ' ').trim();
        log('最终清理结果:', cleanQuery);
        return cleanQuery;
    }

    // --- Core Logic ---
    function handlePageLoad() {
        const currentUrl = new URL(window.location.href);
        const searchParams = currentUrl.searchParams;
        const query = searchParams.get('q');
        if (!query) {
            log('页面加载时未发现 q 查询参数.');
            return false;
        }
        log('URL 初始查询:', query);
        const queryLower = query.toLowerCase();
        const missingExclusions = exclusionParts.filter(part => !queryLower.includes(part));
        if (missingExclusions.length > 0) {
            log('发现缺失的排除项:', missingExclusions);
            let queryNeedsUpdate = query;
            if (queryNeedsUpdate.length > 0 && !queryNeedsUpdate.endsWith(' ')) {
                 queryNeedsUpdate += ' ';
            }
            queryNeedsUpdate += missingExclusions.join(' ');
            queryNeedsUpdate = queryNeedsUpdate.trim();
            log('准备重定向. 新查询:', queryNeedsUpdate);
            searchParams.set('q', queryNeedsUpdate);
            const preservedParams = ['form', 'pc', 'cvid', 'showconv'];
            preservedParams.forEach(p => {
                 if(currentUrl.searchParams.has(p) && !searchParams.has(p)) {
                     searchParams.set(p, currentUrl.searchParams.get(p));
                 }
            });
            const newUrl = `${currentUrl.pathname}?${searchParams.toString()}${currentUrl.hash}`;
            log('将重定向至:', newUrl);
            window.location.replace(newUrl);
            return true;
        } else {
            log('URL 中已包含所有排除项.');
            const cleanQuery = getCleanQuery(query);
            waitForElement(SEARCH_INPUT_SELECTOR, (input) => {
                if (input.value !== cleanQuery) {
                    log('更新输入框值为清理后的查询:', cleanQuery);
                    input.value = cleanQuery;
                } else {
                     log('输入框值已与清理后查询一致.');
                }
            });
            return false;
        }
    }

    function handleFormSubmit() {
        waitForElement(SEARCH_FORM_SELECTOR, (form) => {
            log('搜索表单已找到:', form);
            form.addEventListener('submit', (event) => {
                log('捕获到表单提交事件.');
                const input = form.querySelector(SEARCH_INPUT_SELECTOR);
                if (!input) { log('在表单中未找到搜索输入框.'); return; }
                const userInput = input.value.trim();
                if (!userInput) { log('用户输入为空，允许默认提交.'); return; }
                log('用户输入:', userInput);
                event.preventDefault();
                let targetQuery = userInput;
                const userInputLower = userInput.toLowerCase();
                exclusionParts.forEach(part => {
                    if (!userInputLower.includes(part)) { targetQuery += ` ${part}`; }
                });
                targetQuery = targetQuery.trim();
                log('构建的目标查询 (含排除项):', targetQuery);
                const newUrl = new URL(window.location.origin);
                newUrl.pathname = BING_SEARCH_PATH;
                newUrl.searchParams.set('q', targetQuery);
                const currentFormParams = new URLSearchParams(window.location.search).get('form');
                newUrl.searchParams.set('form', currentFormParams || DEFAULT_FORM_PARAM);
                const paramsToMaybePreserve = ['pc', 'cvid'];
                const currentParams = new URLSearchParams(window.location.search);
                paramsToMaybePreserve.forEach(p => {
                    if (currentParams.has(p)) { newUrl.searchParams.set(p, currentParams.get(p)); }
                });
                log('准备导航至新 URL:', newUrl.toString());
                window.location.href = newUrl.toString();
            }, true);
        });
    }

    // --- Execution ---
    log('脚本开始执行...');
    const redirected = handlePageLoad();
    if (!redirected) {
        log('页面加载时未重定向，设置表单提交监听器.');
        handleFormSubmit();
    } else {
         log('页面加载时已发起重定向，脚本将在新页面重新运行.');
    }

})(); // 立即执行函数结束