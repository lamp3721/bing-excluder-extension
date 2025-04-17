document.addEventListener('DOMContentLoaded', () => {
    const blacklistItemsUl = document.getElementById('blacklist-items');
    const newDomainInput = document.getElementById('new-domain');
    const addButton = document.getElementById('add-button');
    const statusMessage = document.getElementById('status-message');

    const storageKey = 'bingExcluderBlacklist';
    const defaultBlacklist = ['csdn.net', 'zhihu.com', 'baidu.com']; // Default if nothing is stored yet

    let currentBlacklist = [];

    // --- Helper Functions ---

    function showStatus(message, isError = false) {
        statusMessage.textContent = message;
        statusMessage.className = isError ? 'status error' : 'status';
        // Clear message after a few seconds
        setTimeout(() => {
            statusMessage.textContent = '';
            statusMessage.className = 'status';
        }, 3000);
    }

    function isValidDomain(domain) {
        // Basic validation: not empty, no spaces, contains at least one dot
        if (!domain || domain.trim() === '' || /\s/.test(domain)) {
            return false;
        }
        // Very basic check - could be more robust (e.g., using regex)
        return domain.includes('.');
    }

    function renderBlacklist() {
        blacklistItemsUl.innerHTML = ''; // Clear existing list
        if (currentBlacklist.length === 0) {
            blacklistItemsUl.innerHTML = '<li>Blacklist is empty.</li>';
            return;
        }

        // Sort alphabetically for better readability
        const sortedList = [...currentBlacklist].sort();

        sortedList.forEach(domain => {
            const li = document.createElement('li');
            const span = document.createElement('span');
            span.textContent = domain;
            const removeButton = document.createElement('button');
            removeButton.textContent = 'Remove';
            removeButton.className = 'remove-button';
            removeButton.dataset.domain = domain; // Store domain in data attribute

            removeButton.addEventListener('click', handleRemove);

            li.appendChild(span);
            li.appendChild(removeButton);
            blacklistItemsUl.appendChild(li);
        });
    }

    function loadBlacklist() {
        chrome.storage.sync.get([storageKey], (result) => {
            if (chrome.runtime.lastError) {
                console.error("Error loading blacklist:", chrome.runtime.lastError);
                showStatus("Error loading blacklist.", true);
                currentBlacklist = [...defaultBlacklist]; // Fallback
            } else {
                // Use stored list, or default if storage is empty/undefined
                currentBlacklist = result[storageKey] || [...defaultBlacklist];
                console.log('Blacklist loaded:', currentBlacklist);
            }
            renderBlacklist();
        });
    }

    function saveBlacklist() {
        chrome.storage.sync.set({ [storageKey]: currentBlacklist }, () => {
            if (chrome.runtime.lastError) {
                console.error("Error saving blacklist:", chrome.runtime.lastError);
                showStatus("Error saving blacklist.", true);
            } else {
                console.log('Blacklist saved:', currentBlacklist);
                showStatus("Blacklist updated successfully!");
                renderBlacklist(); // Re-render to reflect changes (like sorting)
            }
        });
    }

    // --- Event Handlers ---

    function handleAdd() {
        const newDomain = newDomainInput.value.trim().toLowerCase();

        if (!isValidDomain(newDomain)) {
            showStatus("Please enter a valid domain name (e.g., example.com).", true);
            return;
        }

        if (currentBlacklist.includes(newDomain)) {
            showStatus(`Domain "${newDomain}" is already in the blacklist.`, true);
            return;
        }

        currentBlacklist.push(newDomain);
        newDomainInput.value = ''; // Clear input field
        saveBlacklist(); // Save and re-render
    }

    function handleRemove(event) {
        const domainToRemove = event.target.dataset.domain;
        if (domainToRemove) {
            currentBlacklist = currentBlacklist.filter(domain => domain !== domainToRemove);
            saveBlacklist(); // Save and re-render
        }
    }

    // --- Initialization ---

    addButton.addEventListener('click', handleAdd);
    // Allow adding by pressing Enter in the input field
    newDomainInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleAdd();
        }
    });

    loadBlacklist(); // Load the list when the options page opens
});