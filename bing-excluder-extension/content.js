// NOTE: This is the MODIFIED content script.
// Remove the old `const blacklist = [...]` line.

(function () {
    'use strict';

    // --- Configuration ---
    const DEBUG = false; // 设置为 true 会在控制台打印详细日志，方便调试
    const storageKey = 'bingExcluderBlacklist'; // SAME KEY as in options.js
    const defaultBlacklist = ['csdn.net', 'zhihu.com', 'baidu.com']; // Fallback defaults

    // --- Constants ---
    const SEARCH_INPUT_SELECTOR = 'input[name="q"]';
    const SEARCH_FORM_SELECTOR = 'form#sb_form, form[role="search"]';
    const BING_SEARCH_PATH = '/search';
    const DEFAULT_FORM_PARAM = 'QBRE';

    // --- Helper Functions ---
    function log(...args) {
        if (DEBUG) {
            console.log('[Bing Excluder Script]', ...args); // Consistent prefix
        }
    }

    // ... (keep other helper functions like waitForElement, getCleanQuery etc.) ...
    // BUT ensure getCleanQuery uses the dynamically loaded cleaningRegexParts

    // --- Core Logic ---

    // Global variables for blacklist derived data (populated after loading)
    let exclusionParts = [];
    let cleaningRegexParts = [];

    function initializeBlacklistData(blacklist) {
        log("Initializing with blacklist:", blacklist);
        exclusionParts = blacklist.map(domain => `-site:${domain.trim().toLowerCase()}`);
        cleaningRegexParts = exclusionParts.map(part => {
            const escapedPart = part.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            return new RegExp(`(?:\\s+|^)${escapedPart}(?:\\s+|$)`, 'gi');
        });
        log("Generated exclusion parts:", exclusionParts);
    }

    function getCleanQuery(fullQuery) {
        if (!fullQuery) return '';
        let cleanQuery = ` ${fullQuery} `;
        log('Starting query cleaning:', cleanQuery);
        // Use the globally defined cleaningRegexParts
        cleaningRegexParts.forEach((regex, index) => {
            cleanQuery = cleanQuery.replace(regex, ' ');
            log(`After removing ${exclusionParts[index]}:`, cleanQuery); // Use global exclusionParts too
        });
        cleanQuery = cleanQuery.replace(/\s\s+/g, ' ').trim();
        log('Final cleaned query:', cleanQuery);
        return cleanQuery;
    }

    function handlePageLoad() {
        // Check if blacklist data is ready before proceeding
        if (exclusionParts.length === 0) {
            log("Blacklist not yet initialized on page load check. This shouldn't happen if loading finished.");
            return false; // Cannot proceed without blacklist
        }

        const currentUrl = new URL(window.location.href);
        const searchParams = currentUrl.searchParams;
        const query = searchParams.get('q');
        if (!query) {
            log('No q query parameter found on page load.');
            return false;
        }
        log('URL initial query:', query);
        const queryLower = query.toLowerCase();
        const missingExclusions = exclusionParts.filter(part => !queryLower.includes(part));

        if (missingExclusions.length > 0) {
            log('Missing exclusion parts found:', missingExclusions);
            let queryNeedsUpdate = query;
            if (queryNeedsUpdate.length > 0 && !queryNeedsUpdate.endsWith(' ')) {
                 queryNeedsUpdate += ' ';
            }
            queryNeedsUpdate += missingExclusions.join(' ');
            queryNeedsUpdate = queryNeedsUpdate.trim();
            log('Redirecting. New query:', queryNeedsUpdate);
            searchParams.set('q', queryNeedsUpdate);
            // Preserve common parameters
            const preservedParams = ['form', 'pc', 'cvid', 'showconv'];
            preservedParams.forEach(p => {
                 if(currentUrl.searchParams.has(p) && !searchParams.has(p)) {
                     searchParams.set(p, currentUrl.searchParams.get(p));
                 }
            });
            const newUrl = `${currentUrl.pathname}?${searchParams.toString()}${currentUrl.hash}`;
            log('Redirecting to:', newUrl);
            window.location.replace(newUrl);
            return true; // Indicate redirection happened
        } else {
            log('All exclusion parts already present in URL.');
            // URL is correct, update the input field to show the *clean* query
            const cleanQuery = getCleanQuery(query);
            waitForElement(SEARCH_INPUT_SELECTOR, (input) => {
                if (input.value !== cleanQuery) {
                    log('Updating input field value to cleaned query:', cleanQuery);
                    input.value = cleanQuery;
                } else {
                     log('Input field value already matches cleaned query.');
                }
            });
            return false; // No redirection needed
        }
    }

    function handleFormSubmit() {
         // Check if blacklist data is ready
        if (exclusionParts.length === 0) {
            log("Blacklist not yet initialized on form submit setup. Waiting...");
             // Could potentially retry or wait, but often load finishes before submit happens
            return;
        }
        waitForElement(SEARCH_FORM_SELECTOR, (form) => {
            log('Search form found:', form);
            // Use a flag to prevent adding multiple listeners if script re-runs somehow
            if (form.dataset.bingExcluderListenerAttached) return;
            form.dataset.bingExcluderListenerAttached = 'true';

            form.addEventListener('submit', (event) => {
                log('Form submit event captured.');
                const input = form.querySelector(SEARCH_INPUT_SELECTOR);
                if (!input) { log('Search input not found in form.'); return; }

                const userInput = input.value.trim();
                if (!userInput) { log('User input is empty, allowing default submit.'); return; }
                log('User input:', userInput);

                event.preventDefault(); // Prevent default form submission

                let targetQuery = userInput;
                const userInputLower = userInput.toLowerCase();

                // Add any missing exclusion parts
                exclusionParts.forEach(part => {
                    if (!userInputLower.includes(part)) {
                        targetQuery += ` ${part}`;
                    }
                });
                targetQuery = targetQuery.trim();
                log('Constructed target query (with exclusions):', targetQuery);

                // Build the new URL
                const newUrl = new URL(window.location.origin);
                newUrl.pathname = BING_SEARCH_PATH;
                newUrl.searchParams.set('q', targetQuery);

                // Preserve form parameter and potentially others
                const currentUrlParams = new URLSearchParams(window.location.search);
                const currentForm = currentUrlParams.get('form');
                newUrl.searchParams.set('form', currentForm || DEFAULT_FORM_PARAM);
                 const paramsToMaybePreserve = ['pc', 'cvid'];
                paramsToMaybePreserve.forEach(p => {
                    if (currentUrlParams.has(p)) { newUrl.searchParams.set(p, currentUrlParams.get(p)); }
                });

                log('Navigating to new URL:', newUrl.toString());
                window.location.href = newUrl.toString();

            }, true); // Use capture phase
        });
    }

    // --- Execution ---
    log('Script execution started...');

    // Load blacklist from storage FIRST
    chrome.storage.sync.get([storageKey], (result) => {
        let loadedBlacklist;
        if (chrome.runtime.lastError) {
            console.error("Error loading blacklist in content script:", chrome.runtime.lastError);
            log("Using default blacklist due to error.");
            loadedBlacklist = [...defaultBlacklist];
        } else {
            loadedBlacklist = result[storageKey] || [...defaultBlacklist];
            log("Blacklist loaded successfully in content script:", loadedBlacklist);
        }

        // Initialize blacklist-dependent variables
        initializeBlacklistData(loadedBlacklist);

        // Now proceed with page logic
        const redirected = handlePageLoad();
        if (!redirected) {
            log('Page load did not redirect, setting up form submit listener.');
            handleFormSubmit();
        } else {
            log('Page load initiated redirect, script will re-run on the new page.');
        }
    });

})(); // End IIFE